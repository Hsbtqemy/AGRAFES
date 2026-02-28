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

import datetime as dt
import json
import logging
import os
import secrets
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from urllib.error import URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from .sidecar_contract import (
    ERR_BAD_REQUEST,
    ERR_INTERNAL,
    ERR_NOT_FOUND,
    ERR_UNAUTHORIZED,
    ERR_VALIDATION,
    error_payload,
    openapi_spec,
    success_payload,
)
from .sidecar_jobs import JobManager
from . import __version__ as ENGINE_VERSION

logger = logging.getLogger(__name__)


def sidecar_portfile_path(db_path: str | Path) -> Path:
    """Return sidecar discovery file path for a given DB path."""
    return Path(db_path).resolve().parent / ".agrafes_sidecar.json"


def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _health_check(host: str, port: int, timeout: float = 0.6) -> tuple[bool, dict | None]:
    url = f"http://{host}:{port}/health"
    req = Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw)
            if (
                resp.status == 200
                and isinstance(payload, dict)
                and payload.get("ok") is True
                and payload.get("status") == "ok"
            ):
                return True, payload
            return False, payload if isinstance(payload, dict) else None
    except (URLError, OSError, json.JSONDecodeError, ValueError):
        return False, None


def inspect_sidecar_state(db_path: str | Path, timeout: float = 0.6) -> dict:
    """Inspect sidecar state for a DB based on portfile, PID and /health."""
    resolved_db = Path(db_path).resolve()
    portfile = sidecar_portfile_path(resolved_db)
    base = {
        "state": "missing",
        "portfile": str(portfile),
        "db_path": str(resolved_db),
        "token_required": False,
    }
    if not portfile.exists():
        return base

    try:
        payload = json.loads(portfile.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            **base,
            "state": "stale",
            "reason": "invalid_portfile_json",
            "error": str(exc),
        }

    if not isinstance(payload, dict):
        return {
            **base,
            "state": "stale",
            "reason": "invalid_portfile_shape",
        }

    host = payload.get("host")
    if not isinstance(host, str) or not host:
        host = "127.0.0.1"
    port = payload.get("port")
    pid = payload.get("pid")
    token = payload.get("token")
    token_required = isinstance(token, str) and bool(token)

    if not isinstance(port, int) or port <= 0 or port > 65535:
        return {
            **base,
            "state": "stale",
            "reason": "invalid_port",
            "host": host,
            "port": port,
            "pid": pid,
            "token_required": token_required,
        }

    pid_alive = isinstance(pid, int) and _pid_is_alive(pid)
    health_ok, health_payload = _health_check(host, port, timeout=timeout)

    if pid_alive and health_ok:
        return {
            **base,
            "state": "running",
            "host": host,
            "port": port,
            "pid": pid,
            "started_at": payload.get("started_at"),
            "token_required": token_required,
            "token": token if token_required else None,
            "health": health_payload,
            "pid_alive": True,
            "health_ok": True,
        }

    return {
        **base,
        "state": "stale",
        "reason": "unreachable_or_dead",
        "host": host,
        "port": port,
        "pid": pid,
        "started_at": payload.get("started_at"),
        "token_required": token_required,
        "token": token if token_required else None,
        "pid_alive": pid_alive,
        "health_ok": health_ok,
    }


