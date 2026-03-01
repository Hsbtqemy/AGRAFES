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
                        resource_type?, doc_role?, include_aligned?,
                        aligned_limit?, all_occurrences?, limit?, offset?}
POST /index          → build_index; body: {}
POST /curate         → curate; body: {rules: [...], doc_id?: int}
POST /validate-meta  → validate; body: {doc_id?: int}
POST /segment        → resegment_document; body: {doc_id: int, lang?: str, pack?: str}
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

    def _create_run(self, kind: str, params: dict, run_id: str | None = None) -> str:
        from multicorpus_engine.runs import create_run

        return create_run(self._conn(), kind, params, run_id=run_id)

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
        elif path == "/documents":
            self._handle_documents()
        elif path == "/doc_relations":
            self._handle_doc_relations_get()
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

            _write_paths = {
                "/index", "/import", "/shutdown",
                "/documents/update", "/documents/bulk_update",
                "/doc_relations/set", "/doc_relations/delete",
                "/export/tei", "/export/align_csv", "/export/run_report",
                "/align/link/update_status", "/align/link/delete", "/align/link/retarget",
                "/jobs/enqueue",
            }
            # /jobs/<uuid>/cancel is also a write path (token required)
            _is_cancel = (
                path.startswith("/jobs/")
                and path.endswith("/cancel")
                and path.count("/") == 3
            )
            if (path in _write_paths or _is_cancel) and not self._require_token_for_write():
                return

            if path == "/query":
                self._handle_query(body)
            elif path == "/index":
                self._handle_index()
            elif path == "/import":
                self._handle_import(body)
            elif path == "/curate":
                self._handle_curate(body)
            elif path == "/curate/preview":
                self._handle_curate_preview(body)
            elif path == "/align/audit":
                self._handle_align_audit(body)
            elif path == "/align/quality":
                self._handle_align_quality(body)
            elif path == "/align/link/update_status":
                self._handle_align_link_update_status(body)
            elif path == "/align/link/delete":
                self._handle_align_link_delete(body)
            elif path == "/align/link/retarget":
                self._handle_align_link_retarget(body)
            elif path == "/validate-meta":
                self._handle_validate_meta(body)
            elif path == "/segment":
                self._handle_segment(body)
            elif path == "/align":
                self._handle_align(body)
            elif path == "/documents/update":
                self._handle_documents_update(body)
            elif path == "/documents/bulk_update":
                self._handle_documents_bulk_update(body)
            elif path == "/doc_relations/set":
                self._handle_doc_relations_set(body)
            elif path == "/doc_relations/delete":
                self._handle_doc_relations_delete(body)
            elif path == "/export/tei":
                self._handle_export_tei(body)
            elif path == "/export/align_csv":
                self._handle_export_align_csv(body)
            elif path == "/export/run_report":
                self._handle_export_run_report(body)
            elif path == "/shutdown":
                self._handle_shutdown()
            elif path == "/jobs":
                self._handle_job_submit(body)
            elif path == "/jobs/enqueue":
                self._handle_jobs_enqueue(body)
            elif _is_cancel:
                self._handle_job_cancel(path)
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
        from urllib.parse import parse_qs, urlparse as _up
        qs = parse_qs(_up(self.path).query)
        status_filter = (qs.get("status") or [None])[0]
        try:
            limit = int((qs.get("limit") or [100])[0])
            offset = int((qs.get("offset") or [0])[0])
        except (ValueError, TypeError):
            limit, offset = 100, 0
        limit = max(1, min(limit, 200))
        offset = max(0, offset)

        all_jobs = self._jobs().list()
        if status_filter:
            all_jobs = [j for j in all_jobs if j.status == status_filter]
        total = len(all_jobs)
        page = all_jobs[offset: offset + limit]
        has_more = offset + limit < total
        next_offset = offset + limit if has_more else None

        self._send_json(success_payload({
            "jobs": [j.to_dict() for j in page],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
            "next_offset": next_offset,
        }))

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
            if "pack" in params and params["pack"] is not None and not isinstance(params["pack"], str):
                self._send_error(
                    "segment params.pack must be a string when provided",
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

    def _handle_jobs_enqueue(self, body: dict) -> None:
        """POST /jobs/enqueue — token-protected; supports all job kinds including import/align/exports."""
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
            self._send_error("params must be a JSON object", code=ERR_VALIDATION, http_status=400)
            return

        supported = {
            "index", "curate", "validate-meta", "segment",
            "import", "align", "export_tei", "export_align_csv", "export_run_report",
        }
        if kind not in supported:
            self._send_error(
                f"Unsupported job kind: {kind!r}",
                code=ERR_VALIDATION,
                http_status=400,
                details={"supported_kinds": sorted(supported)},
            )
            return

        # Kind-specific param validation
        if kind == "segment" and "doc_id" not in params:
            self._send_error("segment job requires params.doc_id", code=ERR_VALIDATION, http_status=400)
            return
        if kind == "segment":
            try:
                int(params.get("doc_id"))
            except (TypeError, ValueError):
                self._send_error("segment params.doc_id must be an integer", code=ERR_VALIDATION, http_status=400)
                return
            if "pack" in params and params["pack"] is not None and not isinstance(params["pack"], str):
                self._send_error("segment params.pack must be a string", code=ERR_VALIDATION, http_status=400)
                return
        if kind == "curate" and not isinstance(params.get("rules"), list):
            self._send_error("curate job requires params.rules (array)", code=ERR_VALIDATION, http_status=400)
            return
        if kind == "import" and (not params.get("mode") or not params.get("path")):
            self._send_error("import job requires params.mode and params.path", code=ERR_VALIDATION, http_status=400)
            return
        if kind == "align" and (params.get("pivot_doc_id") is None or not params.get("target_doc_ids")):
            self._send_error(
                "align job requires params.pivot_doc_id and params.target_doc_ids",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return
        if kind == "align":
            try:
                int(params.get("pivot_doc_id"))
                target_ids = params.get("target_doc_ids")
                if not isinstance(target_ids, list) or not target_ids:
                    raise ValueError
                [int(t) for t in target_ids]
            except (TypeError, ValueError):
                self._send_error(
                    "align params.pivot_doc_id and params.target_doc_ids must be integer values",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            strategy = params.get("strategy", "external_id")
            allowed_strategies = {"external_id", "position", "similarity", "external_id_then_position"}
            if strategy not in allowed_strategies:
                self._send_error(
                    f"Unsupported align strategy: {strategy!r}",
                    code=ERR_VALIDATION,
                    http_status=400,
                    details={"supported_strategies": sorted(allowed_strategies)},
                )
                return
            if strategy == "similarity":
                try:
                    threshold = float(params.get("sim_threshold", 0.8))
                except (TypeError, ValueError):
                    self._send_error(
                        "align params.sim_threshold must be a number in [0.0, 1.0]",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
                if threshold < 0.0 or threshold > 1.0:
                    self._send_error(
                        "align params.sim_threshold must be in [0.0, 1.0]",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
            if "debug_align" in params and not isinstance(params.get("debug_align"), bool):
                self._send_error(
                    "align params.debug_align must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if "run_id" in params:
                run_id_val = params.get("run_id")
                if not isinstance(run_id_val, str) or not run_id_val.strip():
                    self._send_error(
                        "align params.run_id must be a non-empty string when provided",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
        if kind in ("export_tei",) and not params.get("out_dir"):
            self._send_error("export_tei job requires params.out_dir", code=ERR_VALIDATION, http_status=400)
            return
        if kind in ("export_align_csv", "export_run_report") and not params.get("out_path"):
            self._send_error(f"{kind} job requires params.out_path", code=ERR_VALIDATION, http_status=400)
            return

        job = self._jobs().submit(
            kind=kind,
            params=params,
            runner=self.server.job_runner,  # type: ignore[attr-defined]
        )
        self._send_json(success_payload({"job": job.to_dict()}, status="accepted"), status=202)

    def _handle_job_cancel(self, path: str) -> None:
        """POST /jobs/{job_id}/cancel — idempotent; best-effort for running jobs."""
        # path is /jobs/<job_id>/cancel
        parts = path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "jobs" or parts[2] != "cancel":
            self._send_error("Invalid cancel path", code=ERR_BAD_REQUEST, http_status=400)
            return
        job_id = parts[1].strip()
        if not job_id:
            self._send_error("job_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        result = self._jobs().cancel(job_id)
        if result is None:
            self._send_error(f"Unknown job_id: {job_id}", code=ERR_NOT_FOUND, http_status=404)
            return
        self._send_json(success_payload({"job_id": job_id, "status": result}))

    # ------------------------------------------------------------------
    # Route implementations
    # ------------------------------------------------------------------

    def _handle_query(self, body: dict) -> None:
        from multicorpus_engine.query import run_query_page

        raw_aligned_limit = body.get("aligned_limit", 20)
        aligned_limit: int | None
        if raw_aligned_limit is None:
            aligned_limit = None
        else:
            try:
                aligned_limit = int(raw_aligned_limit)
            except (TypeError, ValueError) as exc:
                raise ValueError("aligned_limit must be an integer >= 1 or null") from exc
            if aligned_limit < 1:
                raise ValueError("aligned_limit must be >= 1")

        raw_limit = body.get("limit", 50)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError) as exc:
            raise ValueError("limit must be an integer") from exc
        if limit < 1 or limit > 200:
            raise ValueError("limit must be in [1, 200]")

        raw_offset = body.get("offset", 0)
        try:
            offset = int(raw_offset)
        except (TypeError, ValueError) as exc:
            raise ValueError("offset must be an integer >= 0") from exc
        if offset < 0:
            raise ValueError("offset must be >= 0")

        params = {
            "q": body.get("q", ""),
            "mode": body.get("mode", "segment"),
            "window": body.get("window", 10),
            "language": body.get("language"),
            "doc_id": body.get("doc_id"),
            "resource_type": body.get("resource_type"),
            "doc_role": body.get("doc_role"),
            "include_aligned": body.get("include_aligned", False),
            "aligned_limit": aligned_limit,
            "all_occurrences": body.get("all_occurrences", False),
            "limit": limit,
            "offset": offset,
        }
        with self._lock():
            run_id = self._create_run("query", params)
            page = run_query_page(
                conn=self._conn(),
                q=params["q"],
                mode=params["mode"],
                window=params["window"],
                language=params["language"],
                doc_id=params["doc_id"],
                resource_type=params["resource_type"],
                doc_role=params["doc_role"],
                include_aligned=params["include_aligned"],
                aligned_limit=params["aligned_limit"],
                all_occurrences=params["all_occurrences"],
                limit=params["limit"],
                offset=params["offset"],
            )
            hits = page["hits"]
            self._update_run_stats(
                run_id,
                {
                    "count": len(hits),
                    "offset": page["offset"],
                    "limit": page["limit"],
                    "has_more": page["has_more"],
                    "next_offset": page["next_offset"],
                },
            )
        self._send_json(success_payload({
            "run_id": run_id,
            "count": len(hits),
            "hits": hits,
            "limit": page["limit"],
            "offset": page["offset"],
            "next_offset": page["next_offset"],
            "has_more": page["has_more"],
            "total": page["total"],
        }))

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

    def _handle_curate_preview(self, body: dict) -> None:
        """Read-only curation simulation — never writes to DB."""
        import re as _re
        from multicorpus_engine.curation import rules_from_list

        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error(
                "doc_id is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        limit_examples = int(body.get("limit_examples", 10))
        limit_examples = max(1, min(limit_examples, 50))

        try:
            rules = rules_from_list(body.get("rules", []))
        except ValueError as exc:
            self._send_error(str(exc), code=ERR_VALIDATION, http_status=400)
            return

        if not rules:
            self._send_json(success_payload({
                "doc_id": doc_id,
                "stats": {"units_total": 0, "units_changed": 0, "replacements_total": 0},
                "examples": [],
                "fts_stale": False,
            }))
            return

        rows = self._conn().execute(
            "SELECT unit_id, external_id, text_norm FROM units WHERE doc_id = ? ORDER BY n",
            (doc_id,),
        ).fetchall()

        units_total = len(rows)
        units_changed = 0
        replacements_total = 0
        examples: list[dict] = []

        for row in rows:
            original = row[2] or ""
            curated = original
            unit_reps = 0
            for rule in rules:
                curated, n = _re.subn(rule.pattern, rule.replacement, curated, flags=rule.flags)
                unit_reps += n
            if curated != original:
                units_changed += 1
                replacements_total += unit_reps
                if len(examples) < limit_examples:
                    examples.append({
                        "unit_id": row[0],
                        "external_id": row[1],
                        "before": original,
                        "after": curated,
                    })

        self._send_json(success_payload({
            "doc_id": doc_id,
            "stats": {
                "units_total": units_total,
                "units_changed": units_changed,
                "replacements_total": replacements_total,
            },
            "examples": examples,
            "fts_stale": False,
        }))

    def _handle_align_audit(self, body: dict) -> None:
        """Read-only audit of alignment_links for a pivot↔target pair."""
        pivot_doc_id = body.get("pivot_doc_id")
        target_doc_id = body.get("target_doc_id")
        if pivot_doc_id is None or target_doc_id is None:
            self._send_error(
                "pivot_doc_id and target_doc_id are required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        limit = int(body.get("limit", 50))
        if limit < 1 or limit > 200:
            self._send_error(
                "limit must be between 1 and 200",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        offset = int(body.get("offset", 0))
        if offset < 0:
            self._send_error("offset must be >= 0", code=ERR_BAD_REQUEST, http_status=400)
            return

        external_id_filter = body.get("external_id")
        status_filter = body.get("status")  # None = all, 'accepted', 'rejected', 'unreviewed'

        base_where = "al.pivot_doc_id = ? AND al.target_doc_id = ?"
        params: list = [pivot_doc_id, target_doc_id]
        if external_id_filter is not None:
            base_where += " AND al.external_id = ?"
            params.append(int(external_id_filter))
        if status_filter == "unreviewed":
            base_where += " AND al.status IS NULL"
        elif status_filter in ("accepted", "rejected"):
            base_where += " AND al.status = ?"
            params.append(status_filter)

        rows = self._conn().execute(
            f"""
            SELECT al.link_id, al.external_id, al.pivot_unit_id, al.target_unit_id,
                   pu.text_norm AS pivot_text, tu.text_norm AS target_text,
                   al.status
            FROM alignment_links al
            JOIN units pu ON pu.unit_id = al.pivot_unit_id
            JOIN units tu ON tu.unit_id = al.target_unit_id
            WHERE {base_where}
            ORDER BY al.external_id, al.link_id
            LIMIT ? OFFSET ?
            """,
            params + [limit + 1, offset],
        ).fetchall()

        has_more = len(rows) > limit
        page = rows[:limit]
        next_offset = offset + limit if has_more else None

        links = [
            {
                "link_id": r[0],
                "external_id": r[1],
                "pivot_unit_id": r[2],
                "target_unit_id": r[3],
                "pivot_text": r[4],
                "target_text": r[5],
                "status": r[6],
            }
            for r in page
        ]

        self._send_json(success_payload({
            "pivot_doc_id": pivot_doc_id,
            "target_doc_id": target_doc_id,
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
            "next_offset": next_offset,
            "stats": {"links_returned": len(links)},
            "links": links,
        }))

    def _handle_align_quality(self, body: dict) -> None:
        """Read-only alignment quality metrics for a pivot↔target pair."""
        pivot_doc_id = body.get("pivot_doc_id")
        target_doc_id = body.get("target_doc_id")
        if pivot_doc_id is None or target_doc_id is None:
            self._send_error(
                "pivot_doc_id and target_doc_id are required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        pivot_doc_id = int(pivot_doc_id)
        target_doc_id = int(target_doc_id)
        run_id_filter = body.get("run_id")  # optional: restrict to one align run

        conn = self._conn()

        # Base WHERE for alignment_links
        link_where = "al.pivot_doc_id = ? AND al.target_doc_id = ?"
        link_params: list = [pivot_doc_id, target_doc_id]
        if run_id_filter:
            link_where += " AND al.run_id = ?"
            link_params.append(run_id_filter)

        # ── Aggregate stats (single query) ──────────────────────────────────
        agg = conn.execute(
            f"""
            SELECT
                COUNT(*)                             AS total_links,
                COUNT(DISTINCT al.pivot_unit_id)     AS covered_pivot,
                COUNT(DISTINCT al.target_unit_id)    AS covered_target,
                SUM(CASE WHEN al.status IS NULL     THEN 1 ELSE 0 END) AS n_unreviewed,
                SUM(CASE WHEN al.status='accepted'  THEN 1 ELSE 0 END) AS n_accepted,
                SUM(CASE WHEN al.status='rejected'  THEN 1 ELSE 0 END) AS n_rejected
            FROM alignment_links al
            WHERE {link_where}
            """,
            link_params,
        ).fetchone()

        total_links = agg[0] or 0
        covered_pivot = agg[1] or 0
        covered_target = agg[2] or 0
        n_unreviewed = agg[3] or 0
        n_accepted = agg[4] or 0
        n_rejected = agg[5] or 0

        # ── Doc unit counts ──────────────────────────────────────────────────
        total_pivot = conn.execute(
            "SELECT COUNT(*) FROM units WHERE doc_id = ?", (pivot_doc_id,)
        ).fetchone()[0] or 0
        total_target = conn.execute(
            "SELECT COUNT(*) FROM units WHERE doc_id = ?", (target_doc_id,)
        ).fetchone()[0] or 0

        coverage_pct = round(covered_pivot / total_pivot * 100, 2) if total_pivot > 0 else 0.0
        orphan_pivot = total_pivot - covered_pivot
        orphan_target = total_target - covered_target

        # ── Collision count: pivot_unit_id appearing in >1 link ─────────────
        collision_row = conn.execute(
            f"""
            SELECT COUNT(*) FROM (
                SELECT pivot_unit_id
                FROM alignment_links al
                WHERE {link_where}
                GROUP BY pivot_unit_id
                HAVING COUNT(*) > 1
            )
            """,
            link_params,
        ).fetchone()
        collision_count = collision_row[0] if collision_row else 0

        # ── Sample orphan pivot units (first 5 with no link for this pair) ──
        sample_orphan_pivot = [
            {"unit_id": r[0], "external_id": r[1], "text": r[2]}
            for r in conn.execute(
                f"""
                SELECT u.unit_id, u.external_id, u.text_norm
                FROM units u
                WHERE u.doc_id = ?
                  AND u.unit_id NOT IN (
                      SELECT al.pivot_unit_id FROM alignment_links al
                      WHERE {link_where}
                  )
                ORDER BY u.unit_id
                LIMIT 5
                """,
                [pivot_doc_id] + link_params,
            ).fetchall()
        ]

        # ── Sample orphan target units ───────────────────────────────────────
        sample_orphan_target = [
            {"unit_id": r[0], "external_id": r[1], "text": r[2]}
            for r in conn.execute(
                f"""
                SELECT u.unit_id, u.external_id, u.text_norm
                FROM units u
                WHERE u.doc_id = ?
                  AND u.unit_id NOT IN (
                      SELECT al.target_unit_id FROM alignment_links al
                      WHERE {link_where}
                  )
                ORDER BY u.unit_id
                LIMIT 5
                """,
                [target_doc_id] + link_params,
            ).fetchall()
        ]

        self._send_json(success_payload({
            "pivot_doc_id": pivot_doc_id,
            "target_doc_id": target_doc_id,
            "run_id": run_id_filter,
            "stats": {
                "total_pivot_units": total_pivot,
                "total_target_units": total_target,
                "total_links": total_links,
                "covered_pivot_units": covered_pivot,
                "covered_target_units": covered_target,
                "coverage_pct": coverage_pct,
                "orphan_pivot_count": orphan_pivot,
                "orphan_target_count": orphan_target,
                "collision_count": collision_count,
                "status_counts": {
                    "unreviewed": n_unreviewed,
                    "accepted": n_accepted,
                    "rejected": n_rejected,
                },
            },
            "sample_orphan_pivot": sample_orphan_pivot,
            "sample_orphan_target": sample_orphan_target,
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
        try:
            doc_id = int(doc_id)
        except (TypeError, ValueError):
            self._send_error(
                "doc_id must be an integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        pack = body.get("pack", "auto")
        if pack is not None and not isinstance(pack, str):
            self._send_error(
                "pack must be a string when provided",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        lang = body.get("lang", "und")
        if lang is not None and not isinstance(lang, str):
            self._send_error(
                "lang must be a string when provided",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        with self._lock():
            report = resegment_document(
                self._conn(),
                doc_id=doc_id,
                lang=lang or "und",
                pack=pack,
            )
        self._send_json(success_payload({"fts_stale": True, **report.to_dict()}))

    def _handle_documents(self) -> None:
        rows = self._conn().execute(
            """
            SELECT d.doc_id, d.title, d.language, d.doc_role, d.resource_type,
                   COUNT(u.unit_id) AS unit_count
            FROM documents d
            LEFT JOIN units u ON u.doc_id = d.doc_id AND u.unit_type = 'line'
            GROUP BY d.doc_id
            ORDER BY d.doc_id
            """
        ).fetchall()
        documents = [
            {
                "doc_id": r[0],
                "title": r[1],
                "language": r[2],
                "doc_role": r[3],
                "resource_type": r[4],
                "unit_count": r[5],
            }
            for r in rows
        ]
        self._send_json(success_payload({"documents": documents, "count": len(documents)}))

    def _handle_align(self, body: dict) -> None:
        from multicorpus_engine.aligner import (
            align_by_external_id,
            align_by_external_id_then_position,
            align_by_position,
            align_by_similarity,
        )

        pivot_doc_id = body.get("pivot_doc_id")
        target_doc_ids = body.get("target_doc_ids")
        if pivot_doc_id is None or not target_doc_ids:
            self._send_error(
                "pivot_doc_id and target_doc_ids (non-empty list) are required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if not isinstance(target_doc_ids, list):
            self._send_error(
                "target_doc_ids must be a list of integers",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        try:
            pivot_doc_id = int(pivot_doc_id)
            target_doc_ids = [int(t) for t in target_doc_ids]
        except (TypeError, ValueError):
            self._send_error(
                "pivot_doc_id and target_doc_ids must be integers",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        strategy = body.get("strategy", "external_id")
        allowed_strategies = {"external_id", "position", "similarity", "external_id_then_position"}
        if strategy not in allowed_strategies:
            self._send_error(
                f"Unsupported align strategy: {strategy!r}",
                code=ERR_BAD_REQUEST,
                http_status=400,
                details={"supported_strategies": sorted(allowed_strategies)},
            )
            return
        raw_debug_align = body.get("debug_align", False)
        if not isinstance(raw_debug_align, bool):
            self._send_error(
                "debug_align must be a boolean",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        debug_align = raw_debug_align
        requested_run_id = body.get("run_id")
        if requested_run_id is not None:
            if not isinstance(requested_run_id, str) or not requested_run_id.strip():
                self._send_error(
                    "run_id must be a non-empty string when provided",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return
            requested_run_id = requested_run_id.strip()
        threshold = 0.8
        if strategy == "similarity":
            try:
                threshold = float(body.get("sim_threshold", 0.8))
            except (TypeError, ValueError):
                self._send_error(
                    "sim_threshold must be a number in [0.0, 1.0]",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return
            if threshold < 0.0 or threshold > 1.0:
                self._send_error(
                    "sim_threshold must be in [0.0, 1.0]",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return

        run_params: dict[str, object] = {
            "pivot_doc_id": pivot_doc_id,
            "target_doc_ids": target_doc_ids,
            "strategy": strategy,
            "debug_align": debug_align,
        }
        if "relation_type" in body and body.get("relation_type") is not None:
            run_params["relation_type"] = body.get("relation_type")
        if strategy == "similarity":
            run_params["sim_threshold"] = threshold

        with self._lock():
            run_id = self._create_run("align", run_params, run_id=requested_run_id)
            if strategy == "position":
                reports = align_by_position(
                    self._conn(),
                    pivot_doc_id=pivot_doc_id,
                    target_doc_ids=target_doc_ids,
                    run_id=run_id,
                    debug=debug_align,
                )
            elif strategy == "similarity":
                reports = align_by_similarity(
                    self._conn(),
                    pivot_doc_id=pivot_doc_id,
                    target_doc_ids=target_doc_ids,
                    run_id=run_id,
                    threshold=threshold,
                    debug=debug_align,
                )
            elif strategy == "external_id_then_position":
                reports = align_by_external_id_then_position(
                    self._conn(),
                    pivot_doc_id=pivot_doc_id,
                    target_doc_ids=target_doc_ids,
                    run_id=run_id,
                    debug=debug_align,
                )
            else:
                reports = align_by_external_id(
                    self._conn(),
                    pivot_doc_id=pivot_doc_id,
                    target_doc_ids=target_doc_ids,
                    run_id=run_id,
                    debug=debug_align,
                )
            total_links = sum(r.links_created for r in reports)
            self._update_run_stats(
                run_id,
                {
                    "strategy": strategy,
                    "pivot_doc_id": pivot_doc_id,
                    "target_doc_ids": target_doc_ids,
                    "debug_align": debug_align,
                    "total_links_created": total_links,
                    "pairs": [r.to_dict() for r in reports],
                },
            )

        self._send_json(success_payload({
            "run_id": run_id,
            "strategy": strategy,
            "pivot_doc_id": pivot_doc_id,
            "debug_align": debug_align,
            "total_links_created": total_links,
            "reports": [r.to_dict() for r in reports],
        }))

    # ------------------------------------------------------------------
    # V0.4A — Metadata panel
    # ------------------------------------------------------------------

    def _handle_doc_relations_get(self) -> None:
        from urllib.parse import parse_qs, urlparse as _up
        qs = parse_qs(_up(self.path).query)
        doc_id_str = (qs.get("doc_id") or [None])[0]
        if doc_id_str is None:
            self._send_error("doc_id query param is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            doc_id = int(doc_id_str)
        except ValueError:
            self._send_error("doc_id must be an integer", code=ERR_BAD_REQUEST, http_status=400)
            return
        rows = self._conn().execute(
            "SELECT id, doc_id, relation_type, target_doc_id, note, created_at FROM doc_relations WHERE doc_id = ? ORDER BY id",
            (doc_id,),
        ).fetchall()
        relations = [
            {"id": r[0], "doc_id": r[1], "relation_type": r[2], "target_doc_id": r[3], "note": r[4], "created_at": r[5]}
            for r in rows
        ]
        self._send_json(success_payload({"doc_id": doc_id, "relations": relations, "count": len(relations)}))

    def _handle_documents_update(self, body: dict) -> None:
        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error("doc_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        allowed = {"title", "language", "doc_role", "resource_type"}
        updates = {k: v for k, v in body.items() if k in allowed}
        if not updates:
            self._send_error("No updatable fields provided (allowed: title, language, doc_role, resource_type)", code=ERR_BAD_REQUEST, http_status=400)
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params = list(updates.values()) + [doc_id]
        with self._lock():
            cur = self._conn().execute(f"UPDATE documents SET {set_clause} WHERE doc_id = ?", params)
            self._conn().commit()
            rows_updated = cur.rowcount
        if rows_updated == 0:
            self._send_error(f"Document doc_id={doc_id} not found", code=ERR_NOT_FOUND, http_status=404)
            return
        row = self._conn().execute(
            "SELECT doc_id, title, language, doc_role, resource_type FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        doc = {"doc_id": row[0], "title": row[1], "language": row[2], "doc_role": row[3], "resource_type": row[4]}
        self._send_json(success_payload({"updated": 1, "doc": doc}))

    def _handle_documents_bulk_update(self, body: dict) -> None:
        updates_list = body.get("updates")
        if not isinstance(updates_list, list) or not updates_list:
            self._send_error("updates must be a non-empty list of {doc_id, ...fields}", code=ERR_BAD_REQUEST, http_status=400)
            return
        allowed = {"title", "language", "doc_role", "resource_type"}
        total_updated = 0
        with self._lock():
            for item in updates_list:
                doc_id = item.get("doc_id")
                if doc_id is None:
                    continue
                fields = {k: v for k, v in item.items() if k in allowed}
                if not fields:
                    continue
                set_clause = ", ".join(f"{k} = ?" for k in fields)
                params = list(fields.values()) + [doc_id]
                cur = self._conn().execute(f"UPDATE documents SET {set_clause} WHERE doc_id = ?", params)
                total_updated += cur.rowcount
            self._conn().commit()
        self._send_json(success_payload({"updated": total_updated}))

    def _handle_doc_relations_set(self, body: dict) -> None:
        doc_id = body.get("doc_id")
        relation_type = body.get("relation_type")
        target_doc_id = body.get("target_doc_id")
        if doc_id is None or not relation_type or target_doc_id is None:
            self._send_error("doc_id, relation_type, and target_doc_id are required", code=ERR_BAD_REQUEST, http_status=400)
            return
        note = body.get("note")
        with self._lock():
            existing = self._conn().execute(
                "SELECT id FROM doc_relations WHERE doc_id = ? AND relation_type = ? AND target_doc_id = ?",
                (doc_id, relation_type, target_doc_id),
            ).fetchone()
            if existing:
                self._conn().execute(
                    "UPDATE doc_relations SET note = ? WHERE id = ?",
                    (note, existing[0]),
                )
                rel_id = existing[0]
                action = "updated"
            else:
                cur = self._conn().execute(
                    "INSERT INTO doc_relations (doc_id, relation_type, target_doc_id, note, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
                    (doc_id, relation_type, target_doc_id, note),
                )
                rel_id = cur.lastrowid
                action = "created"
            self._conn().commit()
        self._send_json(success_payload({"action": action, "id": rel_id, "doc_id": doc_id, "relation_type": relation_type, "target_doc_id": target_doc_id}))

    def _handle_doc_relations_delete(self, body: dict) -> None:
        rel_id = body.get("id")
        if rel_id is None:
            self._send_error("id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        with self._lock():
            cur = self._conn().execute("DELETE FROM doc_relations WHERE id = ?", (rel_id,))
            self._conn().commit()
        self._send_json(success_payload({"deleted": cur.rowcount}))

    # ------------------------------------------------------------------
    # V0.4B — Exports
    # ------------------------------------------------------------------

    def _handle_export_tei(self, body: dict) -> None:
        from multicorpus_engine.exporters.tei import export_tei

        out_dir = body.get("out_dir")
        if not out_dir:
            self._send_error("out_dir is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        doc_ids = body.get("doc_ids")  # list or None (None = all)
        with self._lock():
            if doc_ids is None:
                all_ids = [r[0] for r in self._conn().execute("SELECT doc_id FROM documents ORDER BY doc_id")]
            else:
                all_ids = list(doc_ids)
        out_dir_path = Path(out_dir)
        out_dir_path.mkdir(parents=True, exist_ok=True)
        files_created: list[str] = []
        for doc_id in all_ids:
            out_path = out_dir_path / f"doc_{doc_id}.tei.xml"
            try:
                export_tei(self._conn(), doc_id=doc_id, output_path=out_path)
                files_created.append(str(out_path))
            except Exception as exc:
                logger.warning("TEI export failed for doc_id=%s: %s", doc_id, exc)
        self._send_json(success_payload({"files_created": files_created, "count": len(files_created)}))

    def _handle_export_align_csv(self, body: dict) -> None:
        import csv as _csv

        out_path = body.get("out_path")
        if not out_path:
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        pivot_doc_id = body.get("pivot_doc_id")
        target_doc_id = body.get("target_doc_id")
        delimiter = body.get("delimiter", ",")
        if delimiter not in (",", "\t"):
            delimiter = ","

        where_clauses = []
        params: list = []
        if pivot_doc_id is not None:
            where_clauses.append("al.pivot_doc_id = ?")
            params.append(pivot_doc_id)
        if target_doc_id is not None:
            where_clauses.append("al.target_doc_id = ?")
            params.append(target_doc_id)
        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        rows = self._conn().execute(
            f"""
            SELECT al.link_id, al.external_id, al.pivot_doc_id, al.target_doc_id,
                   al.pivot_unit_id, al.target_unit_id,
                   pu.text_norm AS pivot_text, tu.text_norm AS target_text,
                   al.status
            FROM alignment_links al
            JOIN units pu ON pu.unit_id = al.pivot_unit_id
            JOIN units tu ON tu.unit_id = al.target_unit_id
            {where}
            ORDER BY al.pivot_doc_id, al.target_doc_id, al.external_id
            """,
            params,
        ).fetchall()

        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        fields = ["link_id", "external_id", "pivot_doc_id", "target_doc_id",
                  "pivot_unit_id", "target_unit_id", "pivot_text", "target_text", "status"]
        with open(out, "w", encoding="utf-8", newline="") as f:
            w = _csv.writer(f, delimiter=delimiter)
            w.writerow(fields)
            for r in rows:
                w.writerow(list(r))
        self._send_json(success_payload({"out_path": str(out), "rows_written": len(rows)}))

    def _handle_export_run_report(self, body: dict) -> None:
        import json as _json

        out_path = body.get("out_path")
        fmt = body.get("format", "jsonl")
        if not out_path:
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        run_id = body.get("run_id")
        where = "WHERE run_id = ?" if run_id else ""
        params = [run_id] if run_id else []
        rows = self._conn().execute(
            f"SELECT run_id, kind, params_json, stats_json, created_at FROM runs {where} ORDER BY created_at DESC",
            params,
        ).fetchall()
        records = [
            {
                "run_id": r[0],
                "kind": r[1],
                "params": _json.loads(r[2]) if r[2] else None,
                "stats": _json.loads(r[3]) if r[3] else None,
                "created_at": r[4],
            }
            for r in rows
        ]
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        if fmt == "html":
            html_rows = "".join(
                f"<tr><td>{r['run_id']}</td><td>{r['kind']}</td><td>{r['created_at']}</td>"
                f"<td><pre>{_json.dumps(r['stats'], ensure_ascii=False, indent=2) if r['stats'] else ''}</pre></td></tr>"
                for r in records
            )
            html = (
                "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                "<title>Run Report</title></head><body>"
                "<h1>Run Report</h1>"
                "<table border='1'><tr><th>run_id</th><th>kind</th><th>created_at</th><th>stats</th></tr>"
                f"{html_rows}</table></body></html>"
            )
            out.write_text(html, encoding="utf-8")
        else:
            with open(out, "w", encoding="utf-8") as f:
                for r in records:
                    f.write(_json.dumps(r, ensure_ascii=False) + "\n")
        self._send_json(success_payload({"out_path": str(out), "runs_exported": len(records), "format": fmt}))

    # ------------------------------------------------------------------
    # V0.4C — Alignment link editing
    # ------------------------------------------------------------------

    def _handle_align_link_update_status(self, body: dict) -> None:
        link_id = body.get("link_id")
        status = body.get("status")
        if link_id is None or status is None:
            self._send_error("link_id and status are required", code=ERR_BAD_REQUEST, http_status=400)
            return
        if status not in (None, "accepted", "rejected"):
            self._send_error("status must be 'accepted', 'rejected', or null", code=ERR_VALIDATION, http_status=400)
            return
        with self._lock():
            cur = self._conn().execute(
                "UPDATE alignment_links SET status = ? WHERE link_id = ?", (status, link_id)
            )
            self._conn().commit()
        if cur.rowcount == 0:
            self._send_error(f"link_id={link_id} not found", code=ERR_NOT_FOUND, http_status=404)
            return
        self._send_json(success_payload({"link_id": link_id, "status": status, "updated": 1}))

    def _handle_align_link_delete(self, body: dict) -> None:
        link_id = body.get("link_id")
        if link_id is None:
            self._send_error("link_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        with self._lock():
            cur = self._conn().execute("DELETE FROM alignment_links WHERE link_id = ?", (link_id,))
            self._conn().commit()
        self._send_json(success_payload({"link_id": link_id, "deleted": cur.rowcount}))

    def _handle_align_link_retarget(self, body: dict) -> None:
        link_id = body.get("link_id")
        new_target_unit_id = body.get("new_target_unit_id")
        if link_id is None or new_target_unit_id is None:
            self._send_error("link_id and new_target_unit_id are required", code=ERR_BAD_REQUEST, http_status=400)
            return
        # Check new target exists
        unit = self._conn().execute(
            "SELECT unit_id, doc_id FROM units WHERE unit_id = ?", (new_target_unit_id,)
        ).fetchone()
        if unit is None:
            self._send_error(f"new_target_unit_id={new_target_unit_id} does not exist", code=ERR_NOT_FOUND, http_status=404)
            return
        with self._lock():
            cur = self._conn().execute(
                "UPDATE alignment_links SET target_unit_id = ? WHERE link_id = ?",
                (new_target_unit_id, link_id),
            )
            self._conn().commit()
        if cur.rowcount == 0:
            self._send_error(f"link_id={link_id} not found", code=ERR_NOT_FOUND, http_status=404)
            return
        self._send_json(success_payload({"link_id": link_id, "new_target_unit_id": new_target_unit_id, "updated": 1}))

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
            pack = params.get("pack", "auto")
            if pack is not None and not isinstance(pack, str):
                raise ValueError("segment job expects params.pack to be a string")

            progress_cb(10, "Resegmenting document")
            with lock:
                report = resegment_document(conn, doc_id=doc_id, lang=lang, pack=pack)
            progress_cb(100, "Segmentation completed")
            return {"fts_stale": True, **report.to_dict()}

        if kind == "import":
            from pathlib import Path as _Path

            mode = params.get("mode")
            path_str = params.get("path")
            language = params.get("language") or "und"
            title = params.get("title")
            doc_role = params.get("doc_role", "standalone")
            resource_type = params.get("resource_type")
            tei_unit = params.get("tei_unit", "p")

            if not mode or not path_str:
                raise ValueError("import job requires params.mode and params.path")

            file_path = _Path(path_str)
            progress_cb(5, "Starting import")

            with lock:
                if mode == "docx_numbered_lines":
                    from multicorpus_engine.importers.docx_numbered_lines import (
                        import_docx_numbered_lines,
                    )
                    report = import_docx_numbered_lines(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                    )
                elif mode == "txt_numbered_lines":
                    from multicorpus_engine.importers.txt import import_txt_numbered_lines
                    report = import_txt_numbered_lines(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                    )
                elif mode == "docx_paragraphs":
                    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
                    report = import_docx_paragraphs(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                    )
                elif mode == "tei":
                    from multicorpus_engine.importers.tei_importer import import_tei
                    report = import_tei(
                        conn, path=file_path, language=language if language != "und" else None,
                        title=title, tei_unit=tei_unit,
                        doc_role=doc_role, resource_type=resource_type,
                    )
                else:
                    raise ValueError(f"import job: unsupported mode: {mode!r}")

            progress_cb(100, "Import completed")
            return report.to_dict()

        if kind == "align":
            from multicorpus_engine.aligner import (
                align_by_external_id,
                align_by_external_id_then_position,
                align_by_position,
                align_by_similarity,
            )
            from multicorpus_engine.runs import create_run, update_run_stats

            pivot_doc_id = params.get("pivot_doc_id")
            target_doc_ids = params.get("target_doc_ids", [])
            if pivot_doc_id is None or not target_doc_ids:
                raise ValueError("align job requires params.pivot_doc_id and params.target_doc_ids")

            strategy = params.get("strategy", "external_id")
            allowed_strategies = {"external_id", "position", "similarity", "external_id_then_position"}
            if strategy not in allowed_strategies:
                raise ValueError(
                    f"Unsupported align strategy: {strategy!r}. "
                    f"Supported: {', '.join(sorted(allowed_strategies))}"
                )
            debug_align = bool(params.get("debug_align", False))
            run_id_param = params.get("run_id", f"job-align-{job_id[:8]}")
            if not isinstance(run_id_param, str) or not run_id_param.strip():
                raise ValueError("align job expects params.run_id to be a non-empty string when provided")
            run_id_param = run_id_param.strip()

            progress_cb(10, f"Aligning strategy={strategy}")
            with lock:
                run_params: dict[str, object] = {
                    "pivot_doc_id": int(pivot_doc_id),
                    "target_doc_ids": [int(t) for t in target_doc_ids],
                    "strategy": strategy,
                    "debug_align": debug_align,
                }
                if strategy == "similarity":
                    run_params["sim_threshold"] = float(params.get("sim_threshold", 0.8))
                created_run_id = create_run(conn, "align", run_params, run_id=run_id_param)
                if strategy == "position":
                    reports = align_by_position(
                        conn,
                        pivot_doc_id=int(pivot_doc_id),
                        target_doc_ids=[int(t) for t in target_doc_ids],
                        run_id=created_run_id,
                        debug=debug_align,
                    )
                elif strategy == "similarity":
                    threshold = float(params.get("sim_threshold", 0.8))
                    if threshold < 0.0 or threshold > 1.0:
                        raise ValueError("sim_threshold must be in [0.0, 1.0]")
                    reports = align_by_similarity(
                        conn,
                        pivot_doc_id=int(pivot_doc_id),
                        target_doc_ids=[int(t) for t in target_doc_ids],
                        run_id=created_run_id,
                        threshold=threshold,
                        debug=debug_align,
                    )
                elif strategy == "external_id_then_position":
                    reports = align_by_external_id_then_position(
                        conn,
                        pivot_doc_id=int(pivot_doc_id),
                        target_doc_ids=[int(t) for t in target_doc_ids],
                        run_id=created_run_id,
                        debug=debug_align,
                    )
                else:
                    reports = align_by_external_id(
                        conn,
                        pivot_doc_id=int(pivot_doc_id),
                        target_doc_ids=[int(t) for t in target_doc_ids],
                        run_id=created_run_id,
                        debug=debug_align,
                    )
                total_links = sum(r.links_created for r in reports)
                update_run_stats(
                    conn,
                    created_run_id,
                    {
                        "strategy": strategy,
                        "pivot_doc_id": int(pivot_doc_id),
                        "target_doc_ids": [int(t) for t in target_doc_ids],
                        "debug_align": debug_align,
                        "total_links_created": total_links,
                        "pairs": [r.to_dict() for r in reports],
                    },
                )
            progress_cb(100, "Alignment completed")
            return {
                "run_id": created_run_id,
                "strategy": strategy,
                "pivot_doc_id": pivot_doc_id,
                "debug_align": debug_align,
                "total_links_created": total_links,
                "reports": [r.to_dict() for r in reports],
            }

        if kind == "export_tei":
            from pathlib import Path as _Path
            from multicorpus_engine.exporters.tei import export_tei

            out_dir = params.get("out_dir")
            if not out_dir:
                raise ValueError("export_tei job requires params.out_dir")
            doc_ids = params.get("doc_ids")

            out_path = _Path(out_dir)
            out_path.mkdir(parents=True, exist_ok=True)

            with lock:
                if doc_ids is None:
                    rows = conn.execute("SELECT doc_id FROM documents ORDER BY doc_id").fetchall()
                    doc_ids = [r[0] for r in rows]

            files_created: list[str] = []
            progress_cb(5, "Exporting TEI")
            for i, doc_id in enumerate(doc_ids):
                dest = out_path / f"doc_{doc_id}.xml"
                with lock:
                    export_tei(conn, doc_id=int(doc_id), output_path=dest)
                files_created.append(str(dest))
                pct = 5 + int(90 * (i + 1) / max(len(doc_ids), 1))
                progress_cb(pct, f"Exported {i + 1}/{len(doc_ids)}")
            progress_cb(100, "TEI export completed")
            return {"files_created": files_created, "count": len(files_created)}

        if kind == "export_align_csv":
            import csv as _csv
            from pathlib import Path as _Path

            out_path_str = params.get("out_path")
            if not out_path_str:
                raise ValueError("export_align_csv job requires params.out_path")

            pivot_doc_id = params.get("pivot_doc_id")
            target_doc_id = params.get("target_doc_id")
            delimiter = params.get("delimiter", ",")

            progress_cb(10, "Querying alignment links")
            where_parts: list[str] = []
            sql_params: list = []
            if pivot_doc_id is not None:
                where_parts.append("al.pivot_doc_id = ?")
                sql_params.append(int(pivot_doc_id))
            if target_doc_id is not None:
                where_parts.append("al.target_doc_id = ?")
                sql_params.append(int(target_doc_id))
            where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

            with lock:
                rows = conn.execute(
                    f"""
                    SELECT al.link_id, al.pivot_doc_id, al.target_doc_id,
                           al.external_id, pu.text_norm, tu.text_norm, al.status
                    FROM alignment_links al
                    JOIN units pu ON pu.unit_id = al.pivot_unit_id
                    JOIN units tu ON tu.unit_id = al.target_unit_id
                    {where_clause}
                    ORDER BY al.pivot_doc_id, al.external_id, al.link_id
                    """,
                    sql_params,
                ).fetchall()

            out = _Path(out_path_str)
            out.parent.mkdir(parents=True, exist_ok=True)
            with open(out, "w", encoding="utf-8", newline="") as f:
                writer = _csv.writer(f, delimiter=delimiter)
                writer.writerow(["link_id", "pivot_doc_id", "target_doc_id", "external_id", "pivot_text", "target_text", "status"])
                for row in rows:
                    writer.writerow(list(row))
            progress_cb(100, "CSV export completed")
            return {"out_path": str(out), "rows_written": len(rows)}

        if kind == "export_run_report":
            import json as _json
            from pathlib import Path as _Path

            out_path_str = params.get("out_path")
            if not out_path_str:
                raise ValueError("export_run_report job requires params.out_path")
            fmt = params.get("format", "jsonl")
            run_id_filter = params.get("run_id")

            progress_cb(10, "Fetching run history")
            with lock:
                if run_id_filter:
                    run_rows = conn.execute(
                        "SELECT run_id, kind, params_json, stats_json, created_at FROM runs WHERE run_id = ? ORDER BY created_at",
                        (run_id_filter,),
                    ).fetchall()
                else:
                    run_rows = conn.execute(
                        "SELECT run_id, kind, params_json, stats_json, created_at FROM runs ORDER BY created_at"
                    ).fetchall()

            records = []
            for r in run_rows:
                rec: dict = {
                    "run_id": r[0],
                    "kind": r[1],
                    "created_at": r[4],
                }
                if r[2]:
                    try:
                        rec["params"] = _json.loads(r[2])
                    except Exception:
                        pass
                if r[3]:
                    try:
                        rec["stats"] = _json.loads(r[3])
                    except Exception:
                        rec["stats"] = None
                records.append(rec)

            out = _Path(out_path_str)
            out.parent.mkdir(parents=True, exist_ok=True)
            if fmt == "html":
                rows_html = "".join(
                    f"<tr><td>{r['run_id']}</td><td>{r['kind']}</td><td>{r['status']}</td>"
                    f"<td>{r.get('created_at','')}</td></tr>"
                    for r in records
                )
                html = (
                    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Run Report</title></head><body>"
                    "<table border='1'><tr><th>run_id</th><th>kind</th><th>status</th><th>created_at</th></tr>"
                    f"{rows_html}</table></body></html>"
                )
                out.write_text(html, encoding="utf-8")
            else:
                lines = [_json.dumps(r, ensure_ascii=False) for r in records]
                out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

            progress_cb(100, "Report export completed")
            return {"out_path": str(out), "runs_exported": len(records), "format": fmt}

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
