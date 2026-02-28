"""Sidecar HTTP API — localhost JSON server for Tauri V2.

Provides a minimal HTTP server (stdlib only, no external deps) that wraps the
multicorpus_engine Python API over localhost HTTP.  A single persistent SQLite
connection is shared across all requests; write operations are protected by a
threading.Lock.

Supports `port=0` for OS-assigned port — useful in tests and when the default
port is already in use.

See docs/DECISIONS.md ADR-016.

Routes
------
GET  /health         → {"status": "ok"}
GET  /openapi.json   → OpenAPI 3.0 contract
POST /query          → run_query; body: {q, mode?, window?, language?, doc_id?,
                        resource_type?, doc_role?, include_aligned?, all_occurrences?}
POST /index          → build_index; body: {}
POST /curate         → curate; body: {rules: [...], doc_id?: int}
POST /validate-meta  → validate; body: {doc_id?: int}
POST /segment        → resegment_document; body: {doc_id: int, lang?: str}
GET  /jobs           → list async jobs
POST /jobs           → enqueue async job {kind, params?}
GET  /jobs/{job_id}  → async job status/result
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from .sidecar_contract import (
    ERR_BAD_REQUEST,
    ERR_INTERNAL,
    ERR_NOT_FOUND,
    ERR_VALIDATION,
    error_payload,
    openapi_spec,
    success_payload,
)
from .sidecar_jobs import JobManager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class _CorpusHandler(BaseHTTPRequestHandler):
    """Request handler for the corpus sidecar API."""

    def log_message(self, format: str, *args) -> None:  # type: ignore[override]
        logger.debug("HTTP %s", format % args)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(
        self,
        message: str,
        *,
        code: str,
        http_status: int,
        details: object | None = None,
    ) -> None:
        self._send_json(
            error_payload(message, code=code, details=details),
            status=http_status,
        )

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON body: {exc.msg}") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def _conn(self) -> sqlite3.Connection:
        return self.server.conn  # type: ignore[attr-defined]

    def _lock(self) -> threading.Lock:
        return self.server.lock  # type: ignore[attr-defined]

    def _jobs(self) -> JobManager:
        return self.server.jobs  # type: ignore[attr-defined]

    # ------------------------------------------------------------------
    # GET
    # ------------------------------------------------------------------

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._send_json(success_payload())
        elif path == "/openapi.json":
            self._send_json(openapi_spec())
        elif path == "/jobs":
            self._handle_jobs_list()
        elif path.startswith("/jobs/"):
            self._handle_job_get(path)
        else:
            self._send_error(
                f"Unknown route: {path}",
                code=ERR_NOT_FOUND,
                http_status=404,
            )

    # ------------------------------------------------------------------
    # POST dispatch
    # ------------------------------------------------------------------

    def do_POST(self) -> None:
        try:
            body = self._read_body()
            path = urlparse(self.path).path

            if path == "/query":
                self._handle_query(body)
            elif path == "/index":
                self._handle_index()
            elif path == "/curate":
                self._handle_curate(body)
            elif path == "/validate-meta":
                self._handle_validate_meta(body)
            elif path == "/segment":
                self._handle_segment(body)
            elif path == "/jobs":
                self._handle_job_submit(body)
            else:
                self._send_error(
                    f"Unknown route: {path}",
                    code=ERR_NOT_FOUND,
                    http_status=404,
                )

        except ValueError as exc:
            self._send_error(
                str(exc),
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
        except Exception as exc:
            logger.exception("Handler error on %s: %s", self.path, exc)
            self._send_error(
                str(exc),
                code=ERR_INTERNAL,
                http_status=500,
            )

    # ------------------------------------------------------------------
    # Jobs
    # ------------------------------------------------------------------

    def _handle_jobs_list(self) -> None:
        jobs = [job.to_dict() for job in self._jobs().list()]
        self._send_json(success_payload({"jobs": jobs}))

    def _handle_job_get(self, path: str) -> None:
        # /jobs/<job_id>
        job_id = path.rsplit("/", 1)[-1].strip()
        if not job_id:
            self._send_error(
                "job_id is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        job = self._jobs().get(job_id)
        if job is None:
            self._send_error(
                f"Unknown job_id: {job_id}",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return
        self._send_json(success_payload({"job": job.to_dict()}))

    def _handle_job_submit(self, body: dict) -> None:
        kind = body.get("kind")
        params = body.get("params", {})

        if not isinstance(kind, str) or not kind.strip():
            self._send_error(
                "kind is required and must be a string",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return
        if params is None:
            params = {}
        if not isinstance(params, dict):
            self._send_error(
                "params must be a JSON object",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return

        supported = {"index", "curate", "validate-meta", "segment"}
        if kind not in supported:
            self._send_error(
                f"Unsupported job kind: {kind!r}",
                code=ERR_VALIDATION,
                http_status=400,
                details={"supported_kinds": sorted(supported)},
            )
            return

        if kind == "segment":
            if "doc_id" not in params:
                self._send_error(
                    "segment job requires params.doc_id",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            try:
                int(params["doc_id"])
            except (TypeError, ValueError):
                self._send_error(
                    "segment params.doc_id must be an integer",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return

        if kind == "curate":
            if "rules" not in params:
                self._send_error(
                    "curate job requires params.rules",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if not isinstance(params.get("rules"), list):
                self._send_error(
                    "curate params.rules must be an array",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return

        if kind == "validate-meta" and "doc_id" in params and params["doc_id"] is not None:
            try:
                int(params["doc_id"])
            except (TypeError, ValueError):
                self._send_error(
                    "validate-meta params.doc_id must be an integer",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return

        job = self._jobs().submit(
            kind=kind,
            params=params,
            runner=self.server.job_runner,  # type: ignore[attr-defined]
        )
        self._send_json(success_payload({"job": job.to_dict()}, status="accepted"), status=202)

    # ------------------------------------------------------------------
    # Route implementations
    # ------------------------------------------------------------------

    def _handle_query(self, body: dict) -> None:
        from multicorpus_engine.query import run_query

        with self._lock():
            hits = run_query(
                conn=self._conn(),
                q=body.get("q", ""),
                mode=body.get("mode", "segment"),
                window=body.get("window", 10),
                language=body.get("language"),
                doc_id=body.get("doc_id"),
                resource_type=body.get("resource_type"),
                doc_role=body.get("doc_role"),
                include_aligned=body.get("include_aligned", False),
                all_occurrences=body.get("all_occurrences", False),
            )
        self._send_json(success_payload({"count": len(hits), "hits": hits}))

    def _handle_index(self) -> None:
        from multicorpus_engine.indexer import build_index

        with self._lock():
            count = build_index(self._conn())
        self._send_json(success_payload({"units_indexed": count}))

    def _handle_curate(self, body: dict) -> None:
        from multicorpus_engine.curation import (
            curate_all_documents,
            curate_document,
            rules_from_list,
        )

        rules = rules_from_list(body.get("rules", []))
        doc_id = body.get("doc_id")
        with self._lock():
            if doc_id is not None:
                reports = [curate_document(self._conn(), doc_id, rules)]
            else:
                reports = curate_all_documents(self._conn(), rules)
        total_modified = sum(r.units_modified for r in reports)
        self._send_json(success_payload({
            "docs_curated": len(reports),
            "units_modified": total_modified,
            "fts_stale": total_modified > 0,
            "results": [r.to_dict() for r in reports],
        }))

    def _handle_validate_meta(self, body: dict) -> None:
        from multicorpus_engine.metadata import (
            validate_all_documents,
            validate_document,
        )

        doc_id = body.get("doc_id")
        with self._lock():
            if doc_id is not None:
                results = [validate_document(self._conn(), doc_id)]
            else:
                results = validate_all_documents(self._conn())
        has_errors = any(not r.is_valid for r in results)
        self._send_json(success_payload({
            "docs_validated": len(results),
            "results": [r.to_dict() for r in results],
        }, status="warnings" if has_errors else "ok"))

    def _handle_segment(self, body: dict) -> None:
        from multicorpus_engine.segmenter import resegment_document

        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error(
                "doc_id is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        with self._lock():
            report = resegment_document(
                self._conn(), doc_id, lang=body.get("lang", "und")
            )
        self._send_json(success_payload({"fts_stale": True, **report.to_dict()}))


# ---------------------------------------------------------------------------
# Server class
# ---------------------------------------------------------------------------


class CorpusServer:
    """Sidecar HTTP server wrapping multicorpus_engine.

    Usage — background (for tests or embedding):
        server = CorpusServer("corpus.db", port=0)
        server.start()
        port = server.actual_port
        # ... make HTTP requests ...
        server.shutdown()

    Usage — foreground (for CLI `serve` command):
        server = CorpusServer("corpus.db", port=8765)
        server.start()
        server.join()   # blocks until shutdown() or KeyboardInterrupt

    With ``port=0`` the OS assigns a free port; use :attr:`actual_port` to
    discover which port was assigned.
    """

    def __init__(
        self,
        db_path: str | Path,
        host: str = "127.0.0.1",
        port: int = 8765,
    ) -> None:
        self._db_path = Path(db_path)
        self._host = host
        self._port = port
        self._conn: Optional[sqlite3.Connection] = None
        self._httpd: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._jobs = JobManager()

    def start(self) -> None:
        """Open DB connection, bind socket, and start serving in a daemon thread."""
        from multicorpus_engine.db.migrations import apply_migrations

        # Sidecar serves requests from a dedicated thread and can launch async
        # jobs in additional worker threads; cross-thread SQLite access is
        # guarded by a lock and requires check_same_thread=False.
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        apply_migrations(self._conn)

        self._httpd = HTTPServer((self._host, self._port), _CorpusHandler)
        self._httpd.conn = self._conn  # type: ignore[attr-defined]
        self._httpd.lock = threading.Lock()  # type: ignore[attr-defined]
        self._httpd.jobs = self._jobs  # type: ignore[attr-defined]
        self._httpd.job_runner = self._run_async_job  # type: ignore[attr-defined]

        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            daemon=True,
            name="CorpusServer",
        )
        self._thread.start()
        logger.info(
            "CorpusServer started on %s:%d (db=%s)",
            self._host,
            self.actual_port,
            self._db_path,
        )

    def join(self) -> None:
        """Block until the server thread exits (call after start())."""
        if self._thread is not None:
            self._thread.join()

    def shutdown(self) -> None:
        """Stop the HTTP server and close the DB connection."""
        if self._httpd is not None:
            self._httpd.shutdown()
        if self._conn is not None:
            self._conn.close()
        logger.info("CorpusServer stopped")

    def _run_async_job(
        self,
        job_id: str,
        kind: str,
        params: dict,
        progress_cb,
    ) -> dict:
        """Execute an async job kind and return a serializable result payload."""
        lock = self._httpd.lock  # type: ignore[union-attr]
        conn = self._conn
        if conn is None:
            raise RuntimeError("Sidecar DB connection is not initialized")

        if kind == "index":
            from multicorpus_engine.indexer import build_index

            progress_cb(10, "Rebuilding FTS index")
            with lock:
                units_indexed = build_index(conn)
            progress_cb(100, "Index rebuilt")
            return {"units_indexed": units_indexed}

        if kind == "curate":
            from multicorpus_engine.curation import (
                curate_all_documents,
                curate_document,
                rules_from_list,
            )

            raw_rules = params.get("rules", [])
            if not isinstance(raw_rules, list):
                raise ValueError("curate job expects params.rules as an array")
            rules = rules_from_list(raw_rules)
            doc_id = params.get("doc_id")

            progress_cb(10, "Applying curation rules")
            with lock:
                if doc_id is not None:
                    reports = [curate_document(conn, int(doc_id), rules)]
                else:
                    reports = curate_all_documents(conn, rules)
            units_modified = sum(r.units_modified for r in reports)
            progress_cb(100, "Curation completed")
            return {
                "docs_curated": len(reports),
                "units_modified": units_modified,
                "fts_stale": units_modified > 0,
                "results": [r.to_dict() for r in reports],
            }

        if kind == "validate-meta":
            from multicorpus_engine.metadata import validate_all_documents, validate_document

            doc_id = params.get("doc_id")
            progress_cb(20, "Validating metadata")
            with lock:
                if doc_id is not None:
                    results = [validate_document(conn, int(doc_id))]
                else:
                    results = validate_all_documents(conn)
            has_errors = any(not r.is_valid for r in results)
            progress_cb(100, "Validation completed")
            return {
                "status": "warnings" if has_errors else "ok",
                "docs_validated": len(results),
                "results": [r.to_dict() for r in results],
            }

        if kind == "segment":
            from multicorpus_engine.segmenter import resegment_document

            if "doc_id" not in params:
                raise ValueError("segment job expects params.doc_id")
            doc_id = int(params["doc_id"])
            lang = str(params.get("lang", "und"))

            progress_cb(10, "Resegmenting document")
            with lock:
                report = resegment_document(conn, doc_id=doc_id, lang=lang)
            progress_cb(100, "Segmentation completed")
            return {"fts_stale": True, **report.to_dict()}

        raise ValueError(f"Unsupported job kind: {kind!r}")

    @property
    def actual_port(self) -> int:
        """The port the server is listening on (discovered after ``start()``)."""
        if self._httpd is not None:
            return self._httpd.server_address[1]
        return self._port