def resolve_token_mode(token_mode: str) -> str | None:
    mode = (token_mode or "auto").strip()
    if mode == "off":
        return None
    if mode == "auto":
        return secrets.token_urlsafe(24)
    if not mode:
        raise ValueError("Token mode must be one of: auto, off, or a non-empty token string")
    return mode


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

    def _token(self) -> str | None:
        token = getattr(self.server, "token", None)
        if isinstance(token, str) and token:
            return token
        return None

    def _require_token_for_write(self) -> bool:
        expected = self._token()
        if expected is None:
            return True
        provided = self.headers.get("X-Agrafes-Token")
        if provided != expected:
            self._send_error(
                "Missing or invalid X-Agrafes-Token",
                code=ERR_UNAUTHORIZED,
                http_status=401,
            )
            return False
        return True

    def _create_run(self, kind: str, params: dict) -> str:
        from multicorpus_engine.runs import create_run

        return create_run(self._conn(), kind, params)

    def _update_run_stats(self, run_id: str, stats: dict) -> None:
        from multicorpus_engine.runs import update_run_stats

        update_run_stats(self._conn(), run_id, stats)

    # ------------------------------------------------------------------
    # GET
    # ------------------------------------------------------------------

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._send_json(success_payload({
                "version": ENGINE_VERSION,
                "pid": getattr(self.server, "pid", os.getpid()),
                "started_at": getattr(self.server, "started_at", None),
                "host": getattr(self.server, "host", "127.0.0.1"),
                "port": getattr(self.server, "port", None),
                "portfile": getattr(self.server, "portfile", None),
                "token_required": bool(self._token()),
            }))
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

            if path in {"/index", "/import", "/shutdown"} and not self._require_token_for_write():
                return

            if path == "/query":
                self._handle_query(body)
            elif path == "/index":
                self._handle_index()
            elif path == "/import":
                self._handle_import(body)
            elif path == "/curate":
                self._handle_curate(body)
            elif path == "/validate-meta":
                self._handle_validate_meta(body)
            elif path == "/segment":
                self._handle_segment(body)
            elif path == "/shutdown":
                self._handle_shutdown()
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

        params = {
            "q": body.get("q", ""),
            "mode": body.get("mode", "segment"),
            "window": body.get("window", 10),
            "language": body.get("language"),
            "doc_id": body.get("doc_id"),
            "resource_type": body.get("resource_type"),
            "doc_role": body.get("doc_role"),
            "include_aligned": body.get("include_aligned", False),
            "all_occurrences": body.get("all_occurrences", False),
        }
        with self._lock():
            run_id = self._create_run("query", params)
            hits = run_query(
                conn=self._conn(),
                q=params["q"],
                mode=params["mode"],
                window=params["window"],
                language=params["language"],
                doc_id=params["doc_id"],
                resource_type=params["resource_type"],
                doc_role=params["doc_role"],
                include_aligned=params["include_aligned"],
                all_occurrences=params["all_occurrences"],
            )
            self._update_run_stats(run_id, {"count": len(hits)})
        self._send_json(success_payload({"run_id": run_id, "count": len(hits), "hits": hits}))

    def _handle_index(self) -> None:
        from multicorpus_engine.indexer import build_index

        with self._lock():
            run_id = self._create_run("index", {})
            count = build_index(self._conn())
            self._update_run_stats(run_id, {"units_indexed": count})
        self._send_json(success_payload({"run_id": run_id, "units_indexed": count}))

    def _handle_import(self, body: dict) -> None:
        mode = body.get("mode")
        path = body.get("path")
        language = body.get("language")
        title = body.get("title")
        doc_role = body.get("doc_role", "standalone")
        resource_type = body.get("resource_type")
        tei_unit = body.get("tei_unit", "p")

        if not isinstance(mode, str) or not mode:
            self._send_error(
                "mode is required and must be a string",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return
        if not isinstance(path, str) or not path:
            self._send_error(
                "path is required and must be a string",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return
        if mode != "tei" and (not isinstance(language, str) or not language):
            self._send_error(
                "language is required for non-TEI import modes",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return

        params = {
            "mode": mode,
            "path": path,
            "language": language,
            "title": title,
            "doc_role": doc_role,
            "resource_type": resource_type,
            "tei_unit": tei_unit,
        }

        try:
            with self._lock():
                run_id = self._create_run("import", params)
                if mode == "docx_numbered_lines":
                    from multicorpus_engine.importers.docx_numbered_lines import import_docx_numbered_lines
                    report = import_docx_numbered_lines(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        run_id=run_id,
                    )
                elif mode == "txt_numbered_lines":
                    from multicorpus_engine.importers.txt import import_txt_numbered_lines
                    report = import_txt_numbered_lines(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        run_id=run_id,
                    )
                elif mode == "docx_paragraphs":
                    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
                    report = import_docx_paragraphs(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        run_id=run_id,
                    )
                elif mode == "tei":
                    from multicorpus_engine.importers.tei_importer import import_tei
                    report = import_tei(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        unit_element=tei_unit,
                        run_id=run_id,
                    )
                else:
                    self._send_error(
                        f"Unsupported import mode: {mode!r}",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return

                stats = report.to_dict()
                self._update_run_stats(run_id, stats)
        except FileNotFoundError as exc:
            self._send_error(
                str(exc),
                code=ERR_VALIDATION,
                http_status=400,
            )
            return
        except ValueError as exc:
            self._send_error(
                str(exc),
                code=ERR_VALIDATION,
                http_status=400,
            )
            return

        self._send_json(success_payload({
            "run_id": run_id,
            "mode": mode,
            **stats,
        }))

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

    def _handle_shutdown(self) -> None:
        self._send_json(success_payload({
            "message": "Shutdown requested",
            "shutting_down": True,
        }))
        request_shutdown = getattr(self.server, "request_shutdown", None)
        if callable(request_shutdown):
            threading.Thread(
                target=request_shutdown,
                daemon=True,
                name="SidecarShutdown",
            ).start()


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
        token: str | None = None,
    ) -> None:
        self._db_path = Path(db_path)
        self._host = host
        self._port = port
        self._token = token if token else None
        self._conn: Optional[sqlite3.Connection] = None
        self._httpd: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._jobs = JobManager()
        self._pid = os.getpid()
        self._started_at: Optional[str] = None
        self._portfile_path = sidecar_portfile_path(self._db_path)
        self._shutdown_lock = threading.Lock()
        self._is_shutdown = False

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
        self._started_at = utcnow_iso()
        self._httpd.conn = self._conn  # type: ignore[attr-defined]
        self._httpd.lock = threading.Lock()  # type: ignore[attr-defined]
        self._httpd.jobs = self._jobs  # type: ignore[attr-defined]
        self._httpd.job_runner = self._run_async_job  # type: ignore[attr-defined]
        self._httpd.pid = self._pid  # type: ignore[attr-defined]
        self._httpd.started_at = self._started_at  # type: ignore[attr-defined]
        self._httpd.host = self._host  # type: ignore[attr-defined]
        self._httpd.port = self.actual_port  # type: ignore[attr-defined]
        self._httpd.db_path = str(self._db_path)  # type: ignore[attr-defined]
        self._httpd.portfile = str(self._portfile_path)  # type: ignore[attr-defined]
        self._httpd.token = self._token  # type: ignore[attr-defined]
        self._httpd.request_shutdown = self.request_shutdown  # type: ignore[attr-defined]

        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            daemon=True,
            name="CorpusServer",
        )
        self._thread.start()
        self._write_portfile()
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
        with self._shutdown_lock:
            if self._is_shutdown:
                return
            self._is_shutdown = True

            if self._httpd is not None:
                try:
                    self._httpd.shutdown()
                finally:
                    self._httpd.server_close()

            if (
                self._thread is not None
                and self._thread.is_alive()
                and threading.current_thread() is not self._thread
            ):
                self._thread.join(timeout=5.0)

            if self._conn is not None:
                self._conn.close()
                self._conn = None

            self._remove_portfile()
            logger.info("CorpusServer stopped")

    def request_shutdown(self) -> None:
        """Request graceful shutdown (safe to call from handler context)."""
        self.shutdown()

    def _write_portfile(self) -> None:
        payload = {
            "host": self._host,
            "port": self.actual_port,
            "pid": self._pid,
            "started_at": self._started_at,
            "db_path": str(self._db_path),
        }
        if self._token:
            payload["token"] = self._token
        self._portfile_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _remove_portfile(self) -> None:
        try:
            if self._portfile_path.exists():
                self._portfile_path.unlink()
        except OSError:
            logger.warning("Failed to remove sidecar portfile: %s", self._portfile_path)

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

    @property
    def pid(self) -> int:
        return self._pid

    @property
    def started_at(self) -> Optional[str]:
        return self._started_at

    @property
    def portfile_path(self) -> Path:
        return self._portfile_path

    @property
    def token(self) -> str | None:
        return self._token
