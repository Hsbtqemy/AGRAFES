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
POST /index          → build/update index; body: {incremental?: bool}
POST /curate         → curate; body: {rules: [...], doc_id?: int}
POST /validate-meta  → validate; body: {doc_id?: int}
POST /segment        → resegment_document; body: {doc_id: int, lang?: str, pack?: str}
GET  /jobs           → list async jobs
GET  /runs           → list persisted runs (SQLite ``runs`` table)
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
from urllib.parse import parse_qs, urlparse

from .sidecar_contract import (
    ERR_BAD_REQUEST,
    ERR_CONFLICT,
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

_DOC_WORKFLOW_STATUSES = {"draft", "review", "validated"}


def sidecar_portfile_path(db_path: str | Path) -> Path:
    """Return sidecar discovery file path for a given DB path."""
    return Path(db_path).resolve().parent / ".agrafes_sidecar.json"


def _find_free_port(host: str = "127.0.0.1") -> int:
    """Pick a free TCP port avoiding Windows-excluded ranges (e.g. 50000-50059).

    Falls back to OS-assigned port (bind to 0) if no port found in safe range.
    """
    import random
    import socket as _socket

    # Query Windows excluded port ranges dynamically when possible
    excluded: list[tuple[int, int]] = []
    try:
        import subprocess
        result = subprocess.run(
            ["netsh", "int", "ipv4", "show", "excludedportrange", "protocol=tcp"],
            capture_output=True, text=True, timeout=3,
        )
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                excluded.append((int(parts[0]), int(parts[1])))
    except Exception:
        # Fallback: common Windows reserved ranges
        excluded = [(50000, 50059), (28385, 28385), (28390, 28390)]

    candidates = list(range(49152, 65501))
    random.shuffle(candidates)
    for port in candidates:
        if any(lo <= port <= hi for lo, hi in excluded):
            continue
        try:
            with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
                s.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
                s.bind((host, port))
                return port
        except OSError:
            continue

    # Ultimate fallback: let the OS pick
    with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (OverflowError, ValueError):
        # Invalid/stale PID value in portfile.
        return False
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    except SystemError as exc:
        # Windows can occasionally surface SystemError from os.kill(pid, 0)
        # with an underlying WinError 87; treat as stale/non-alive so serve
        # can continue instead of aborting startup.
        if os.name == "nt":
            logger.warning(
                "PID liveness check raised SystemError on Windows (pid=%s): %s",
                pid,
                exc,
            )
            return False
        raise
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


def _prepare_alignment_replace(
    conn: sqlite3.Connection,
    *,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    preserve_accepted: bool,
) -> tuple[dict[int, set[tuple[int, int]]], int, int]:
    """Delete previous links before a global recalculation.

    Returns:
        protected_pairs_by_target, deleted_count, preserved_count
    """
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] = {}
    deleted_count = 0
    preserved_count = 0

    for target_doc_id in target_doc_ids:
        protected_pairs: set[tuple[int, int]] = set()
        if preserve_accepted:
            rows = conn.execute(
                """
                SELECT pivot_unit_id, target_unit_id
                FROM alignment_links
                WHERE pivot_doc_id = ? AND target_doc_id = ? AND status = 'accepted'
                """,
                (pivot_doc_id, target_doc_id),
            ).fetchall()
            protected_pairs = {(int(r[0]), int(r[1])) for r in rows}
            preserved_count += len(protected_pairs)
            cur = conn.execute(
                """
                DELETE FROM alignment_links
                WHERE pivot_doc_id = ? AND target_doc_id = ?
                  AND (status IS NULL OR status != 'accepted')
                """,
                (pivot_doc_id, target_doc_id),
            )
        else:
            cur = conn.execute(
                """
                DELETE FROM alignment_links
                WHERE pivot_doc_id = ? AND target_doc_id = ?
                """,
                (pivot_doc_id, target_doc_id),
            )
        deleted_count += int(cur.rowcount or 0)
        protected_pairs_by_target[int(target_doc_id)] = protected_pairs

    conn.commit()
    return protected_pairs_by_target, deleted_count, preserved_count


def _run_alignment_strategy(
    conn: sqlite3.Connection,
    *,
    pivot_doc_id: int,
    target_doc_ids: list[int],
    run_id: str,
    strategy: str,
    debug_align: bool,
    threshold: float = 0.8,
    protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None,
):
    from multicorpus_engine.aligner import (
        align_by_external_id,
        align_by_external_id_then_position,
        align_by_position,
        align_by_similarity,
    )

    if strategy == "position":
        return align_by_position(
            conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_ids=target_doc_ids,
            run_id=run_id,
            debug=debug_align,
            protected_pairs_by_target=protected_pairs_by_target,
        )
    if strategy == "similarity":
        return align_by_similarity(
            conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_ids=target_doc_ids,
            run_id=run_id,
            threshold=threshold,
            debug=debug_align,
            protected_pairs_by_target=protected_pairs_by_target,
        )
    if strategy == "external_id_then_position":
        return align_by_external_id_then_position(
            conn,
            pivot_doc_id=pivot_doc_id,
            target_doc_ids=target_doc_ids,
            run_id=run_id,
            debug=debug_align,
            protected_pairs_by_target=protected_pairs_by_target,
        )
    return align_by_external_id(
        conn,
        pivot_doc_id=pivot_doc_id,
        target_doc_ids=target_doc_ids,
        run_id=run_id,
        debug=debug_align,
        protected_pairs_by_target=protected_pairs_by_target,
    )


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
        from multicorpus_engine.runs import RunIdConflictError, create_run

        return create_run(self._conn(), kind, params, run_id=run_id)

    def _send_run_id_conflict(self, run_id: str) -> None:
        """Send HTTP 409 for a duplicate client-supplied run_id."""
        self._send_error(
            f"run_id already exists: {run_id!r}",
            code=ERR_CONFLICT,
            http_status=409,
            details={"run_id": run_id},
        )

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
        elif path == "/documents/preview":
            qs = parse_qs(urlparse(self.path).query)
            self._handle_documents_preview(qs)
        elif path == "/tokens":
            qs = parse_qs(urlparse(self.path).query)
            self._handle_tokens_list(qs)
        elif path == "/unit/context":
            qs = parse_qs(urlparse(self.path).query)
            self._handle_unit_context(qs)
        elif path == "/doc_relations":
            self._handle_doc_relations_get()
        elif path == "/doc_relations/all":
            self._handle_doc_relations_all()
        elif path == "/families":
            self._handle_families()
        elif path.startswith("/families/") and path.endswith("/curation_status"):
            parts = path.split("/")  # ['', 'families', '{id}', 'curation_status']
            try:
                fam_root_id = int(parts[2])
            except (IndexError, ValueError):
                self._send_error(400, "BAD_REQUEST", "Invalid family_root_id in path")
                return
            self._handle_family_curation_status(fam_root_id)
        elif path == "/jobs":
            self._handle_jobs_list()
        elif path == "/runs":
            self._handle_runs_list()
        elif path.startswith("/jobs/"):
            self._handle_job_get(path)
        elif path == "/curate/exceptions":
            qs = parse_qs(urlparse(self.path).query)
            doc_id_str = qs.get("doc_id", [None])[0]
            self._handle_curate_exceptions_list(
                {"doc_id": int(doc_id_str)} if doc_id_str else {}
            )
        elif path == "/curate/apply-history":
            qs = parse_qs(urlparse(self.path).query)
            doc_id_str = qs.get("doc_id", [None])[0]
            limit_str = qs.get("limit", [None])[0]
            self._handle_curate_apply_history_list({
                "doc_id": int(doc_id_str) if doc_id_str else None,
                "limit": int(limit_str) if limit_str else 50,
            })
        elif path == "/corpus/info":
            self._handle_corpus_info_get()
        elif path == "/corpus/audit":
            qs = parse_qs(urlparse(self.path).query)
            self._handle_corpus_audit(qs)
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
                # Core mutators
                "/index", "/import", "/shutdown",
                "/annotate",
                "/db/backup",
                "/corpus/info",
                # Document / relation writes
                "/documents/update", "/documents/bulk_update", "/documents/delete",
                "/doc_relations/set", "/doc_relations/delete",
                # Exports (write to disk)
                "/export/tei", "/export/align_csv", "/export/run_report",
                "/export/conllu",
                "/export/token_query_csv",
                "/export/ske",
                "/curate/exceptions/export",
                "/curate/apply-history/export",
                "/tokens/update",
                # Apply history record (writes to DB)
                "/curate/apply-history/record",
                # Alignment writes (previously unprotected — fixed in 1.4.1)
                "/align",
                "/align/link/update_status", "/align/link/delete", "/align/link/retarget",
                "/align/link/acknowledge_source_change",
                "/align/links/batch_update",
                "/align/collisions/resolve",
                # Other DB-mutating operations (fixed in 1.4.1)
                "/curate",
                "/segment",
                # Unit structural edits
                "/units/merge", "/units/split",
                # Async jobs
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
            elif path == "/token_query":
                self._handle_token_query(body)
            elif path == "/token_stats":
                self._handle_token_stats(body)
            elif path == "/token_collocates":
                self._handle_token_collocates(body)
            elif path == "/query/facets":
                self._handle_query_facets(body)
            elif path == "/stats/lexical":
                self._handle_stats_lexical(body)
            elif path == "/stats/compare":
                self._handle_stats_compare(body)
            elif path == "/index":
                self._handle_index(body)
            elif path == "/import":
                self._handle_import(body)
            elif path == "/annotate":
                self._handle_annotate(body)
            elif path == "/curate":
                self._handle_curate(body)
            elif path == "/curate/preview":
                self._handle_curate_preview(body)
            elif path == "/curate/exceptions":
                self._handle_curate_exceptions_list(body)
            elif path == "/curate/exceptions/set":
                self._handle_curate_exceptions_set(body)
            elif path == "/curate/exceptions/delete":
                self._handle_curate_exceptions_delete(body)
            elif path == "/curate/exceptions/export":
                self._handle_curate_exceptions_export(body)
            elif path == "/curate/apply-history":
                self._handle_curate_apply_history_list(body)
            elif path == "/curate/apply-history/record":
                self._handle_curate_apply_history_record(body)
            elif path == "/curate/apply-history/export":
                self._handle_curate_apply_history_export(body)
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
            elif path == "/align/link/acknowledge_source_change":
                self._handle_align_link_acknowledge_source_change(body)
            elif path == "/align/links/batch_update":
                self._handle_align_links_batch_update(body)
            elif path == "/align/retarget_candidates":
                self._handle_align_retarget_candidates(body)
            elif path == "/align/collisions":
                self._handle_align_collisions(body)
            elif path == "/align/collisions/resolve":
                self._handle_align_collisions_resolve(body)
            elif path == "/validate-meta":
                self._handle_validate_meta(body)
            elif path == "/segment/preview":
                self._handle_segment_preview(body)
            elif path == "/segment/detect_markers":
                self._handle_segment_detect_markers(body)
            elif path == "/units/merge":
                self._handle_units_merge(body)
            elif path == "/units/split":
                self._handle_units_split(body)
            elif path == "/segment":
                self._handle_segment(body)
            elif path.startswith("/families/") and path.endswith("/segment"):
                parts = path.split("/")  # ['', 'families', '{id}', 'segment']
                if len(parts) == 4:
                    try:
                        family_root_id = int(parts[2])
                        self._handle_family_segment(family_root_id, body)
                    except ValueError:
                        self._send_error("Invalid family_root_id", code=ERR_BAD_REQUEST, http_status=400)
                else:
                    self._send_error("Unknown route: " + path, code=ERR_NOT_FOUND, http_status=404)
            elif path.startswith("/families/") and path.endswith("/align"):
                parts = path.split("/")  # ['', 'families', '{id}', 'align']
                if len(parts) == 4:
                    try:
                        family_root_id = int(parts[2])
                        self._handle_family_align(family_root_id, body)
                    except ValueError:
                        self._send_error("Invalid family_root_id", code=ERR_BAD_REQUEST, http_status=400)
                else:
                    self._send_error("Unknown route: " + path, code=ERR_NOT_FOUND, http_status=404)
            elif path == "/align":
                self._handle_align(body)
            elif path == "/documents/update":
                self._handle_documents_update(body)
            elif path == "/documents/bulk_update":
                self._handle_documents_bulk_update(body)
            elif path == "/documents/delete":
                self._handle_documents_delete(body)
            elif path == "/tokens/update":
                self._handle_tokens_update(body)
            elif path == "/doc_relations/set":
                self._handle_doc_relations_set(body)
            elif path == "/doc_relations/delete":
                self._handle_doc_relations_delete(body)
            elif path == "/export/tei":
                self._handle_export_tei(body)
            elif path == "/export/conllu":
                self._handle_export_conllu(body)
            elif path == "/export/token_query_csv":
                self._handle_export_token_query_csv(body)
            elif path == "/export/ske":
                self._handle_export_ske(body)
            elif path == "/export/tmx":
                self._handle_export_tmx(body)
            elif path == "/export/bilingual":
                self._handle_export_bilingual(body)
            elif path == "/export/align_csv":
                self._handle_export_align_csv(body)
            elif path == "/export/run_report":
                self._handle_export_run_report(body)
            elif path == "/db/backup":
                self._handle_db_backup(body)
            elif path == "/corpus/info":
                self._handle_corpus_info_post(body)
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

    def _handle_runs_list(self) -> None:
        """GET /runs — persisted run history from SQLite ``runs`` (import, align, index, …)."""
        qs = parse_qs(urlparse(self.path).query)
        kind_filter = (qs.get("kind") or [None])[0]
        try:
            limit = int((qs.get("limit") or [50])[0])
        except (ValueError, TypeError):
            limit = 50
        limit = max(1, min(limit, 200))

        with self._lock():
            conn = self._conn()
            if kind_filter:
                rows = conn.execute(
                    "SELECT run_id, kind, params_json, stats_json, created_at FROM runs "
                    "WHERE kind = ? ORDER BY created_at DESC LIMIT ?",
                    (kind_filter, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT run_id, kind, params_json, stats_json, created_at FROM runs "
                    "ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()

        records: list[dict] = []
        for r in rows:
            rec: dict = {
                "run_id": r[0],
                "kind": r[1],
                "created_at": r[4],
            }
            if r[2]:
                try:
                    rec["params"] = json.loads(r[2])
                except json.JSONDecodeError:
                    rec["params"] = None
            else:
                rec["params"] = None
            if r[3]:
                try:
                    rec["stats"] = json.loads(r[3])
                except json.JSONDecodeError:
                    rec["stats"] = None
            else:
                rec["stats"] = None
            records.append(rec)

        self._send_json(success_payload({"runs": records, "limit": limit}))

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

        if kind == "index":
            if "incremental" in params and not isinstance(params.get("incremental"), bool):
                self._send_error(
                    "index params.incremental must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
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
            "export_tei_package", "export_readable_text", "qa_report",
            "annotate",
        }
        if kind not in supported:
            self._send_error(
                f"Unsupported job kind: {kind!r}",
                code=ERR_VALIDATION,
                http_status=400,
                details={"supported_kinds": sorted(supported)},
            )
            return

        if kind == "index":
            if "incremental" in params and not isinstance(params.get("incremental"), bool):
                self._send_error(
                    "index params.incremental must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
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
        if kind == "annotate":
            all_docs = bool(params.get("all_docs", False))
            if not all_docs:
                if "doc_id" not in params:
                    self._send_error(
                        "annotate job requires params.doc_id or params.all_docs=true",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
                try:
                    int(params.get("doc_id"))
                except (TypeError, ValueError):
                    self._send_error(
                        "annotate params.doc_id must be an integer",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
            if "model" in params and params["model"] is not None:
                if not isinstance(params.get("model"), str) or not params.get("model", "").strip():
                    self._send_error(
                        "annotate params.model must be a non-empty string when provided",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
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
            if "replace_existing" in params and not isinstance(params.get("replace_existing"), bool):
                self._send_error(
                    "align params.replace_existing must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if "preserve_accepted" in params and not isinstance(params.get("preserve_accepted"), bool):
                self._send_error(
                    "align params.preserve_accepted must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
        if kind in ("export_tei",) and not params.get("out_dir"):
            self._send_error("export_tei job requires params.out_dir", code=ERR_VALIDATION, http_status=400)
            return
        if kind == "export_tei":
            if "include_structure" in params and not isinstance(params.get("include_structure"), bool):
                self._send_error(
                    "export_tei params.include_structure must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if "relation_type" in params and params.get("relation_type") is not None:
                relation_type = params.get("relation_type")
                if not isinstance(relation_type, str):
                    self._send_error(
                        "export_tei params.relation_type must be a string",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
                relation_type = relation_type.strip() or "none"
                allowed_relation_types = {"none", "translation_of", "excerpt_of", "all"}
                if relation_type not in allowed_relation_types:
                    self._send_error(
                        "export_tei params.relation_type must be one of: none, translation_of, excerpt_of, all",
                        code=ERR_VALIDATION,
                        http_status=400,
                        details={"supported_values": sorted(allowed_relation_types)},
                    )
                    return
                params["relation_type"] = relation_type
        if kind == "export_readable_text" and not params.get("out_dir"):
            self._send_error("export_readable_text job requires params.out_dir", code=ERR_VALIDATION, http_status=400)
            return
        if kind == "export_readable_text":
            export_fmt = str(params.get("format", "txt")).strip().lower()
            if export_fmt not in {"txt", "docx"}:
                self._send_error(
                    "export_readable_text params.format must be 'txt' or 'docx'",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if "source_field" in params:
                source_field = str(params.get("source_field", "text_norm")).strip()
                if source_field not in {"text_norm", "text_raw"}:
                    self._send_error(
                        "export_readable_text params.source_field must be 'text_norm' or 'text_raw'",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
            if "include_structure" in params and not isinstance(params.get("include_structure"), bool):
                self._send_error(
                    "export_readable_text params.include_structure must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if "include_external_id" in params and not isinstance(params.get("include_external_id"), bool):
                self._send_error(
                    "export_readable_text params.include_external_id must be a boolean",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return
            if "doc_ids" in params and params.get("doc_ids") is not None:
                raw_doc_ids = params.get("doc_ids")
                if not isinstance(raw_doc_ids, list):
                    self._send_error(
                        "export_readable_text params.doc_ids must be an array of positive integers",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
                try:
                    doc_ids = [int(v) for v in raw_doc_ids]
                except (TypeError, ValueError):
                    self._send_error(
                        "export_readable_text params.doc_ids must be an array of positive integers",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
                if any(v <= 0 for v in doc_ids):
                    self._send_error(
                        "export_readable_text params.doc_ids must be an array of positive integers",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
                params["doc_ids"] = doc_ids
        if kind in ("export_align_csv", "export_run_report", "export_tei_package", "qa_report") and not params.get("out_path"):
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

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if isinstance(raw_doc_ids, list):
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError) as exc:
                raise ValueError("doc_ids must be a list of integers") from exc

        raw_db_paths = body.get("db_paths")
        db_paths: list[str] | None = None
        if raw_db_paths is not None:
            if not isinstance(raw_db_paths, list) or len(raw_db_paths) == 0:
                raise ValueError("db_paths must be a non-empty list of database file paths")
            resolved_paths: list[str] = []
            seen_paths: set[str] = set()
            for raw_path in raw_db_paths:
                if not isinstance(raw_path, str) or not raw_path.strip():
                    raise ValueError("db_paths must only contain non-empty string paths")
                path_obj = Path(raw_path).expanduser().resolve()
                if not path_obj.exists() or not path_obj.is_file():
                    raise ValueError(f"db_path not found: {path_obj}")
                resolved = str(path_obj)
                if resolved in seen_paths:
                    continue
                seen_paths.add(resolved)
                resolved_paths.append(resolved)
            if len(resolved_paths) == 0:
                raise ValueError("db_paths must contain at least one valid database path")
            db_paths = resolved_paths

        # ── family_id expansion ──────────────────────────────────────────────
        # When family_id is provided we resolve it to a set of doc_ids
        # (parent + all translation_of/excerpt_of children) and force
        # include_aligned=True so the cross-family view is populated.
        family_id: int | None = None
        raw_family_id = body.get("family_id")
        if raw_family_id is not None:
            try:
                family_id = int(raw_family_id)
            except (TypeError, ValueError) as exc:
                raise ValueError("family_id must be an integer") from exc

        if family_id is not None and db_paths is not None:
            raise ValueError("family_id cannot be combined with db_paths federation")

        pivot_only: bool = bool(body.get("pivot_only", False))
        include_aligned_raw: bool = bool(body.get("include_aligned", False))

        if family_id is not None:
            conn_f = self._conn()
            child_rows = conn_f.execute(
                "SELECT doc_id FROM doc_relations"
                " WHERE target_doc_id = ? AND relation_type IN ('translation_of', 'excerpt_of')",
                [family_id],
            ).fetchall()
            child_ids = [r[0] for r in child_rows]
            if pivot_only:
                doc_ids = [family_id]
            else:
                doc_ids = [family_id] + child_ids
            include_aligned_raw = True  # always show aligned units in cross-family mode

        regex_pattern_raw = body.get("regex_pattern")
        regex_pattern: str | None = str(regex_pattern_raw).strip() if regex_pattern_raw else None

        params = {
            "q": body.get("q", ""),
            "mode": body.get("mode", "segment"),
            "window": body.get("window", 10),
            "language": body.get("language"),
            "doc_id": body.get("doc_id") if family_id is None else None,
            "doc_ids": doc_ids,
            "resource_type": body.get("resource_type"),
            "doc_role": body.get("doc_role"),
            "author": body.get("author") or None,
            "title_search": body.get("title_search") or None,
            "doc_date_from": body.get("doc_date_from") or None,
            "doc_date_to": body.get("doc_date_to") or None,
            "source_ext": body.get("source_ext") or None,
            "include_aligned": include_aligned_raw,
            "aligned_limit": aligned_limit,
            "all_occurrences": body.get("all_occurrences", False),
            "case_sensitive": bool(body.get("case_sensitive", False)),
            "limit": limit,
            "offset": offset,
            "family_id": family_id,
            "pivot_only": pivot_only,
            "regex_pattern": regex_pattern,
            "db_paths": db_paths,
        }
        query_kwargs = {
            "q": params["q"],
            "mode": params["mode"],
            "window": params["window"],
            "language": params["language"],
            "doc_id": params["doc_id"],
            "doc_ids": params["doc_ids"],
            "resource_type": params["resource_type"],
            "doc_role": params["doc_role"],
            "author": params["author"],
            "title_search": params["title_search"],
            "doc_date_from": params["doc_date_from"],
            "doc_date_to": params["doc_date_to"],
            "source_ext": params["source_ext"],
            "include_aligned": params["include_aligned"],
            "aligned_limit": params["aligned_limit"],
            "all_occurrences": params["all_occurrences"],
            "case_sensitive": params["case_sensitive"],
            "regex_pattern": params["regex_pattern"],
        }
        with self._lock():
            run_id = self._create_run("query", params)
            if params["db_paths"] is None:
                page = run_query_page(
                    conn=self._conn(),
                    **query_kwargs,
                    limit=params["limit"],
                    offset=params["offset"],
                )
                hits = page["hits"]
            else:
                from multicorpus_engine.db.connection import get_connection

                fed_rows: list[dict] = []
                totals: list[int | None] = []
                per_db_limit = params["offset"] + params["limit"] + 1
                for db_index, db_path in enumerate(params["db_paths"]):
                    ext_conn = get_connection(db_path)
                    try:
                        db_page = run_query_page(
                            conn=ext_conn,
                            **query_kwargs,
                            limit=per_db_limit,
                            offset=0,
                        )
                    finally:
                        ext_conn.close()
                    totals.append(db_page.get("total"))
                    for hit in db_page["hits"]:
                        with_source = dict(hit)
                        with_source["source_db_path"] = db_path
                        with_source["source_db_name"] = Path(db_path).name
                        with_source["source_db_index"] = db_index
                        fed_rows.append(with_source)

                window_rows = fed_rows[params["offset"] : params["offset"] + params["limit"] + 1]
                has_more = len(window_rows) > params["limit"]
                hits = window_rows[: params["limit"]]
                next_offset = params["offset"] + params["limit"] if has_more else None
                total: int | None = None
                if totals and all(isinstance(v, int) for v in totals):
                    total = sum(int(v) for v in totals)
                page = {
                    "hits": hits,
                    "limit": params["limit"],
                    "offset": params["offset"],
                    "next_offset": next_offset,
                    "has_more": has_more,
                    "total": total,
                }
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
        resp: dict = {
            "run_id": run_id,
            "count": len(hits),
            "hits": hits,
            "limit": page["limit"],
            "offset": page["offset"],
            "next_offset": page["next_offset"],
            "has_more": page["has_more"],
            "total": page["total"],
        }
        if params["family_id"] is not None:
            resp["family_id"] = params["family_id"]
            resp["family_doc_ids"] = params["doc_ids"]
            resp["pivot_only"] = params["pivot_only"]
        if params["db_paths"] is not None:
            resp["federated"] = True
            resp["db_paths"] = params["db_paths"]
            resp["db_count"] = len(params["db_paths"])
        self._send_json(success_payload(resp))

    def _handle_token_query(self, body: dict) -> None:
        from multicorpus_engine.token_query import run_token_query_page

        raw_cql = body.get("cql")
        if not isinstance(raw_cql, str) or not raw_cql.strip():
            raise ValueError("cql must be a non-empty string")
        cql = raw_cql.strip()

        mode = str(body.get("mode", "kwic")).strip().lower()
        if mode not in {"segment", "kwic"}:
            raise ValueError("mode must be 'segment' or 'kwic'")

        raw_window = body.get("window", 10)
        try:
            window = int(raw_window)
        except (TypeError, ValueError) as exc:
            raise ValueError("window must be an integer >= 0") from exc
        if window < 0:
            raise ValueError("window must be >= 0")

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

        language_raw = body.get("language")
        language = str(language_raw).strip() if isinstance(language_raw, str) and language_raw.strip() else None

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if raw_doc_ids is not None:
            if not isinstance(raw_doc_ids, list):
                raise ValueError("doc_ids must be a list of integers")
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError) as exc:
                raise ValueError("doc_ids must be a list of integers") from exc

        include_aligned = bool(body.get("include_aligned", False))

        params = {
            "cql": cql,
            "mode": mode,
            "window": window,
            "language": language,
            "doc_ids": doc_ids,
            "limit": limit,
            "offset": offset,
            "include_aligned": include_aligned,
        }

        with self._lock():
            run_id = self._create_run("token_query", params)
            page = run_token_query_page(
                conn=self._conn(),
                cql=cql,
                mode=mode,
                window=window,
                language=language,
                doc_ids=doc_ids,
                limit=limit,
                offset=offset,
                include_aligned=include_aligned,
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

        self._send_json(
            success_payload(
                {
                    "run_id": run_id,
                    "count": len(hits),
                    "hits": hits,
                    "limit": page["limit"],
                    "offset": page["offset"],
                    "next_offset": page["next_offset"],
                    "has_more": page["has_more"],
                    "total": page["total"],
                }
            )
        )

    def _handle_token_stats(self, body: dict) -> None:
        """POST /token_stats — frequency distribution of a token attribute over CQL hits.

        No auth token required (read-only).

        Body fields:
            cql        (str, required)  — CQL query string
            group_by   (str, default "lemma") — lemma | upos | xpos | word | feats
            language   (str, optional)
            doc_ids    (list[int], optional)
            limit      (int, default 50, max 200)
        """
        from multicorpus_engine.token_stats import run_token_stats

        raw_cql = body.get("cql")
        if not isinstance(raw_cql, str) or not raw_cql.strip():
            self._send_error(
                "cql must be a non-empty string",
                code=ERR_VALIDATION, http_status=400,
            )
            return

        group_by = str(body.get("group_by", "lemma")).strip().lower()
        allowed_group_by = ("lemma", "upos", "xpos", "word", "feats")
        if group_by not in allowed_group_by:
            self._send_error(
                f"group_by must be one of {allowed_group_by!r}",
                code=ERR_VALIDATION, http_status=400,
            )
            return

        raw_limit = body.get("limit", 50)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            self._send_error("limit must be an integer", code=ERR_VALIDATION, http_status=400)
            return
        if limit < 1 or limit > 200:
            self._send_error("limit must be in [1, 200]", code=ERR_VALIDATION, http_status=400)
            return

        language_raw = body.get("language")
        language = (
            str(language_raw).strip()
            if isinstance(language_raw, str) and language_raw.strip()
            else None
        )

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if raw_doc_ids is not None:
            if not isinstance(raw_doc_ids, list):
                self._send_error("doc_ids must be a list of integers", code=ERR_VALIDATION, http_status=400)
                return
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError):
                self._send_error("doc_ids must be a list of integers", code=ERR_VALIDATION, http_status=400)
                return

        with self._lock():
            try:
                result = run_token_stats(
                    conn=self._conn(),
                    cql=raw_cql.strip(),
                    group_by=group_by,
                    language=language,
                    doc_ids=doc_ids,
                    limit=limit,
                )
            except ValueError as exc:
                self._send_error(str(exc), code=ERR_VALIDATION, http_status=400)
                return

        self._send_json(success_payload(result))

    def _handle_token_collocates(self, body: dict) -> None:
        """POST /token_collocates — collocation analysis for a CQL query.

        No auth token required (read-only).

        Body fields:
            cql        (str, required)  — CQL query string
            window     (int, default 5, range 1–20) — context window size
            by         (str, default "lemma") — lemma | word | upos | xpos
            language   (str, optional)
            doc_ids    (list[int], optional)
            limit      (int, default 50, max 200)
            min_freq   (int, default 2)
            sort_by    (str, default "pmi") — pmi | ll | freq
        """
        from multicorpus_engine.token_collocates import run_token_collocates

        raw_cql = body.get("cql")
        if not isinstance(raw_cql, str) or not raw_cql.strip():
            self._send_error(
                "cql must be a non-empty string",
                code=ERR_VALIDATION, http_status=400,
            )
            return

        def _int_field(key: str, default: int, lo: int, hi: int) -> int | None:
            raw = body.get(key, default)
            try:
                val = int(raw)
            except (TypeError, ValueError):
                self._send_error(f"{key} must be an integer", code=ERR_VALIDATION, http_status=400)
                return None
            if not lo <= val <= hi:
                self._send_error(f"{key} must be in [{lo}, {hi}]", code=ERR_VALIDATION, http_status=400)
                return None
            return val

        window = _int_field("window", 5, 1, 20)
        if window is None:
            return
        limit = _int_field("limit", 50, 1, 200)
        if limit is None:
            return
        min_freq = _int_field("min_freq", 2, 1, 9999)
        if min_freq is None:
            return

        by = str(body.get("by", "lemma")).strip().lower()
        if by not in ("lemma", "word", "upos", "xpos"):
            self._send_error(
                "by must be one of ('lemma', 'word', 'upos', 'xpos')",
                code=ERR_VALIDATION, http_status=400,
            )
            return

        sort_by = str(body.get("sort_by", "pmi")).strip().lower()
        if sort_by not in ("pmi", "ll", "freq"):
            self._send_error(
                "sort_by must be one of ('pmi', 'll', 'freq')",
                code=ERR_VALIDATION, http_status=400,
            )
            return

        language_raw = body.get("language")
        language = (
            str(language_raw).strip()
            if isinstance(language_raw, str) and language_raw.strip()
            else None
        )

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if raw_doc_ids is not None:
            if not isinstance(raw_doc_ids, list):
                self._send_error("doc_ids must be a list of integers", code=ERR_VALIDATION, http_status=400)
                return
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError):
                self._send_error("doc_ids must be a list of integers", code=ERR_VALIDATION, http_status=400)
                return

        with self._lock():
            try:
                result = run_token_collocates(
                    conn=self._conn(),
                    cql=raw_cql.strip(),
                    window=window,
                    by=by,
                    language=language,
                    doc_ids=doc_ids,
                    limit=limit,
                    min_freq=min_freq,
                    sort_by=sort_by,
                )
            except ValueError as exc:
                self._send_error(str(exc), code=ERR_VALIDATION, http_status=400)
                return

        self._send_json(success_payload(result))

    def _handle_query_facets(self, body: dict) -> None:
        """POST /query/facets — lightweight facet summary for a query.

        Returns total_hits, distinct_docs, distinct_langs, and top_docs without
        fetching any hit content. Accepts the same filter parameters as /query.
        """
        from multicorpus_engine.query import run_query_facets

        raw_top = body.get("top_docs_limit", 10)
        try:
            top_docs_limit = int(raw_top)
        except (TypeError, ValueError) as exc:
            raise ValueError("top_docs_limit must be an integer") from exc
        if top_docs_limit < 1 or top_docs_limit > 50:
            raise ValueError("top_docs_limit must be in [1, 50]")

        raw_doc_ids_f = body.get("doc_ids")
        doc_ids_f: list[int] | None = None
        if isinstance(raw_doc_ids_f, list):
            try:
                doc_ids_f = [int(x) for x in raw_doc_ids_f]
            except (TypeError, ValueError) as exc:
                raise ValueError("doc_ids must be a list of integers") from exc

        params = {
            "q": body.get("q", ""),
            "language": body.get("language"),
            "doc_id": body.get("doc_id"),
            "doc_ids": doc_ids_f,
            "resource_type": body.get("resource_type"),
            "doc_role": body.get("doc_role"),
            "author": body.get("author") or None,
            "title_search": body.get("title_search") or None,
            "doc_date_from": body.get("doc_date_from") or None,
            "doc_date_to": body.get("doc_date_to") or None,
            "source_ext": body.get("source_ext") or None,
            "top_docs_limit": top_docs_limit,
        }
        with self._lock():
            result = run_query_facets(conn=self._conn(), **params)
        self._send_json(success_payload(result))

    # ── Stats endpoints ───────────────────────────────────────────────────────

    def _handle_stats_lexical(self, body: dict) -> None:
        """POST /stats/lexical — compute lexical frequency stats for a slot."""
        from multicorpus_engine.stats import (
            StatsSlot, compute_lexical_stats, stats_result_to_dict,
        )

        slot_raw = body.get("slot", {})
        slot = StatsSlot(
            doc_ids=slot_raw.get("doc_ids") or None,
            language=slot_raw.get("language") or None,
            doc_role=slot_raw.get("doc_role") or None,
            resource_type=slot_raw.get("resource_type") or None,
            family_id=int(slot_raw["family_id"]) if slot_raw.get("family_id") is not None else None,
            top_n=max(1, min(int(slot_raw.get("top_n", 50)), 500)),
            min_length=max(1, int(slot_raw.get("min_length", 2))),
        )
        label = str(body.get("label", ""))
        with self._lock():
            result = compute_lexical_stats(self._conn(), slot, label)
        self._send_json(success_payload(stats_result_to_dict(result)))

    def _handle_stats_compare(self, body: dict) -> None:
        """POST /stats/compare — compare frequency distributions of two slots."""
        from multicorpus_engine.stats import (
            StatsSlot, compute_stats_compare, stats_compare_result_to_dict,
        )

        def _parse_slot(raw: dict) -> StatsSlot:
            return StatsSlot(
                doc_ids=raw.get("doc_ids") or None,
                language=raw.get("language") or None,
                doc_role=raw.get("doc_role") or None,
                resource_type=raw.get("resource_type") or None,
                family_id=int(raw["family_id"]) if raw.get("family_id") is not None else None,
                top_n=max(1, min(int(raw.get("top_n", 50)), 500)),
                min_length=max(1, int(raw.get("min_length", 2))),
            )

        slot_a = _parse_slot(body.get("a", {}))
        slot_b = _parse_slot(body.get("b", {}))
        label_a = str(body.get("label_a", "A"))
        label_b = str(body.get("label_b", "B"))

        with self._lock():
            result = compute_stats_compare(self._conn(), slot_a, slot_b, label_a, label_b)
        self._send_json(success_payload(stats_compare_result_to_dict(result)))

    def _handle_index(self, body: dict) -> None:
        from multicorpus_engine.indexer import build_index, update_index

        incremental = bool(body.get("incremental", False))
        if "incremental" in body and not isinstance(body.get("incremental"), bool):
            self._send_error(
                "incremental must be a boolean when provided",
                code=ERR_VALIDATION,
                http_status=400,
            )
            return

        with self._lock():
            run_id = self._create_run("index", {"incremental": incremental})
            if incremental:
                stats = update_index(self._conn(), prune_deleted=True)
                self._update_run_stats(run_id, stats)
                payload = {"run_id": run_id, "incremental": True, **stats}
            else:
                count = build_index(self._conn())
                self._update_run_stats(run_id, {"units_indexed": count})
                payload = {"run_id": run_id, "units_indexed": count, "incremental": False}
        self._send_json(success_payload(payload))

    def _handle_import(self, body: dict) -> None:
        mode = body.get("mode")
        # Normalise legacy/malformed mode values (e.g. "odt paragraphs" → "odt_paragraphs")
        if isinstance(mode, str):
            mode = mode.strip().lower().replace(" ", "_").replace("-", "_")
        path = body.get("path")
        language = body.get("language")
        title = body.get("title")
        doc_role = body.get("doc_role", "standalone")
        resource_type = body.get("resource_type")
        tei_unit = body.get("tei_unit", "p")
        check_filename = bool(body.get("check_filename", False))
        family_root_doc_id = body.get("family_root_doc_id")
        if family_root_doc_id is not None:
            try:
                family_root_doc_id = int(family_root_doc_id)
            except (TypeError, ValueError):
                self._send_error(
                    "family_root_doc_id must be an integer",
                    code=ERR_VALIDATION,
                    http_status=400,
                )
                return

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
                        check_filename=check_filename,
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
                        check_filename=check_filename,
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
                        check_filename=check_filename,
                    )
                elif mode == "odt_paragraphs":
                    from multicorpus_engine.importers.odt_paragraphs import import_odt_paragraphs
                    report = import_odt_paragraphs(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        run_id=run_id,
                        check_filename=check_filename,
                    )
                elif mode == "odt_numbered_lines":
                    from multicorpus_engine.importers.odt_numbered_lines import import_odt_numbered_lines
                    report = import_odt_numbered_lines(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        run_id=run_id,
                        check_filename=check_filename,
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
                        check_filename=check_filename,
                    )
                elif mode == "conllu":
                    from multicorpus_engine.importers.conllu import import_conllu
                    report = import_conllu(
                        conn=self._conn(),
                        path=path,
                        language=language,
                        title=title,
                        doc_role=doc_role,
                        resource_type=resource_type,
                        run_id=run_id,
                        check_filename=check_filename,
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

        relation_created = False
        relation_id: int | None = None
        if family_root_doc_id is not None:
            new_doc_id = stats.get("doc_id")
            if isinstance(new_doc_id, int):
                with self._lock():
                    conn = self._conn()
                    # Verify parent exists
                    parent_exists = conn.execute(
                        "SELECT 1 FROM documents WHERE doc_id = ?",
                        (family_root_doc_id,),
                    ).fetchone()
                    if parent_exists:
                        existing = conn.execute(
                            """SELECT id FROM doc_relations
                               WHERE doc_id = ? AND target_doc_id = ?
                                 AND relation_type = 'translation_of'""",
                            (new_doc_id, family_root_doc_id),
                        ).fetchone()
                        if existing:
                            relation_id = existing[0]
                        else:
                            cur = conn.execute(
                                """INSERT INTO doc_relations (doc_id, relation_type, target_doc_id)
                                   VALUES (?, 'translation_of', ?)""",
                                (new_doc_id, family_root_doc_id),
                            )
                            conn.commit()
                            relation_id = cur.lastrowid
                            relation_created = True
                    else:
                        self._send_error(
                            f"family_root_doc_id {family_root_doc_id} not found",
                            code=ERR_NOT_FOUND,
                            http_status=404,
                        )
                        return

        self._send_json(success_payload({
            "run_id": run_id,
            "mode": mode,
            "relation_created": relation_created,
            **({"relation_id": relation_id} if relation_id is not None else {}),
            **stats,
        }))

    def _handle_curate_exceptions_list(self, body: dict) -> None:
        """Return all curation exceptions for a given doc_id (or all if absent).

        Enriched for Level 8A: response now includes doc_id, doc_title and
        unit_text (truncated to 200 chars) for each exception row, so the
        admin panel can display useful context without extra queries.
        """
        doc_id = body.get("doc_id")
        with self._lock():
            conn = self._conn()
            if doc_id is not None:
                rows = conn.execute(
                    """
                    SELECT ce.id, ce.unit_id, ce.kind, ce.override_text, ce.note, ce.created_at,
                           u.doc_id,
                           COALESCE(d.title, '') AS doc_title,
                           SUBSTR(u.text_norm, 1, 200)  AS unit_text
                    FROM curation_exceptions ce
                    JOIN units u    ON u.unit_id = ce.unit_id
                    JOIN documents d ON d.doc_id  = u.doc_id
                    WHERE u.doc_id = ?
                    ORDER BY ce.unit_id
                    """,
                    (int(doc_id),),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT ce.id, ce.unit_id, ce.kind, ce.override_text, ce.note, ce.created_at,
                           u.doc_id,
                           COALESCE(d.title, '') AS doc_title,
                           SUBSTR(u.text_norm, 1, 200)  AS unit_text
                    FROM curation_exceptions ce
                    JOIN units u    ON u.unit_id = ce.unit_id
                    JOIN documents d ON d.doc_id  = u.doc_id
                    ORDER BY u.doc_id, ce.unit_id
                    """
                ).fetchall()
        exceptions = [
            {
                "id": row[0],
                "unit_id": row[1],
                "kind": row[2],
                "override_text": row[3],
                "note": row[4],
                "created_at": row[5],
                "doc_id": row[6],
                "doc_title": row[7] or None,
                "unit_text": row[8] or None,
            }
            for row in rows
        ]
        self._send_json(success_payload({"exceptions": exceptions, "count": len(exceptions)}))

    def _handle_curate_exceptions_set(self, body: dict) -> None:
        """Create or replace a curation exception for a unit_id.

        Required fields: unit_id (int), kind ('ignore' | 'override')
        When kind = 'override': override_text (str, non-empty) is required.
        Optional: note (str)
        """
        unit_id = body.get("unit_id")
        kind = body.get("kind")
        if unit_id is None or kind not in ("ignore", "override"):
            self._send_error(
                "unit_id (int) and kind ('ignore'|'override') are required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        unit_id = int(unit_id)
        override_text = body.get("override_text")
        if kind == "override" and not override_text:
            self._send_error(
                "override_text is required when kind = 'override'",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        note = body.get("note")
        with self._lock():
            conn = self._conn()
            # Verify unit exists
            row = conn.execute(
                "SELECT unit_id FROM units WHERE unit_id = ?", (unit_id,)
            ).fetchone()
            if not row:
                self._send_error(
                    f"unit_id {unit_id} not found",
                    code=ERR_NOT_FOUND,
                    http_status=404,
                )
                return
            conn.execute(
                """
                INSERT INTO curation_exceptions (unit_id, kind, override_text, note, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(unit_id) DO UPDATE SET
                    kind = excluded.kind,
                    override_text = excluded.override_text,
                    note = excluded.note,
                    created_at = excluded.created_at
                """,
                (unit_id, kind, override_text, note),
            )
            conn.commit()
        self._send_json(success_payload({
            "unit_id": unit_id,
            "kind": kind,
            "override_text": override_text,
            "note": note,
            "action": "set",
        }))

    def _handle_curate_exceptions_delete(self, body: dict) -> None:
        """Delete the curation exception for a unit_id (if any)."""
        unit_id = body.get("unit_id")
        if unit_id is None:
            self._send_error("unit_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        unit_id = int(unit_id)
        with self._lock():
            conn = self._conn()
            cur = conn.execute(
                "DELETE FROM curation_exceptions WHERE unit_id = ?", (unit_id,)
            )
            conn.commit()
            deleted = cur.rowcount
        self._send_json(success_payload({"unit_id": unit_id, "deleted": deleted > 0}))

    def _handle_curate_exceptions_export(self, body: dict) -> None:
        """Export curation exceptions to JSON or CSV.

        Body fields:
          out_path (str)       — absolute path to write (chosen by the frontend via dialog)
          format   (str)       — "json" | "csv"  (default: "json")
          doc_id   (int|None)  — if provided, export only that document; else export all

        Returns { ok, out_path, count, format }.
        """
        import json as _json
        import csv as _csv
        import io as _io
        import datetime as _dt

        out_path = body.get("out_path")
        if not out_path:
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return

        fmt = body.get("format", "json")
        if fmt not in ("json", "csv"):
            self._send_error(
                "format must be 'json' or 'csv'",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        doc_id = body.get("doc_id")

        # Re-use the same JOIN query as _handle_curate_exceptions_list to keep
        # the field set consistent.
        _sql_select = """
            SELECT ce.unit_id, ce.kind, ce.override_text, ce.note, ce.created_at,
                   u.doc_id,
                   COALESCE(d.title, '') AS doc_title,
                   SUBSTR(u.text_norm, 1, 200) AS unit_text
            FROM curation_exceptions ce
            JOIN units u     ON u.unit_id = ce.unit_id
            JOIN documents d ON d.doc_id  = u.doc_id
        """

        with self._lock():
            conn = self._conn()
            if doc_id is not None:
                rows = conn.execute(
                    _sql_select + " WHERE u.doc_id = ? ORDER BY ce.unit_id",
                    (int(doc_id),),
                ).fetchall()
            else:
                rows = conn.execute(
                    _sql_select + " ORDER BY u.doc_id, ce.unit_id"
                ).fetchall()

        count = len(rows)
        exported_at = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        try:
            if fmt == "json":
                payload = {
                    "exported_at": exported_at,
                    "scope": "doc" if doc_id is not None else "all",
                    "doc_id": doc_id,
                    "count": count,
                    "exceptions": [
                        {
                            "doc_id": row[5],
                            "doc_title": row[6] or None,
                            "unit_id": row[0],
                            "kind": row[1],
                            "text": row[2],
                            "unit_text": row[7] or None,
                            "note": row[3],
                            "created_at": row[4],
                        }
                        for row in rows
                    ],
                }
                content = _json.dumps(payload, ensure_ascii=False, indent=2)
                with open(out_path, "w", encoding="utf-8") as fh:
                    fh.write(content)
            else:  # csv
                buf = _io.StringIO()
                writer = _csv.writer(buf, lineterminator="\n")
                writer.writerow(
                    ["doc_id", "doc_title", "unit_id", "kind", "text", "unit_text", "note", "created_at"]
                )
                for row in rows:
                    writer.writerow([
                        row[5],             # doc_id
                        row[6] or "",       # doc_title
                        row[0],             # unit_id
                        row[1],             # kind
                        row[2] or "",       # text (override_text)
                        row[7] or "",       # unit_text
                        row[3] or "",       # note
                        row[4],             # created_at
                    ])
                with open(out_path, "w", encoding="utf-8-sig", newline="") as fh:
                    fh.write(buf.getvalue())
        except OSError as exc:
            self._send_error(
                f"Could not write export file: {exc}",
                code="EXPORT_WRITE_ERROR",
                http_status=500,
            )
            return

        self._send_json(success_payload({
            "out_path": out_path,
            "count": count,
            "format": fmt,
        }))

    # ─── Apply-history endpoints (Level 10A/10B) ──────────────────────────────

    def _handle_curate_apply_history_record(self, body: dict) -> None:
        """Insert one apply event into curation_apply_history.

        Called by the frontend immediately after each successful curation job.
        All fields sourced from the frontend session — the sidecar trusts them.
        """
        scope = body.get("scope", "all")
        if scope not in ("doc", "all"):
            scope = "all"

        doc_id = body.get("doc_id")
        if doc_id is not None:
            doc_id = int(doc_id)

        # Coerce integer-like booleans
        def _int(v, default=None):
            try:
                return int(v)
            except (TypeError, ValueError):
                return default

        with self._lock():
            conn = self._conn()
            cur = conn.execute(
                """
                INSERT INTO curation_apply_history
                  (applied_at, scope, doc_id, doc_title,
                   docs_curated, units_modified, units_skipped,
                   ignored_count, manual_override_count,
                   preview_displayed_count, preview_units_changed, preview_truncated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    body.get("applied_at") or "unknown",
                    scope,
                    doc_id,
                    body.get("doc_title"),
                    _int(body.get("docs_curated"), 0),
                    _int(body.get("units_modified"), 0),
                    _int(body.get("units_skipped"), 0),
                    _int(body.get("ignored_count")),
                    _int(body.get("manual_override_count")),
                    _int(body.get("preview_displayed_count")),
                    _int(body.get("preview_units_changed")),
                    1 if body.get("preview_truncated") else 0,
                ),
            )
            conn.commit()
            new_id = cur.lastrowid

        self._send_json(success_payload({"id": new_id}))

    def _handle_curate_apply_history_list(self, body: dict) -> None:
        """List recent apply events, optionally filtered by doc_id or scope.

        Query-string / body params:
          doc_id (int | None) — filter to that document; None = all
          scope  (str | None) — 'doc' | 'all' | None (no filter)
          limit  (int)        — max rows returned (default 50, max 200)
        """
        doc_id = body.get("doc_id")
        scope  = body.get("scope")
        limit  = min(int(body.get("limit", 50)), 200)

        sql = """
            SELECT id, applied_at, scope, doc_id, doc_title,
                   docs_curated, units_modified, units_skipped,
                   ignored_count, manual_override_count,
                   preview_displayed_count, preview_units_changed, preview_truncated
            FROM curation_apply_history
        """
        conditions, params = [], []
        if doc_id is not None:
            conditions.append("doc_id = ?")
            params.append(int(doc_id))
        if scope is not None:
            conditions.append("scope = ?")
            params.append(scope)
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        sql += " ORDER BY applied_at DESC LIMIT ?"
        params.append(limit)

        with self._lock():
            rows = self._conn().execute(sql, params).fetchall()

        events = [
            {
                "id":                      row[0],
                "applied_at":              row[1],
                "scope":                   row[2],
                "doc_id":                  row[3],
                "doc_title":               row[4],
                "docs_curated":            row[5],
                "units_modified":          row[6],
                "units_skipped":           row[7],
                "ignored_count":           row[8],
                "manual_override_count":   row[9],
                "preview_displayed_count": row[10],
                "preview_units_changed":   row[11],
                "preview_truncated":       bool(row[12]),
            }
            for row in rows
        ]
        self._send_json(success_payload({"events": events, "count": len(events)}))

    def _handle_curate_apply_history_export(self, body: dict) -> None:
        """Export apply history to JSON or CSV.

        Body: { out_path, format ('json'|'csv'), doc_id? (int|None) }
        """
        import json as _json
        import csv as _csv
        import io as _io
        import datetime as _dt

        out_path = body.get("out_path")
        if not out_path:
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        fmt = body.get("format", "json")
        if fmt not in ("json", "csv"):
            self._send_error("format must be 'json' or 'csv'", code=ERR_BAD_REQUEST, http_status=400)
            return

        # Reuse the list handler's query logic.
        list_body = {"limit": 1000}
        doc_id = body.get("doc_id")
        if doc_id is not None:
            list_body["doc_id"] = int(doc_id)

        # Inline query (avoids HTTP round-trip back to self)
        sql = """
            SELECT id, applied_at, scope, doc_id, doc_title,
                   docs_curated, units_modified, units_skipped,
                   ignored_count, manual_override_count,
                   preview_displayed_count, preview_units_changed, preview_truncated
            FROM curation_apply_history
        """
        if doc_id is not None:
            sql += " WHERE doc_id = ?"
            params: list = [int(doc_id)]
        else:
            params = []
        sql += " ORDER BY applied_at DESC LIMIT 1000"

        with self._lock():
            rows = self._conn().execute(sql, params).fetchall()

        count = len(rows)
        exported_at = _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        events = [
            {
                "id":                      row[0],
                "applied_at":              row[1],
                "scope":                   row[2],
                "doc_id":                  row[3],
                "doc_title":               row[4],
                "docs_curated":            row[5],
                "units_modified":          row[6],
                "units_skipped":           row[7],
                "ignored_count":           row[8],
                "manual_override_count":   row[9],
                "preview_displayed_count": row[10],
                "preview_units_changed":   row[11],
                "preview_truncated":       bool(row[12]),
            }
            for row in rows
        ]

        try:
            if fmt == "json":
                payload = {
                    "exported_at": exported_at,
                    "scope": "doc" if doc_id is not None else "all",
                    "doc_id": doc_id,
                    "count": count,
                    "events": events,
                }
                with open(out_path, "w", encoding="utf-8") as fh:
                    fh.write(_json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                buf = _io.StringIO()
                writer = _csv.writer(buf, lineterminator="\n")
                writer.writerow([
                    "id", "applied_at", "scope", "doc_id", "doc_title",
                    "docs_curated", "units_modified", "units_skipped",
                    "ignored_count", "manual_override_count",
                    "preview_displayed_count", "preview_units_changed", "preview_truncated",
                ])
                for e in events:
                    writer.writerow([
                        e["id"], e["applied_at"], e["scope"], e["doc_id"] or "",
                        e["doc_title"] or "",
                        e["docs_curated"], e["units_modified"], e["units_skipped"],
                        e["ignored_count"] or "", e["manual_override_count"] or "",
                        e["preview_displayed_count"] or "", e["preview_units_changed"] or "",
                        1 if e["preview_truncated"] else 0,
                    ])
                with open(out_path, "w", encoding="utf-8-sig", newline="") as fh:
                    fh.write(buf.getvalue())
        except OSError as exc:
            self._send_error(
                f"Could not write export file: {exc}",
                code="EXPORT_WRITE_ERROR",
                http_status=500,
            )
            return

        self._send_json(success_payload({"out_path": out_path, "count": count, "format": fmt}))

    def _handle_curate_preview(self, body: dict) -> None:
        """Read-only curation simulation — never writes to DB."""
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

        # Level 8C: optional forced unit.  When provided, this unit is always
        # included in examples regardless of limit_examples, even if it:
        #   - would be beyond the top-N modifications
        #   - has a persistent 'ignore' exception (shown with preview_reason="forced_ignored")
        #   - produces no diff at all (shown as "no change" inspection entry)
        force_unit_id: int | None = body.get("force_unit_id")
        if force_unit_id is not None:
            try:
                force_unit_id = int(force_unit_id)
            except (TypeError, ValueError):
                force_unit_id = None

        try:
            rules = rules_from_list(body.get("rules", []))
        except ValueError as exc:
            self._send_error(str(exc), code=ERR_VALIDATION, http_status=400)
            return

        if not rules:
            self._send_json(success_payload({
                "doc_id": doc_id,
                "stats": {
                    "units_total": 0,
                    "units_changed": 0,
                    "replacements_total": 0,
                    "units_exception_ignored": 0,
                },
                "examples": [],
                "exceptions_active": 0,
                "fts_stale": False,
            }))
            return

        rows = self._conn().execute(
            "SELECT unit_id, external_id, text_norm FROM units WHERE doc_id = ? ORDER BY n",
            (doc_id,),
        ).fetchall()

        # Load persistent exceptions for this document via JOIN — avoids
        # a potentially huge IN(?,?,?…) list when a document has many units.
        exceptions_map: dict[int, dict] = {}
        exc_rows = self._conn().execute(
            """
            SELECT ce.unit_id, ce.kind, ce.override_text
            FROM curation_exceptions ce
            INNER JOIN units u ON u.unit_id = ce.unit_id
            WHERE u.doc_id = ?
            """,
            (doc_id,),
        ).fetchall()
        for er in exc_rows:
            exceptions_map[er[0]] = {"kind": er[1], "override_text": er[2]}

        units_total = len(rows)
        units_changed = 0
        units_exception_ignored = 0
        replacements_total = 0
        examples: list[dict] = []
        # Track whether force_unit_id was already injected (may happen naturally)
        forced_unit_injected = False

        # Pre-compile all rules once — avoids repeated LRU cache lookups per unit.
        compiled_rules = [(rule.compiled(), rule.replacement) for rule in rules]

        # Max chars for context_before / context_after to keep payload reasonable.
        # Neighbouring units can be arbitrarily long (full paragraphs), so we trim.
        _CTX_TRIM = 300

        def _ctx(row_idx: int) -> tuple[str | None, str | None]:
            cb = (rows[row_idx - 1][2] or "").strip()[:_CTX_TRIM] or None if row_idx > 0 else None
            ca = (rows[row_idx + 1][2] or "").strip()[:_CTX_TRIM] or None if row_idx < len(rows) - 1 else None
            return cb, ca

        for row_idx, row in enumerate(rows):
            unit_id = row[0]
            original = row[2] or ""
            is_forced = (force_unit_id is not None and unit_id == force_unit_id)

            # ── Persistent exception: ignore ────────────────────────────────
            exc = exceptions_map.get(unit_id)
            if exc and exc["kind"] == "ignore":
                # Simulate what the rule engine would do (to know if unit would change).
                # We count it as a change that is being suppressed, but do NOT include
                # it in examples — the user explicitly never wants to see it again.
                curated_sim = original
                for compiled_re, replacement in compiled_rules:
                    curated_sim = compiled_re.sub(replacement, curated_sim)
                if curated_sim != original:
                    units_changed += 1
                    units_exception_ignored += 1
                # Level 8C: if this unit was explicitly requested, include it anyway
                # with preview_reason="forced_ignored" so the UI can show it for inspection.
                if is_forced and not forced_unit_injected:
                    ctx_before, ctx_after = _ctx(row_idx)
                    examples.append({
                        "unit_id": unit_id,
                        "external_id": row[1],
                        "before": original,
                        "after": curated_sim if curated_sim != original else original,
                        "matched_rule_ids": [],
                        "unit_index": row_idx,
                        "context_before": ctx_before,
                        "context_after": ctx_after,
                        "is_exception_ignored": True,
                        "preview_reason": "forced_ignored",
                    })
                    forced_unit_injected = True
                continue

            # ── Persistent exception: override ──────────────────────────────
            if exc and exc["kind"] == "override":
                override_text = exc["override_text"] or ""
                if override_text != original:
                    units_changed += 1
                    # Use the regular limit guard, but bypass it for the forced unit
                    if len(examples) < limit_examples or (is_forced and not forced_unit_injected):
                        ctx_before, ctx_after = _ctx(row_idx)
                        examples.append({
                            "unit_id": unit_id,
                            "external_id": row[1],
                            "before": original,
                            "after": override_text,
                            "matched_rule_ids": [],
                            "unit_index": row_idx,
                            "context_before": ctx_before,
                            "context_after": ctx_after,
                            "is_exception_override": True,
                            "preview_reason": "forced" if is_forced else "standard",
                        })
                        if is_forced:
                            forced_unit_injected = True
                continue

            # ── Normal rule application ─────────────────────────────────────
            curated = original
            unit_reps = 0
            matched_rule_ids: list[int] = []
            for rule_idx, (compiled_re, replacement) in enumerate(compiled_rules):
                new_text, n = compiled_re.subn(replacement, curated)
                if n > 0:
                    unit_reps += n
                    if rule_idx not in matched_rule_ids:
                        matched_rule_ids.append(rule_idx)
                curated = new_text
            if curated != original:
                units_changed += 1
                replacements_total += unit_reps
                # Bypass limit guard for the explicitly forced unit
                if len(examples) < limit_examples or (is_forced and not forced_unit_injected):
                    ctx_before, ctx_after = _ctx(row_idx)
                    examples.append({
                        "unit_id": unit_id,
                        "external_id": row[1],
                        "before": original,
                        "after": curated,
                        "matched_rule_ids": matched_rule_ids,
                        "unit_index": row_idx,
                        "context_before": ctx_before,
                        "context_after": ctx_after,
                        "preview_reason": "forced" if is_forced else "standard",
                    })
                    if is_forced:
                        forced_unit_injected = True
            elif is_forced and not forced_unit_injected:
                # Unit was explicitly requested but produces no diff.
                # Include it as an "no change" inspection entry so the UI can display it.
                ctx_before, ctx_after = _ctx(row_idx)
                examples.append({
                    "unit_id": unit_id,
                    "external_id": row[1],
                    "before": original,
                    "after": original,
                    "matched_rule_ids": [],
                    "unit_index": row_idx,
                    "context_before": ctx_before,
                    "context_after": ctx_after,
                    "preview_reason": "forced_no_change",
                })
                forced_unit_injected = True

        self._send_json(success_payload({
            "doc_id": doc_id,
            "stats": {
                "units_total": units_total,
                "units_changed": units_changed,
                "replacements_total": replacements_total,
                "units_exception_ignored": units_exception_ignored,
            },
            "examples": examples,
            "exceptions_active": len(exceptions_map),
            "forced_unit_found": forced_unit_injected if force_unit_id is not None else None,
            "fts_stale": False,
        }))

    def _handle_align_audit(self, body: dict) -> None:
        """Read-only audit of alignment_links for a pivot↔target pair."""
        import json as _json

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
        include_explain = bool(body.get("include_explain", False))

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

        conn = self._conn()
        rows = conn.execute(
            f"""
            SELECT al.link_id, al.external_id, al.pivot_unit_id, al.target_unit_id,
                   pu.text_norm AS pivot_text, tu.text_norm AS target_text,
                   al.status, al.run_id
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

        # ── Batch-load run strategies for explain enrichment ─────────────────
        run_strategy: dict[str, str] = {}
        run_strategy_src: dict[str, str] = {}
        if include_explain:
            run_ids = list({r[7] for r in page if r[7] is not None})
            if run_ids:
                placeholders = ",".join("?" * len(run_ids))
                run_rows = conn.execute(
                    f"SELECT run_id, stats_json, params_json FROM runs WHERE run_id IN ({placeholders})",
                    run_ids,
                ).fetchall()
                for rr in run_rows:
                    try:
                        # params_json is PRIMARY — always set at run creation time
                        params_j = _json.loads(rr[2]) if rr[2] else {}
                        strategy = params_j.get("strategy")
                        src = "params_json"
                        if not strategy:
                            # Fallback: stats_json (populated after run completes)
                            stats = _json.loads(rr[1]) if rr[1] else {}
                            strategy = stats.get("strategy")
                            src = "stats_json"
                        run_strategy[rr[0]] = strategy or "unknown"
                        run_strategy_src[rr[0]] = src if strategy else "unknown"
                    except Exception:
                        run_strategy[rr[0]] = "unknown"
                        run_strategy_src[rr[0]] = "unknown"

        def _make_explain(row_run_id: str | None, ext_id) -> dict | None:
            if not include_explain:
                return None
            strategy = run_strategy.get(row_run_id, "unknown") if row_run_id else "unknown"
            src = run_strategy_src.get(row_run_id, "unknown") if row_run_id else "unknown"
            notes: list[str] = []
            if strategy in ("external_id", "external_id_then_position") and ext_id is not None:
                notes.append(f"linked via external_id={ext_id}")
            elif strategy == "position":
                notes.append("linked by ordinal position")
            elif strategy == "similarity":
                notes.append("linked by text similarity")
            if row_run_id:
                notes.append(f"run_id={row_run_id}")
            notes.append(f"strategy source: {src}")
            return {"strategy": strategy, "notes": notes}

        links = []
        for r in page:
            link: dict = {
                "link_id": r[0],
                "external_id": r[1],
                "pivot_unit_id": r[2],
                "target_unit_id": r[3],
                "pivot_text": r[4],
                "target_text": r[5],
                "status": r[6],
            }
            explain = _make_explain(r[7], r[1])
            if explain is not None:
                link["explain"] = explain
            links.append(link)

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

        # Selective apply (Strategy B: all except ignored)
        raw_skip = body.get("ignored_unit_ids", [])
        skip_unit_ids: set[int] | None = None
        if isinstance(raw_skip, list) and raw_skip:
            skip_unit_ids = {int(uid) for uid in raw_skip
                             if isinstance(uid, (int, float))}

        # Manual overrides: {unit_id → user-supplied replacement text}
        raw_overrides = body.get("manual_overrides", [])
        manual_overrides: dict[int, str] | None = None
        if isinstance(raw_overrides, list) and raw_overrides:
            _parsed = {
                int(item["unit_id"]): str(item["text"])
                for item in raw_overrides
                if isinstance(item, dict)
                   and "unit_id" in item and "text" in item
            }
            if _parsed:
                manual_overrides = _parsed

        with self._lock():
            if doc_id is not None:
                reports = [curate_document(self._conn(), doc_id, rules,
                                           skip_unit_ids=skip_unit_ids,
                                           manual_overrides=manual_overrides)]
            else:
                reports = curate_all_documents(self._conn(), rules,
                                               skip_unit_ids=skip_unit_ids,
                                               manual_overrides=manual_overrides)
        total_modified = sum(r.units_modified for r in reports)
        total_skipped  = sum(r.units_skipped  for r in reports)
        self._send_json(success_payload({
            "docs_curated": len(reports),
            "units_modified": total_modified,
            "units_skipped": total_skipped,
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

    def _handle_annotate(self, body: dict) -> None:
        """POST /annotate — enqueue spaCy annotation job(s).

        Body:
          - {doc_id, model?}
          - or {all_docs: true, model?}
        """
        all_docs = bool(body.get("all_docs", False))
        model = body.get("model")
        if model is not None and (not isinstance(model, str) or not model.strip()):
            self._send_error(
                "model must be a non-empty string when provided",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        params: dict[str, object] = {}
        if model is not None:
            params["model"] = model.strip()

        if all_docs:
            params["all_docs"] = True
        else:
            if "doc_id" not in body:
                self._send_error(
                    "doc_id is required unless all_docs=true",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return
            try:
                params["doc_id"] = int(body.get("doc_id"))
            except (TypeError, ValueError):
                self._send_error(
                    "doc_id must be an integer",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return

        job = self._jobs().submit(
            kind="annotate",
            params=params,
            runner=self.server.job_runner,  # type: ignore[attr-defined]
        )
        self._send_json(
            success_payload({"job": job.to_dict()}, status="accepted"),
            status=202,
        )

    def _handle_segment_detect_markers(self, body: dict) -> None:
        """POST /segment/detect_markers — detect [N] markers in existing units (no writes)."""
        from multicorpus_engine.segmenter import detect_markers_in_units

        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error("doc_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            doc_id = int(doc_id)
        except (TypeError, ValueError):
            self._send_error("doc_id must be an integer", code=ERR_BAD_REQUEST, http_status=400)
            return

        conn = self._conn()
        report = detect_markers_in_units(conn, doc_id)
        self._send_json(success_payload({"doc_id": doc_id, **report}))

    def _handle_segment_preview(self, body: dict) -> None:
        """POST /segment/preview — run segmentation in-memory, no DB writes.

        Supports two modes (body.mode):
          "sentences" (default) — sentence-splitting via pack rules
          "markers"             — split on embedded [N] markers, expose external_id
        """
        from multicorpus_engine.segmenter import (
            segment_text, resolve_segment_pack, segment_text_markers,
        )

        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error("doc_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            doc_id = int(doc_id)
        except (TypeError, ValueError):
            self._send_error("doc_id must be an integer", code=ERR_BAD_REQUEST, http_status=400)
            return

        mode = str(body.get("mode") or "sentences").strip().lower()
        if mode not in ("sentences", "markers"):
            self._send_error(
                "mode must be 'sentences' or 'markers'",
                code=ERR_BAD_REQUEST, http_status=400,
            )
            return

        calibrate_to_raw = body.get("calibrate_to")
        calibrate_to: int | None = None
        if calibrate_to_raw is not None:
            try:
                calibrate_to = int(calibrate_to_raw)
            except (TypeError, ValueError):
                self._send_error("calibrate_to must be an integer", code=ERR_BAD_REQUEST, http_status=400)
                return

        lang = str(body.get("lang") or "und")
        pack = str(body.get("pack") or "auto")
        limit = body.get("limit", 300)
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = 300

        conn = self._conn()
        units = conn.execute(
            "SELECT n, text_norm FROM units WHERE doc_id = ? AND unit_type = 'line' ORDER BY n",
            (doc_id,),
        ).fetchall()

        if not units:
            self._send_error(
                f"No units found for doc_id={doc_id}",
                code=ERR_NOT_FOUND, http_status=404,
            )
            return

        segments: list[dict] = []
        warnings: list[str] = []
        seg_n = 1

        if mode == "markers":
            units_with_marker = 0
            for unit_n, text_norm in units:
                if not text_norm or not text_norm.strip():
                    continue
                parts = segment_text_markers(text_norm)
                for ext_id, text in parts:
                    if seg_n > limit:
                        warnings.append(f"Preview truncated at {limit} segments.")
                        break
                    if ext_id is not None:
                        units_with_marker += 1
                    segments.append({
                        "n": seg_n,
                        "text": text,
                        "source_unit_n": int(unit_n),
                        "external_id": ext_id,
                    })
                    seg_n += 1
                if seg_n > limit:
                    break
            resolved_pack = "markers"
            if units_with_marker == 0:
                warnings.append("Aucune balise [N] trouvée dans ce document.")
        else:
            resolved_pack = resolve_segment_pack(pack, lang)
            for unit_n, text_norm in units:
                if not text_norm or not text_norm.strip():
                    continue
                try:
                    phrases = segment_text(text_norm, lang, resolved_pack)
                except Exception as exc:  # noqa: BLE001
                    warnings.append(f"unit {unit_n}: {exc}")
                    phrases = [text_norm]
                for phrase in phrases:
                    if seg_n > limit:
                        warnings.append(f"Preview truncated at {limit} segments (document has more).")
                        break
                    segments.append({
                        "n": seg_n,
                        "text": phrase,
                        "source_unit_n": int(unit_n),
                        "external_id": None,
                    })
                    seg_n += 1
                if seg_n > limit:
                    break

        calibrate_ratio_pct: int | None = None
        if calibrate_to is not None and len(segments) > 0:
            ref_count = conn.execute(
                "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                (calibrate_to,),
            ).fetchone()[0]
            if ref_count > 0:
                ratio = abs(len(segments) - ref_count) / ref_count
                calibrate_ratio_pct = round(ratio * 100)
                if ratio > 0.15:
                    warnings.append(
                        f"Le nombre de segments diffère de {calibrate_ratio_pct}\u202f% "
                        f"par rapport au document de référence #{calibrate_to} "
                        f"({len(segments)} segments vs {ref_count} attendus). "
                        f"Vérifier la stratégie de segmentation ou le document source."
                    )

        payload = {
            "doc_id": doc_id,
            "mode": mode,
            "units_input": len(units),
            "units_output": len(segments),
            "segment_pack": resolved_pack,
            "segments": segments,
            "warnings": warnings,
        }
        if calibrate_to is not None:
            payload["calibrate_to"] = calibrate_to
            payload["calibrate_ratio_pct"] = calibrate_ratio_pct
        self._send_json(success_payload(payload))

    def _handle_units_merge(self, body: dict) -> None:
        """POST /units/merge — merge two adjacent units into one.

        Body: { doc_id, n1, n2 }
          n1 and n2 must be adjacent (n2 == n1 + 1).
          The merged text is stored in the unit with n1.
          All units with n > n2 are renumbered n-1.
          Any alignment_links for either unit are deleted.
        """
        doc_id = body.get("doc_id")
        n1_raw = body.get("n1")
        n2_raw = body.get("n2")
        if doc_id is None or n1_raw is None or n2_raw is None:
            self._send_error("doc_id, n1 and n2 are required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            doc_id = int(doc_id)
            n1 = int(n1_raw)
            n2 = int(n2_raw)
        except (TypeError, ValueError):
            self._send_error("doc_id, n1, n2 must be integers", code=ERR_BAD_REQUEST, http_status=400)
            return
        if n2 != n1 + 1:
            self._send_error(f"n1 and n2 must be adjacent (got n1={n1}, n2={n2})", code=ERR_BAD_REQUEST, http_status=400)
            return

        with self._lock():
            conn = self._conn()
            row1 = conn.execute(
                "SELECT unit_id, text_raw, text_norm FROM units WHERE doc_id=? AND n=? AND unit_type='line'",
                (doc_id, n1),
            ).fetchone()
            row2 = conn.execute(
                "SELECT unit_id, text_raw, text_norm FROM units WHERE doc_id=? AND n=? AND unit_type='line'",
                (doc_id, n2),
            ).fetchone()
            if not row1 or not row2:
                self._send_error(
                    f"Units n={n1} or n={n2} not found for doc_id={doc_id}",
                    code=ERR_NOT_FOUND, http_status=404,
                )
                return

            merged_raw = (row1["text_raw"] or "").rstrip() + " " + (row2["text_raw"] or "").lstrip()
            merged_norm = (row1["text_norm"] or "").rstrip() + " " + (row2["text_norm"] or "").lstrip()

            # Delete alignment links for both units (keyed by unit_id, not n)
            uid1 = int(row1["unit_id"])
            uid2 = int(row2["unit_id"])
            conn.execute(
                "DELETE FROM alignment_links WHERE"
                " pivot_unit_id IN (?,?) OR target_unit_id IN (?,?)",
                (uid1, uid2, uid1, uid2),
            )

            # Update unit n1 with merged text
            conn.execute(
                "UPDATE units SET text_raw=?, text_norm=? WHERE doc_id=? AND n=?",
                (merged_raw, merged_norm, doc_id, n1),
            )

            # Delete unit n2
            conn.execute("DELETE FROM units WHERE doc_id=? AND n=?", (doc_id, n2))

            # Renumber all units with n > n2 (shift down by 1)
            conn.execute(
                "UPDATE units SET n = n - 1 WHERE doc_id=? AND n > ?",
                (doc_id, n2),
            )

            conn.commit()

        self._send_json(success_payload({
            "doc_id": doc_id,
            "merged_n": n1,
            "deleted_n": n2,
            "text": merged_norm,
        }))

    def _handle_units_split(self, body: dict) -> None:
        """POST /units/split — split one unit into two at a given text boundary.

        Body: { doc_id, unit_n, text_a, text_b }
          unit_n   — the n of the unit to split
          text_a   — text for the first (existing) unit
          text_b   — text for the new unit inserted at n+1
          All units with n > unit_n are renumbered n+1.
          Alignment links for unit_n are deleted (split invalidates alignment).
        """
        doc_id = body.get("doc_id")
        unit_n_raw = body.get("unit_n")
        text_a = body.get("text_a", "")
        text_b = body.get("text_b", "")
        if doc_id is None or unit_n_raw is None:
            self._send_error("doc_id and unit_n are required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            doc_id = int(doc_id)
            unit_n = int(unit_n_raw)
        except (TypeError, ValueError):
            self._send_error("doc_id and unit_n must be integers", code=ERR_BAD_REQUEST, http_status=400)
            return
        text_a = (text_a or "").strip()
        text_b = (text_b or "").strip()
        if not text_a or not text_b:
            self._send_error("text_a and text_b must be non-empty", code=ERR_BAD_REQUEST, http_status=400)
            return

        with self._lock():
            conn = self._conn()
            row = conn.execute(
                "SELECT unit_id, external_id FROM units WHERE doc_id=? AND n=? AND unit_type='line'",
                (doc_id, unit_n),
            ).fetchone()
            if not row:
                self._send_error(
                    f"Unit n={unit_n} not found for doc_id={doc_id}",
                    code=ERR_NOT_FOUND, http_status=404,
                )
                return

            # Delete alignment links for this unit (keyed by unit_id, not n)
            uid = int(row["unit_id"])
            conn.execute(
                "DELETE FROM alignment_links WHERE"
                " pivot_unit_id=? OR target_unit_id=?",
                (uid, uid),
            )

            # Shift all units after unit_n up by 1 to make room
            conn.execute(
                "UPDATE units SET n = n + 1 WHERE doc_id=? AND n > ?",
                (doc_id, unit_n),
            )

            # Update the original unit with text_a
            conn.execute(
                "UPDATE units SET text_raw=?, text_norm=?, external_id=NULL WHERE doc_id=? AND n=?",
                (text_a, text_a, doc_id, unit_n),
            )

            # Insert new unit at n+1 with text_b
            conn.execute(
                "INSERT INTO units (doc_id, unit_type, n, external_id, text_raw, text_norm, meta_json)"
                " VALUES (?, 'line', ?, NULL, ?, ?, NULL)",
                (doc_id, unit_n + 1, text_b, text_b),
            )

            conn.commit()

        self._send_json(success_payload({
            "doc_id": doc_id,
            "unit_n": unit_n,
            "new_unit_n": unit_n + 1,
            "text_a": text_a,
            "text_b": text_b,
        }))

    def _handle_segment(self, body: dict) -> None:
        from multicorpus_engine.segmenter import resegment_document

        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error("doc_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            doc_id = int(doc_id)
        except (TypeError, ValueError):
            self._send_error("doc_id must be an integer", code=ERR_BAD_REQUEST, http_status=400)
            return
        pack = body.get("pack", "auto")
        if pack is not None and not isinstance(pack, str):
            self._send_error("pack must be a string when provided", code=ERR_BAD_REQUEST, http_status=400)
            return
        lang = body.get("lang", "und")
        if lang is not None and not isinstance(lang, str):
            self._send_error("lang must be a string when provided", code=ERR_BAD_REQUEST, http_status=400)
            return

        # Optional: calibrate_to=doc_id of reference document for ratio check
        calibrate_to_raw = body.get("calibrate_to")
        calibrate_to: int | None = None
        if calibrate_to_raw is not None:
            try:
                calibrate_to = int(calibrate_to_raw)
            except (TypeError, ValueError):
                self._send_error("calibrate_to must be an integer", code=ERR_BAD_REQUEST, http_status=400)
                return

        with self._lock():
            report = resegment_document(
                self._conn(),
                doc_id=doc_id,
                lang=lang or "und",
                pack=pack,
            )
            # Ratio check against reference document
            calibrate_ratio_pct: int | None = None
            calibrate_warning: str | None = None
            if calibrate_to is not None and report.units_output > 0:
                ref_count = self._conn().execute(
                    "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                    (calibrate_to,),
                ).fetchone()[0]
                if ref_count > 0:
                    ratio = abs(report.units_output - ref_count) / ref_count
                    calibrate_ratio_pct = round(ratio * 100)
                    if ratio > 0.15:
                        calibrate_warning = (
                            f"Le nombre de segments diffère de {calibrate_ratio_pct}\u202f% "
                            f"par rapport au document de référence #{calibrate_to} "
                            f"({report.units_output} segments vs {ref_count} attendus). "
                            f"Vérifier la stratégie de segmentation ou le document source."
                        )
                        report.warnings.append(calibrate_warning)

        payload = {"fts_stale": True, **report.to_dict()}
        if calibrate_to is not None:
            payload["calibrate_to"] = calibrate_to
            payload["calibrate_ratio_pct"] = calibrate_ratio_pct
        self._send_json(success_payload(payload))

    def _handle_family_segment(self, family_root_id: int, body: dict) -> None:
        """POST /families/{family_root_id}/segment — segment all docs in a family.

        Body fields (all optional):
          pack        : segmentation pack ("auto"|"default"|"fr_strict"|"en_strict")
          force       : bool — if true, re-segment even already-segmented docs (default false)
          lang_map    : {str(doc_id): lang} — per-doc language override

        Response per-doc status values:
          "segmented" — segmentation ran successfully
          "skipped"   — doc was already segmented and force=false
          "error"     — segmentation raised an exception

        Order: parent is processed first, then children in doc_id order.
        After segmenting children, a ratio warning is added when the child
        segment count differs by more than 15 % from the parent.
        """
        from multicorpus_engine.segmenter import resegment_document

        pack      = body.get("pack", "auto") or "auto"
        force     = bool(body.get("force", False))
        lang_map  = body.get("lang_map") or {}

        conn = self._conn()

        # ── Build the family ────────────────────────────────────────────────
        # Verify parent exists
        parent_row = conn.execute(
            "SELECT doc_id, language FROM documents WHERE doc_id = ?", (family_root_id,)
        ).fetchone()
        if parent_row is None:
            self._send_error(
                f"Document doc_id={family_root_id} not found",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return

        child_rows = conn.execute(
            "SELECT r.doc_id, d.language FROM doc_relations r"
            " JOIN documents d ON d.doc_id = r.doc_id"
            " WHERE r.target_doc_id = ? AND r.relation_type IN ('translation_of', 'excerpt_of')"
            " ORDER BY r.doc_id",
            (family_root_id,),
        ).fetchall()

        if not child_rows:
            self._send_error(
                f"No children found for family root doc_id={family_root_id}",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        # ── Helper: is a doc already segmented? ────────────────────────────
        def _is_segmented(doc_id: int) -> bool:
            return conn.execute(
                "SELECT 1 FROM units WHERE doc_id = ? AND unit_type = 'line' LIMIT 1",
                (doc_id,),
            ).fetchone() is not None

        def _seg_count(doc_id: int) -> int:
            row = conn.execute(
                "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                (doc_id,),
            ).fetchone()
            return row[0] if row else 0

        # ── Helper: add ratio warning to an entry dict ──────────────────────
        def _add_ratio_warning(entry: dict, child_count: int, ref: int | None, doc_id: int) -> dict:
            if ref is None or ref == 0 or child_count == 0:
                return entry
            ratio = abs(child_count - ref) / ref
            entry["calibrate_ratio_pct"] = round(ratio * 100)
            if ratio > 0.15:
                entry["warnings"] = list(entry.get("warnings", [])) + [
                    f"Segment count differs by {round(ratio * 100)} % from parent "
                    f"({ref} units) — doc #{doc_id} has {child_count} units"
                ]
            return entry

        # ── Process docs: parent first, then children ───────────────────────
        results = []
        parent_seg_count: int | None = None

        all_docs = [(family_root_id, parent_row[1])] + [(r[0], r[1]) for r in child_rows]

        with self._lock():
            for idx, (doc_id, db_lang) in enumerate(all_docs):
                lang = str(lang_map.get(str(doc_id), lang_map.get(doc_id, db_lang or "und")))
                already = _is_segmented(doc_id)

                if already and not force:
                    count = _seg_count(doc_id)
                    entry: dict = {
                        "doc_id": doc_id,
                        "status": "skipped",
                        "units_input": count,
                        "units_output": count,
                        "segment_pack": None,
                        "warnings": ["Already segmented — use force=true to re-segment"],
                    }
                    if idx == 0:
                        parent_seg_count = count
                    else:
                        entry = _add_ratio_warning(entry, count, parent_seg_count, doc_id)
                    results.append(entry)
                    continue

                try:
                    report = resegment_document(conn, doc_id=doc_id, lang=lang, pack=pack)
                    entry = {
                        "doc_id": doc_id,
                        "status": "segmented",
                        **report.to_dict(),
                    }
                    if idx == 0:
                        parent_seg_count = report.units_output
                    else:
                        entry = _add_ratio_warning(
                            entry, report.units_output, parent_seg_count, doc_id
                        )
                    results.append(entry)
                except Exception as exc:  # noqa: BLE001
                    results.append({
                        "doc_id": doc_id,
                        "status": "error",
                        "units_input": 0,
                        "units_output": 0,
                        "segment_pack": None,
                        "warnings": [str(exc)],
                    })

        segmented_count = sum(1 for r in results if r["status"] == "segmented")
        skipped_count   = sum(1 for r in results if r["status"] == "skipped")
        error_count     = sum(1 for r in results if r["status"] == "error")

        self._send_json(success_payload({
            "family_root_id": family_root_id,
            "fts_stale": segmented_count > 0,
            "results": results,
            "summary": {
                "total": len(results),
                "segmented": segmented_count,
                "skipped": skipped_count,
                "errors": error_count,
            },
        }))

    def _handle_documents(self) -> None:
        self._ensure_document_workflow_columns()
        self._ensure_tokens_table()
        rows = self._conn().execute(
            """
            SELECT d.doc_id, d.title, d.language, d.doc_role, d.resource_type,
                   d.workflow_status, d.validated_at, d.validated_run_id,
                   d.source_path, d.source_hash,
                   COALESCE(uc.unit_count, 0) AS unit_count,
                   COALESCE(tc.token_count, 0) AS token_count,
                   CASE WHEN COALESCE(tc.token_count, 0) > 0 THEN 'annotated' ELSE 'missing' END AS annotation_status,
                   d.author_lastname, d.author_firstname, d.doc_date
            FROM documents d
            LEFT JOIN (
                SELECT doc_id, COUNT(*) AS unit_count
                FROM units
                WHERE unit_type = 'line'
                GROUP BY doc_id
            ) uc ON uc.doc_id = d.doc_id
            LEFT JOIN (
                SELECT u.doc_id, COUNT(t.token_id) AS token_count
                FROM units u
                JOIN tokens t ON t.unit_id = u.unit_id
                GROUP BY u.doc_id
            ) tc ON tc.doc_id = d.doc_id
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
                "workflow_status": r[5],
                "validated_at": r[6],
                "validated_run_id": r[7],
                "source_path": r[8],
                "source_hash": r[9],
                "unit_count": r[10],
                "token_count": r[11],
                "annotation_status": r[12],
                "author_lastname": r[13],
                "author_firstname": r[14],
                "doc_date": r[15],
            }
            for r in rows
        ]
        self._send_json(success_payload({"documents": documents, "count": len(documents)}))

    def _ensure_document_workflow_columns(self) -> None:
        """Backfill optional document columns when running against legacy DB schemas."""
        required = {
            "workflow_status", "validated_at", "validated_run_id",
            "author_lastname", "author_firstname", "doc_date",
        }
        cols = {
            row[1]
            for row in self._conn().execute("PRAGMA table_info(documents)").fetchall()
        }
        if required.issubset(cols):
            return

        with self._lock():
            cols = {
                row[1]
                for row in self._conn().execute("PRAGMA table_info(documents)").fetchall()
            }
            if "workflow_status" not in cols:
                self._conn().execute(
                    "ALTER TABLE documents ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'draft'"
                )
            if "validated_at" not in cols:
                self._conn().execute("ALTER TABLE documents ADD COLUMN validated_at TEXT")
            if "validated_run_id" not in cols:
                self._conn().execute(
                    "ALTER TABLE documents ADD COLUMN validated_run_id TEXT"
                )
            if "author_lastname" not in cols:
                self._conn().execute("ALTER TABLE documents ADD COLUMN author_lastname TEXT")
            if "author_firstname" not in cols:
                self._conn().execute("ALTER TABLE documents ADD COLUMN author_firstname TEXT")
            if "doc_date" not in cols:
                self._conn().execute("ALTER TABLE documents ADD COLUMN doc_date TEXT")
            self._conn().execute(
                "CREATE INDEX IF NOT EXISTS idx_documents_workflow_status ON documents (workflow_status)"
            )
            self._conn().commit()

    def _ensure_tokens_table(self) -> None:
        """Backfill tokens table for legacy DB schemas that predate migration 012."""
        exists = self._conn().execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tokens'"
        ).fetchone()
        if exists:
            return
        with self._lock():
            exists_locked = self._conn().execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tokens'"
            ).fetchone()
            if exists_locked:
                return
            self._conn().execute(
                """
                CREATE TABLE IF NOT EXISTS tokens (
                    token_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                    unit_id    INTEGER NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
                    sent_id    INTEGER NOT NULL,
                    position   INTEGER NOT NULL,
                    word       TEXT,
                    lemma      TEXT,
                    upos       TEXT,
                    xpos       TEXT,
                    feats      TEXT,
                    misc       TEXT
                )
                """
            )
            self._conn().execute(
                "CREATE INDEX IF NOT EXISTS idx_tokens_unit ON tokens (unit_id)"
            )
            self._conn().execute(
                "CREATE INDEX IF NOT EXISTS idx_tokens_lemma ON tokens (lemma)"
            )
            self._conn().execute(
                "CREATE INDEX IF NOT EXISTS idx_tokens_upos ON tokens (upos)"
            )
            self._conn().execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_unit_sent_pos "
                "ON tokens (unit_id, sent_id, position)"
            )
            self._conn().commit()

    def _handle_documents_preview(self, qs: dict[str, list[str]]) -> None:
        doc_id_raw = (qs.get("doc_id") or [None])[0]
        if doc_id_raw is None:
            self._send_error(
                "doc_id query param is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        try:
            doc_id = int(doc_id_raw)
        except (TypeError, ValueError):
            self._send_error(
                "doc_id must be an integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        limit_raw = (qs.get("limit") or ["6"])[0]
        try:
            limit = int(limit_raw)
        except (TypeError, ValueError):
            self._send_error(
                "limit must be an integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if limit < 1 or limit > 500:
            self._send_error(
                "limit must be between 1 and 500",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        self._ensure_document_workflow_columns()

        doc_row = self._conn().execute(
            """
            SELECT doc_id, title, language, doc_role, resource_type,
                   workflow_status, validated_at, validated_run_id,
                   author_lastname, author_firstname, doc_date
            FROM documents
            WHERE doc_id = ?
            """,
            (doc_id,),
        ).fetchone()
        if doc_row is None:
            self._send_error(
                f"Unknown doc_id: {doc_id}",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return

        total_lines = (
            self._conn()
            .execute(
                "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                (doc_id,),
            )
            .fetchone()[0]
            or 0
        )
        line_rows = self._conn().execute(
            """
            SELECT unit_id, n, external_id, text_norm
            FROM units
            WHERE doc_id = ? AND unit_type = 'line'
            ORDER BY n
            LIMIT ?
            """,
            (doc_id, limit),
        ).fetchall()
        lines = [
            {
                "unit_id": row[0],
                "n": row[1],
                "external_id": row[2],
                "text": row[3],
            }
            for row in line_rows
        ]

        self._send_json(
            success_payload(
                {
                    "doc": {
                        "doc_id": doc_row[0],
                        "title": doc_row[1],
                        "language": doc_row[2],
                        "doc_role": doc_row[3],
                        "resource_type": doc_row[4],
                        "workflow_status": doc_row[5],
                        "validated_at": doc_row[6],
                        "validated_run_id": doc_row[7],
                        "author_lastname": doc_row[8],
                        "author_firstname": doc_row[9],
                        "doc_date": doc_row[10],
                    },
                    "lines": lines,
                    "count": len(lines),
                    "total_lines": total_lines,
                    "limit": limit,
                }
            )
        )

    def _handle_tokens_list(self, qs: dict[str, list[str]]) -> None:
        """GET /tokens?doc_id=&unit_id=&limit=&offset= — list token rows for manual edits."""
        self._ensure_tokens_table()

        doc_id_raw = (qs.get("doc_id") or [None])[0]
        if doc_id_raw is None:
            self._send_error(
                "doc_id query param is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        try:
            doc_id = int(doc_id_raw)
        except (TypeError, ValueError):
            self._send_error(
                "doc_id must be an integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if doc_id <= 0:
            self._send_error(
                "doc_id must be a positive integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        unit_id_raw = (qs.get("unit_id") or [None])[0]
        unit_id: int | None = None
        if unit_id_raw is not None:
            try:
                unit_id = int(unit_id_raw)
            except (TypeError, ValueError):
                self._send_error(
                    "unit_id must be an integer",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return
            if unit_id <= 0:
                self._send_error(
                    "unit_id must be a positive integer",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return

        limit_raw = (qs.get("limit") or ["200"])[0]
        offset_raw = (qs.get("offset") or ["0"])[0]
        try:
            limit = int(limit_raw)
            offset = int(offset_raw)
        except (TypeError, ValueError):
            self._send_error(
                "limit and offset must be integers",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if limit < 1 or limit > 1000:
            self._send_error(
                "limit must be between 1 and 1000",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if offset < 0:
            self._send_error(
                "offset must be >= 0",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        filters = ["u.doc_id = ?"]
        params: list[object] = [doc_id]
        if unit_id is not None:
            filters.append("t.unit_id = ?")
            params.append(unit_id)
        where_sql = " AND ".join(filters)

        total = int(
            self._conn()
            .execute(
                f"""
                SELECT COUNT(*)
                FROM tokens t
                JOIN units u ON u.unit_id = t.unit_id
                WHERE {where_sql}
                """,
                params,
            )
            .fetchone()[0]
            or 0
        )
        rows = self._conn().execute(
            f"""
            SELECT
                t.token_id,
                u.doc_id,
                t.unit_id,
                u.n AS unit_n,
                u.external_id,
                t.sent_id,
                t.position,
                t.word,
                t.lemma,
                t.upos,
                t.xpos,
                t.feats,
                t.misc
            FROM tokens t
            JOIN units u ON u.unit_id = t.unit_id
            WHERE {where_sql}
            ORDER BY u.n, t.sent_id, t.position
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        tokens = [
            {
                "token_id": r[0],
                "doc_id": r[1],
                "unit_id": r[2],
                "unit_n": r[3],
                "external_id": r[4],
                "sent_id": r[5],
                "position": r[6],
                "word": r[7],
                "lemma": r[8],
                "upos": r[9],
                "xpos": r[10],
                "feats": r[11],
                "misc": r[12],
            }
            for r in rows
        ]
        count = len(tokens)
        has_more = (offset + count) < total
        next_offset = offset + limit if has_more else None

        self._send_json(
            success_payload(
                {
                    "doc_id": doc_id,
                    "unit_id": unit_id,
                    "tokens": tokens,
                    "count": count,
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                    "next_offset": next_offset,
                    "has_more": has_more,
                }
            )
        )

    def _handle_tokens_update(self, body: dict) -> None:
        """POST /tokens/update — update token annotations for one token row."""
        self._ensure_tokens_table()

        token_id_raw = body.get("token_id")
        if token_id_raw is None:
            self._send_error(
                "token_id is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        try:
            token_id = int(token_id_raw)
        except (TypeError, ValueError):
            self._send_error(
                "token_id must be an integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if token_id <= 0:
            self._send_error(
                "token_id must be a positive integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        allowed = ("word", "lemma", "upos", "xpos", "feats", "misc")
        updates: dict[str, object] = {}
        for key in allowed:
            if key not in body:
                continue
            value = body.get(key)
            if value is None:
                updates[key] = None
            elif isinstance(value, str):
                updates[key] = value
            else:
                self._send_error(
                    f"{key} must be a string or null",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return
        if not updates:
            self._send_error(
                "No updatable token fields provided (allowed: word, lemma, upos, xpos, feats, misc)",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        set_clause = ", ".join(f"{field} = ?" for field in updates)
        params = [*updates.values(), token_id]

        with self._lock():
            cur = self._conn().execute(
                f"UPDATE tokens SET {set_clause} WHERE token_id = ?",
                params,
            )
            self._conn().commit()
            updated = cur.rowcount

        if updated == 0:
            self._send_error(
                f"Unknown token_id: {token_id}",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return

        row = self._conn().execute(
            """
            SELECT
                t.token_id,
                u.doc_id,
                t.unit_id,
                u.n AS unit_n,
                u.external_id,
                t.sent_id,
                t.position,
                t.word,
                t.lemma,
                t.upos,
                t.xpos,
                t.feats,
                t.misc
            FROM tokens t
            JOIN units u ON u.unit_id = t.unit_id
            WHERE t.token_id = ?
            """,
            (token_id,),
        ).fetchone()
        if row is None:
            self._send_error(
                f"Unknown token_id: {token_id}",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return

        token = {
            "token_id": row[0],
            "doc_id": row[1],
            "unit_id": row[2],
            "unit_n": row[3],
            "external_id": row[4],
            "sent_id": row[5],
            "position": row[6],
            "word": row[7],
            "lemma": row[8],
            "upos": row[9],
            "xpos": row[10],
            "feats": row[11],
            "misc": row[12],
        }
        self._send_json(success_payload({"updated": 1, "token": token}))

    def _handle_unit_context(self, qs: dict[str, list[str]]) -> None:
        """GET /unit/context?unit_id=N&window=N — reading window around a unit.

        Returns a ``window``-wide slice of the document centred on the requested
        unit, with each item tagged ``is_current``.  Default window = 3 (±3 units),
        maximum = 10.  Handles document boundaries gracefully.
        """
        unit_id_raw = (qs.get("unit_id") or [None])[0]
        if unit_id_raw is None:
            self._send_error(
                "unit_id query param is required",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        try:
            unit_id = int(unit_id_raw)
        except (TypeError, ValueError):
            self._send_error(
                "unit_id must be an integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        if unit_id <= 0:
            self._send_error(
                "unit_id must be a positive integer",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        window_raw = (qs.get("window") or ["3"])[0]
        try:
            window = max(1, min(10, int(window_raw)))
        except (TypeError, ValueError):
            window = 3

        self._ensure_document_workflow_columns()

        cur = self._conn().execute(
            "SELECT unit_id, doc_id, n, external_id, text_norm FROM units WHERE unit_id = ? AND unit_type = 'line'",
            (unit_id,),
        ).fetchone()
        if cur is None:
            self._send_error(
                f"Unknown or non-line unit_id: {unit_id}",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return

        cur_unit_id, doc_id, n_cur, _external_id, text_norm = cur

        total_units = (
            self._conn()
            .execute(
                "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                (doc_id,),
            )
            .fetchone()[0]
            or 0
        )
        unit_index_1based = (
            self._conn()
            .execute(
                "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line' AND n <= ?",
                (doc_id, n_cur),
            )
            .fetchone()[0]
            or 0
        )

        # Fetch `window` units before current (ORDER BY n DESC → reverse for chronological order)
        before_rows = self._conn().execute(
            """
            SELECT unit_id, text_norm
            FROM units
            WHERE doc_id = ? AND unit_type = 'line' AND n < ?
            ORDER BY n DESC
            LIMIT ?
            """,
            (doc_id, n_cur, window),
        ).fetchall()
        before_rows = list(reversed(before_rows))  # restore chronological order

        # Fetch `window` units after current
        after_rows = self._conn().execute(
            """
            SELECT unit_id, text_norm
            FROM units
            WHERE doc_id = ? AND unit_type = 'line' AND n > ?
            ORDER BY n ASC
            LIMIT ?
            """,
            (doc_id, n_cur, window),
        ).fetchall()

        def _item(uid: int, text: str, is_current: bool) -> dict:
            return {"unit_id": uid, "text": (text or "").strip(), "is_current": is_current}

        items = (
            [_item(r[0], r[1], False) for r in before_rows]
            + [_item(cur_unit_id, text_norm, True)]
            + [_item(r[0], r[1], False) for r in after_rows]
        )

        self._send_json(success_payload({
            "doc_id": doc_id,
            "unit_id": cur_unit_id,
            "unit_index": unit_index_1based,
            "total_units": total_units,
            "window_before": len(before_rows),
            "window_after": len(after_rows),
            "items": items,
        }))

    def _handle_family_align(self, family_root_id: int, body: dict) -> None:
        """POST /families/{family_root_id}/align — align all parent↔child pairs in a family.

        Body fields (all optional):
          strategy         : "position" (default) | "external_id" | "external_id_then_position" | "similarity"
          sim_threshold    : float in [0, 1], default 0.8 (only used with "similarity")
          replace_existing : bool, default false — delete previous links before alignment
          preserve_accepted: bool, default true — keep accepted links when replace_existing=true
          skip_unready     : bool, default false — if true, skip pairs where child is not segmented;
                             if false (default), return an error listing unready children

        Returns per-pair results with links_created, and a summary.
        Refuses to align two children against each other (only parent↔child pairs).
        """
        from multicorpus_engine.runs import RunIdConflictError

        conn = self._conn()

        # ── Validate params ─────────────────────────────────────────────────
        strategy = str(body.get("strategy", "position"))
        allowed_strategies = {"external_id", "position", "similarity", "external_id_then_position"}
        if strategy not in allowed_strategies:
            self._send_error(
                f"Unsupported align strategy: {strategy!r}",
                code=ERR_BAD_REQUEST, http_status=400,
                details={"supported_strategies": sorted(allowed_strategies)},
            )
            return

        threshold = 0.8
        if strategy == "similarity":
            try:
                threshold = float(body.get("sim_threshold", 0.8))
            except (TypeError, ValueError):
                self._send_error("sim_threshold must be a number", code=ERR_BAD_REQUEST, http_status=400)
                return
            if not 0.0 <= threshold <= 1.0:
                self._send_error("sim_threshold must be in [0.0, 1.0]", code=ERR_BAD_REQUEST, http_status=400)
                return

        replace_existing  = bool(body.get("replace_existing",  False))
        preserve_accepted = bool(body.get("preserve_accepted", True))
        skip_unready      = bool(body.get("skip_unready",      False))

        # ── Build the family ─────────────────────────────────────────────────
        parent_row = conn.execute(
            "SELECT doc_id, language FROM documents WHERE doc_id = ?", (family_root_id,)
        ).fetchone()
        if parent_row is None:
            self._send_error(
                f"Document doc_id={family_root_id} not found",
                code=ERR_NOT_FOUND, http_status=404,
            )
            return

        child_rows = conn.execute(
            "SELECT r.doc_id, d.language, r.relation_type FROM doc_relations r"
            " JOIN documents d ON d.doc_id = r.doc_id"
            " WHERE r.target_doc_id = ? AND r.relation_type IN ('translation_of', 'excerpt_of')"
            " ORDER BY r.doc_id",
            (family_root_id,),
        ).fetchall()

        if not child_rows:
            self._send_error(
                f"No children found for family root doc_id={family_root_id}",
                code=ERR_BAD_REQUEST, http_status=400,
            )
            return

        child_ids = [r[0] for r in child_rows]
        child_rel  = {r[0]: r[2] for r in child_rows}   # doc_id → relation_type
        child_lang = {r[0]: r[1] for r in child_rows}   # doc_id → language

        # ── Segmentation readiness check ─────────────────────────────────────
        def _seg_count(doc_id: int) -> int:
            row = conn.execute(
                "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                (doc_id,),
            ).fetchone()
            return row[0] if row else 0

        parent_seg = _seg_count(family_root_id)
        unready: list[int] = []
        if parent_seg == 0:
            unready.append(family_root_id)
        for cid in child_ids:
            if _seg_count(cid) == 0:
                unready.append(cid)

        if unready and not skip_unready:
            self._send_error(
                f"{len(unready)} doc(s) not yet segmented — segment first or use skip_unready=true",
                code=ERR_BAD_REQUEST, http_status=400,
                details={"unready_doc_ids": unready},
            )
            return

        # Narrow down to ready pairs
        ready_child_ids = [
            cid for cid in child_ids
            if cid not in unready and family_root_id not in unready
        ]

        if not ready_child_ids:
            self._send_error(
                "No ready pairs to align (all children or parent not segmented)",
                code=ERR_BAD_REQUEST, http_status=400,
            )
            return

        # ── Run alignment per pair ────────────────────────────────────────────
        results = []
        total_links = 0
        total_skipped = 0

        with self._lock():
            for target_doc_id in ready_child_ids:
                run_params: dict[str, object] = {
                    "pivot_doc_id": family_root_id,
                    "target_doc_ids": [target_doc_id],
                    "strategy": strategy,
                    "replace_existing": replace_existing,
                    "preserve_accepted": preserve_accepted,
                    "family_root_id": family_root_id,
                    "relation_type": child_rel.get(target_doc_id, "translation_of"),
                }
                if strategy == "similarity":
                    run_params["sim_threshold"] = threshold

                deleted_before = 0
                preserved_before = 0
                try:
                    run_id = self._create_run("align", run_params)
                    protected_pairs_by_target = None
                    if replace_existing:
                        protected_pairs_by_target, deleted_before, preserved_before = _prepare_alignment_replace(
                            conn,
                            pivot_doc_id=family_root_id,
                            target_doc_ids=[target_doc_id],
                            preserve_accepted=preserve_accepted,
                        )

                    pair_reports = _run_alignment_strategy(
                        conn,
                        pivot_doc_id=family_root_id,
                        target_doc_ids=[target_doc_id],
                        run_id=run_id,
                        strategy=strategy,
                        debug_align=False,
                        threshold=threshold,
                        protected_pairs_by_target=protected_pairs_by_target,
                    )
                    links_created = sum(r.links_created for r in pair_reports)
                    total_links += links_created
                    results.append({
                        "pivot_doc_id": family_root_id,
                        "target_doc_id": target_doc_id,
                        "target_lang": child_lang.get(target_doc_id, "?"),
                        "relation_type": child_rel.get(target_doc_id, "translation_of"),
                        "run_id": run_id,
                        "status": "aligned",
                        "links_created": links_created,
                        "deleted_before": deleted_before,
                        "preserved_before": preserved_before,
                        "warnings": [],
                    })
                except RunIdConflictError as exc:
                    results.append({
                        "pivot_doc_id": family_root_id,
                        "target_doc_id": target_doc_id,
                        "target_lang": child_lang.get(target_doc_id, "?"),
                        "relation_type": child_rel.get(target_doc_id, "translation_of"),
                        "run_id": exc.run_id,
                        "status": "conflict",
                        "links_created": 0,
                        "deleted_before": 0,
                        "preserved_before": 0,
                        "warnings": [f"run_id conflict: {exc.run_id}"],
                    })
                except Exception as exc:  # noqa: BLE001
                    results.append({
                        "pivot_doc_id": family_root_id,
                        "target_doc_id": target_doc_id,
                        "target_lang": child_lang.get(target_doc_id, "?"),
                        "relation_type": child_rel.get(target_doc_id, "translation_of"),
                        "run_id": None,
                        "status": "error",
                        "links_created": 0,
                        "deleted_before": 0,
                        "preserved_before": 0,
                        "warnings": [str(exc)],
                    })

        # Skipped pairs (parent or child not segmented, skip_unready=true)
        for cid in child_ids:
            if cid not in ready_child_ids or family_root_id in unready:
                total_skipped += 1
                results.append({
                    "pivot_doc_id": family_root_id,
                    "target_doc_id": cid,
                    "target_lang": child_lang.get(cid, "?"),
                    "relation_type": child_rel.get(cid, "translation_of"),
                    "run_id": None,
                    "status": "skipped",
                    "links_created": 0,
                    "deleted_before": 0,
                    "preserved_before": 0,
                    "warnings": ["Not segmented — run /families/{id}/segment first"],
                })

        aligned_count   = sum(1 for r in results if r["status"] == "aligned")
        conflict_count  = sum(1 for r in results if r["status"] == "conflict")
        error_count     = sum(1 for r in results if r["status"] == "error")

        self._send_json(success_payload({
            "family_root_id": family_root_id,
            "strategy": strategy,
            "results": results,
            "summary": {
                "total_pairs": len(results),
                "aligned": aligned_count,
                "skipped": total_skipped,
                "conflicts": conflict_count,
                "errors": error_count,
                "total_links_created": total_links,
            },
        }))

    def _handle_align(self, body: dict) -> None:
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
        raw_replace_existing = body.get("replace_existing", False)
        if not isinstance(raw_replace_existing, bool):
            self._send_error(
                "replace_existing must be a boolean",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        replace_existing = raw_replace_existing
        raw_preserve_accepted = body.get("preserve_accepted", True)
        if not isinstance(raw_preserve_accepted, bool):
            self._send_error(
                "preserve_accepted must be a boolean",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        preserve_accepted = raw_preserve_accepted
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
            "replace_existing": replace_existing,
            "preserve_accepted": preserve_accepted,
        }
        if "relation_type" in body and body.get("relation_type") is not None:
            # Stored for traceability in run params; not yet applied to alignment_links
            # (known contract/behaviour drift — ADR-009, tracked for v1.5+).
            run_params["relation_type"] = body.get("relation_type")
        if strategy == "similarity":
            run_params["sim_threshold"] = threshold

        from multicorpus_engine.runs import RunIdConflictError
        deleted_before = 0
        preserved_before = 0
        try:
            with self._lock():
                run_id = self._create_run("align", run_params, run_id=requested_run_id)
                protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None
                if replace_existing:
                    protected_pairs_by_target, deleted_before, preserved_before = _prepare_alignment_replace(
                        self._conn(),
                        pivot_doc_id=pivot_doc_id,
                        target_doc_ids=target_doc_ids,
                        preserve_accepted=preserve_accepted,
                    )
                reports = _run_alignment_strategy(
                    self._conn(),
                    pivot_doc_id=pivot_doc_id,
                    target_doc_ids=target_doc_ids,
                    run_id=run_id,
                    strategy=strategy,
                    debug_align=debug_align,
                    threshold=threshold,
                    protected_pairs_by_target=protected_pairs_by_target,
                )
                total_links = sum(r.links_created for r in reports)
                total_effective_links = total_links + (preserved_before if replace_existing and preserve_accepted else 0)
                self._update_run_stats(
                    run_id,
                    {
                        "strategy": strategy,
                        "pivot_doc_id": pivot_doc_id,
                        "target_doc_ids": target_doc_ids,
                        "debug_align": debug_align,
                        "replace_existing": replace_existing,
                        "preserve_accepted": preserve_accepted,
                        "deleted_before": deleted_before,
                        "preserved_before": preserved_before,
                        "total_links_created": total_links,
                        "total_effective_links": total_effective_links,
                        "pairs": [r.to_dict() for r in reports],
                    },
                )
        except RunIdConflictError as exc:
            self._send_run_id_conflict(exc.run_id)
            return

        self._send_json(success_payload({
            "run_id": run_id,
            "strategy": strategy,
            "pivot_doc_id": pivot_doc_id,
            "debug_align": debug_align,
            "replace_existing": replace_existing,
            "preserve_accepted": preserve_accepted,
            "deleted_before": deleted_before,
            "preserved_before": preserved_before,
            "total_links_created": total_links,
            "total_effective_links": total_links + (preserved_before if replace_existing and preserve_accepted else 0),
            "reports": [r.to_dict() for r in reports],
        }))

    # ------------------------------------------------------------------
    # V0.4A — Metadata panel
    # ------------------------------------------------------------------

    def _handle_doc_relations_get(self) -> None:
        qs = parse_qs(urlparse(self.path).query)
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

    def _handle_doc_relations_all(self) -> None:
        """GET /doc_relations/all — return every doc_relation row in the corpus.

        Used by the frontend to build the hierarchy view of documents without
        issuing one request per document.
        """
        rows = self._conn().execute(
            "SELECT id, doc_id, relation_type, target_doc_id, note, created_at"
            " FROM doc_relations ORDER BY doc_id, id"
        ).fetchall()
        relations = [
            {"id": r[0], "doc_id": r[1], "relation_type": r[2], "target_doc_id": r[3], "note": r[4], "created_at": r[5]}
            for r in rows
        ]
        self._send_json(success_payload({"relations": relations, "count": len(relations)}))

    def _handle_families(self) -> None:
        """GET /families — list all document families (parent + children + completion stats).

        A family is rooted at a document that appears as ``target_doc_id`` in at least
        one ``doc_relation`` of type ``translation_of`` or ``excerpt_of``.  Stats are
        computed on the fly from ``units`` and ``alignment_links``.
        """
        from collections import defaultdict

        conn = self._conn()
        self._ensure_document_workflow_columns()

        # ── 1. Load all relevant relations ──────────────────────────────────
        rel_rows = conn.execute(
            "SELECT doc_id, relation_type, target_doc_id FROM doc_relations"
            " WHERE relation_type IN ('translation_of', 'excerpt_of')"
            " ORDER BY target_doc_id, doc_id"
        ).fetchall()

        if not rel_rows:
            self._send_json(success_payload({"families": [], "count": 0}))
            return

        # children_of[parent_id] = [{doc_id, relation_type}, ...]
        children_of: dict[int, list[dict]] = defaultdict(list)
        child_ids: set[int] = set()

        for doc_id, rel_type, target_doc_id in rel_rows:
            children_of[target_doc_id].append({"doc_id": doc_id, "relation_type": rel_type})
            child_ids.add(doc_id)

        all_parent_ids = set(children_of.keys())
        all_doc_ids = all_parent_ids | child_ids

        # ── 2. Fetch document metadata ───────────────────────────────────────
        ph = ",".join("?" * len(all_doc_ids))
        doc_rows = conn.execute(
            f"SELECT doc_id, title, language, doc_role, workflow_status,"
            f"       author_lastname, author_firstname, doc_date, source_path"
            f" FROM documents WHERE doc_id IN ({ph})",
            list(all_doc_ids),
        ).fetchall()
        doc_map: dict[int, dict] = {
            r[0]: {
                "doc_id": r[0], "title": r[1], "language": r[2],
                "doc_role": r[3], "workflow_status": r[4],
                "author_lastname": r[5], "author_firstname": r[6],
                "doc_date": r[7], "source_path": r[8],
            }
            for r in doc_rows
        }

        # ── 3. Which docs are segmented? ─────────────────────────────────────
        seg_rows = conn.execute(
            f"SELECT DISTINCT doc_id FROM units"
            f" WHERE unit_type = 'line' AND doc_id IN ({ph})",
            list(all_doc_ids),
        ).fetchall()
        segmented_ids: set[int] = {r[0] for r in seg_rows}

        # Segment counts per doc (for ratio checks)
        seg_count_rows = conn.execute(
            f"SELECT doc_id, COUNT(*) FROM units"
            f" WHERE unit_type = 'line' AND doc_id IN ({ph})"
            f" GROUP BY doc_id",
            list(all_doc_ids),
        ).fetchall()
        seg_counts: dict[int, int] = {r[0]: r[1] for r in seg_count_rows}

        # ── 4. Which pairs are aligned? ──────────────────────────────────────
        align_rows = conn.execute(
            f"SELECT DISTINCT pivot_doc_id, target_doc_id FROM alignment_links"
            f" WHERE pivot_doc_id IN ({ph}) OR target_doc_id IN ({ph})",
            list(all_doc_ids) * 2,
        ).fetchall()
        # Normalise so (a,b) and (b,a) are the same pair
        aligned_pairs: set[tuple[int, int]] = {
            (min(r[0], r[1]), max(r[0], r[1])) for r in align_rows
        }

        # ── 5. Build family objects ──────────────────────────────────────────
        families = []
        for parent_id in sorted(all_parent_ids):
            parent_doc = doc_map.get(parent_id)
            children = children_of[parent_id]

            family_member_ids = {parent_id} | {c["doc_id"] for c in children}
            total_docs = len(family_member_ids)
            segmented_docs = len(segmented_ids & family_member_ids)
            validated_docs = sum(
                1 for mid in family_member_ids
                if doc_map.get(mid, {}).get("workflow_status") == "validated"
            )

            # Pairs: parent ↔ each child
            pairs = [(parent_id, c["doc_id"]) for c in children]
            total_pairs = len(pairs)
            aligned_count = sum(
                1 for a, b in pairs
                if (min(a, b), max(a, b)) in aligned_pairs
            )

            # Segment ratio warnings (> 15 % difference)
            parent_segs = seg_counts.get(parent_id, 0)
            ratio_warnings = []
            if parent_segs > 0:
                for c in children:
                    child_segs = seg_counts.get(c["doc_id"], 0)
                    if child_segs > 0:
                        ratio = abs(child_segs - parent_segs) / parent_segs
                        if ratio > 0.15:
                            ratio_warnings.append({
                                "child_doc_id": c["doc_id"],
                                "parent_segs": parent_segs,
                                "child_segs": child_segs,
                                "ratio_pct": round(ratio * 100),
                            })

            # Completion % : 50 % segmentation, 50 % alignment
            if total_pairs > 0:
                seg_pct = (segmented_docs / total_docs) * 50
                align_pct = (aligned_count / total_pairs) * 50
                completion_pct = round(seg_pct + align_pct)
            else:
                completion_pct = round((segmented_docs / total_docs) * 100) if total_docs else 0

            families.append({
                "family_id": parent_id,
                "parent": parent_doc,
                "children": [
                    {
                        **c,
                        "doc": doc_map.get(c["doc_id"]),
                        "segmented": c["doc_id"] in segmented_ids,
                        "seg_count": seg_counts.get(c["doc_id"], 0),
                        "aligned_to_parent": (
                            min(parent_id, c["doc_id"]), max(parent_id, c["doc_id"])
                        ) in aligned_pairs,
                    }
                    for c in children
                ],
                "stats": {
                    "total_docs": total_docs,
                    "segmented_docs": segmented_docs,
                    "parent_seg_count": seg_counts.get(parent_id, 0),
                    "aligned_pairs": aligned_count,
                    "total_pairs": total_pairs,
                    "validated_docs": validated_docs,
                    "completion_pct": completion_pct,
                    "ratio_warnings": ratio_warnings,
                },
            })

        self._send_json(success_payload({"families": families, "count": len(families)}))

    def _handle_documents_update(self, body: dict) -> None:
        self._ensure_document_workflow_columns()
        doc_id = body.get("doc_id")
        if doc_id is None:
            self._send_error("doc_id is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        allowed = {
            "title", "language", "doc_role", "resource_type",
            "workflow_status", "validated_run_id",
            "author_lastname", "author_firstname", "doc_date",
        }
        updates = {k: v for k, v in body.items() if k in allowed}
        if not updates:
            self._send_error(
                "No updatable fields provided "
                "(allowed: title, language, doc_role, resource_type, workflow_status, validated_run_id, "
                "author_lastname, author_firstname, doc_date)",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        workflow_status = updates.get("workflow_status")
        if workflow_status is not None:
            if not isinstance(workflow_status, str) or workflow_status not in _DOC_WORKFLOW_STATUSES:
                self._send_error(
                    "workflow_status must be one of: draft, review, validated",
                    code=ERR_VALIDATION,
                    http_status=400,
                    details={"supported_values": sorted(_DOC_WORKFLOW_STATUSES)},
                )
                return
            if workflow_status == "validated":
                updates.setdefault("validated_at", utcnow_iso())
                if "validated_run_id" in updates and updates["validated_run_id"] is not None:
                    if not isinstance(updates["validated_run_id"], str) or not updates["validated_run_id"].strip():
                        self._send_error(
                            "validated_run_id must be a non-empty string or null",
                            code=ERR_VALIDATION,
                            http_status=400,
                        )
                        return
                    updates["validated_run_id"] = updates["validated_run_id"].strip()
            else:
                # Leaving validated state clears validation metadata.
                updates["validated_at"] = None
                updates["validated_run_id"] = None
        elif "validated_run_id" in updates:
            self._send_error(
                "validated_run_id can only be set when workflow_status='validated'",
                code=ERR_VALIDATION,
                http_status=400,
            )
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
            """
            SELECT doc_id, title, language, doc_role, resource_type,
                   workflow_status, validated_at, validated_run_id,
                   author_lastname, author_firstname, doc_date
            FROM documents
            WHERE doc_id = ?
            """,
            (doc_id,),
        ).fetchone()
        doc = {
            "doc_id": row[0],
            "title": row[1],
            "language": row[2],
            "doc_role": row[3],
            "resource_type": row[4],
            "workflow_status": row[5],
            "validated_at": row[6],
            "validated_run_id": row[7],
            "author_lastname": row[8],
            "author_firstname": row[9],
            "doc_date": row[10],
        }
        self._send_json(success_payload({"updated": 1, "doc": doc}))

    def _handle_documents_bulk_update(self, body: dict) -> None:
        self._ensure_document_workflow_columns()
        updates_list = body.get("updates")
        if not isinstance(updates_list, list) or not updates_list:
            self._send_error("updates must be a non-empty list of {doc_id, ...fields}", code=ERR_BAD_REQUEST, http_status=400)
            return
        allowed = {
            "title", "language", "doc_role", "resource_type",
            "workflow_status", "validated_run_id",
            "author_lastname", "author_firstname", "doc_date",
        }
        total_updated = 0
        with self._lock():
            for item in updates_list:
                doc_id = item.get("doc_id")
                if doc_id is None:
                    continue
                fields = {k: v for k, v in item.items() if k in allowed}
                if not fields:
                    continue
                workflow_status = fields.get("workflow_status")
                if workflow_status is not None:
                    if not isinstance(workflow_status, str) or workflow_status not in _DOC_WORKFLOW_STATUSES:
                        self._send_error(
                            "workflow_status must be one of: draft, review, validated",
                            code=ERR_VALIDATION,
                            http_status=400,
                            details={"supported_values": sorted(_DOC_WORKFLOW_STATUSES)},
                        )
                        return
                    if workflow_status == "validated":
                        fields.setdefault("validated_at", utcnow_iso())
                        if "validated_run_id" in fields and fields["validated_run_id"] is not None:
                            if not isinstance(fields["validated_run_id"], str) or not fields["validated_run_id"].strip():
                                self._send_error(
                                    "validated_run_id must be a non-empty string or null",
                                    code=ERR_VALIDATION,
                                    http_status=400,
                                )
                                return
                            fields["validated_run_id"] = fields["validated_run_id"].strip()
                    else:
                        fields["validated_at"] = None
                        fields["validated_run_id"] = None
                elif "validated_run_id" in fields:
                    self._send_error(
                        "validated_run_id can only be set when workflow_status='validated'",
                        code=ERR_VALIDATION,
                        http_status=400,
                    )
                    return
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

    def _handle_documents_delete(self, body: dict) -> None:
        """POST /documents/delete — supprime un ou plusieurs documents et toutes leurs données liées."""
        doc_ids = body.get("doc_ids")
        if not isinstance(doc_ids, list) or not doc_ids:
            self._send_error("doc_ids (non-empty list) is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        if not all(isinstance(d, int) for d in doc_ids):
            self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
            return
        placeholders = ",".join("?" * len(doc_ids))
        deleted = 0
        with self._lock():
            conn = self._conn()

            # 1. Collect unit_ids before deletion (needed for FTS cleanup)
            unit_ids: list[int] = [
                row[0] for row in conn.execute(
                    f"SELECT unit_id FROM units WHERE doc_id IN ({placeholders})", doc_ids
                ).fetchall()
            ]

            # 2. alignment_links — uses pivot_doc_id / target_doc_id directly
            conn.execute(
                f"DELETE FROM alignment_links"
                f" WHERE pivot_doc_id IN ({placeholders}) OR target_doc_id IN ({placeholders})",
                doc_ids + doc_ids,
            )

            # 3. FTS index — must happen BEFORE units are deleted (rowid = unit_id)
            if unit_ids:
                fts_ph = ",".join("?" * len(unit_ids))
                try:
                    conn.execute(f"DELETE FROM fts_units WHERE rowid IN ({fts_ph})", unit_ids)
                except Exception:
                    pass  # FTS table may not exist

            # 4. Units — curation_exceptions cascade automatically (ON DELETE CASCADE)
            conn.execute(f"DELETE FROM units WHERE doc_id IN ({placeholders})", doc_ids)

            # 5. Doc relations
            conn.execute(
                f"DELETE FROM doc_relations"
                f" WHERE doc_id IN ({placeholders}) OR target_doc_id IN ({placeholders})",
                doc_ids + doc_ids,
            )

            # 6. Curation apply history (doc_id without FK — orphaned history rows)
            try:
                conn.execute(
                    f"DELETE FROM curation_apply_history WHERE doc_id IN ({placeholders})",
                    doc_ids,
                )
            except Exception:
                pass  # table may not exist in older DBs

            # 8. Documents
            cur = conn.execute(f"DELETE FROM documents WHERE doc_id IN ({placeholders})", doc_ids)
            deleted = cur.rowcount
            conn.commit()
        self._send_json(success_payload({"deleted": deleted, "doc_ids": doc_ids}))

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

    def _handle_export_conllu(self, body: dict) -> None:
        from multicorpus_engine.exporters.conllu_export import export_conllu

        out_path = body.get("out_path")
        if not isinstance(out_path, str) or not out_path.strip():
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if raw_doc_ids is not None:
            if not isinstance(raw_doc_ids, list):
                self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
                return
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError):
                self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
                return

        with self._lock():
            summary = export_conllu(
                self._conn(),
                output_path=out_path.strip(),
                doc_ids=doc_ids,
            )

        self._send_json(success_payload(summary))

    def _handle_export_token_query_csv(self, body: dict) -> None:
        from multicorpus_engine.exporters.csv_export import export_csv
        from multicorpus_engine.token_query import run_token_query_page

        out_path = body.get("out_path")
        if not isinstance(out_path, str) or not out_path.strip():
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return

        raw_cql = body.get("cql")
        if not isinstance(raw_cql, str) or not raw_cql.strip():
            self._send_error("cql is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        cql = raw_cql.strip()

        mode = str(body.get("mode", "kwic")).strip().lower()
        if mode not in {"segment", "kwic"}:
            self._send_error("mode must be 'segment' or 'kwic'", code=ERR_BAD_REQUEST, http_status=400)
            return

        delimiter = body.get("delimiter", ",")
        if delimiter not in {",", "\t"}:
            self._send_error("delimiter must be ',' or '\\t'", code=ERR_BAD_REQUEST, http_status=400)
            return

        raw_window = body.get("window", 10)
        try:
            window = int(raw_window)
        except (TypeError, ValueError):
            self._send_error("window must be an integer >= 0", code=ERR_BAD_REQUEST, http_status=400)
            return
        if window < 0:
            self._send_error("window must be >= 0", code=ERR_BAD_REQUEST, http_status=400)
            return

        language_raw = body.get("language")
        language = str(language_raw).strip() if isinstance(language_raw, str) and language_raw.strip() else None

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if raw_doc_ids is not None:
            if not isinstance(raw_doc_ids, list):
                self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
                return
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError):
                self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
                return

        raw_max_hits = body.get("max_hits", 10000)
        try:
            max_hits = int(raw_max_hits)
        except (TypeError, ValueError):
            self._send_error("max_hits must be an integer in [1, 100000]", code=ERR_BAD_REQUEST, http_status=400)
            return
        if max_hits < 1 or max_hits > 100000:
            self._send_error("max_hits must be in [1, 100000]", code=ERR_BAD_REQUEST, http_status=400)
            return

        with self._lock():
            hits: list[dict] = []
            offset = 0
            while len(hits) < max_hits:
                page_limit = min(200, max_hits - len(hits))
                page = run_token_query_page(
                    conn=self._conn(),
                    cql=cql,
                    mode=mode,
                    window=window,
                    language=language,
                    doc_ids=doc_ids,
                    limit=page_limit,
                    offset=offset,
                )
                page_hits = page.get("hits", [])
                if page_hits:
                    hits.extend(page_hits)
                if not page.get("has_more"):
                    break
                next_offset = page.get("next_offset")
                if not isinstance(next_offset, int):
                    break
                offset = next_offset

            out = export_csv(hits=hits, output_path=out_path.strip(), mode=mode, delimiter=delimiter)

        self._send_json(success_payload({
            "out_path": str(out),
            "rows_written": len(hits),
            "mode": mode,
            "delimiter": delimiter,
            "max_hits": max_hits,
        }))

    def _handle_export_ske(self, body: dict) -> None:
        from multicorpus_engine.exporters.ske_export import export_ske

        out_path = body.get("out_path")
        if not isinstance(out_path, str) or not out_path.strip():
            self._send_error("out_path is required", code=ERR_BAD_REQUEST, http_status=400)
            return

        raw_doc_ids = body.get("doc_ids")
        doc_ids: list[int] | None = None
        if raw_doc_ids is not None:
            if not isinstance(raw_doc_ids, list):
                self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
                return
            try:
                doc_ids = [int(x) for x in raw_doc_ids]
            except (TypeError, ValueError):
                self._send_error("doc_ids must be a list of integers", code=ERR_BAD_REQUEST, http_status=400)
                return

        with self._lock():
            summary = export_ske(
                self._conn(),
                output_path=out_path.strip(),
                doc_ids=doc_ids,
            )

        self._send_json(success_payload(summary))

    def _handle_export_tei(self, body: dict) -> None:
        from multicorpus_engine.exporters.tei import export_tei

        out_dir = body.get("out_dir")
        if not out_dir:
            self._send_error("out_dir is required", code=ERR_BAD_REQUEST, http_status=400)
            return
        doc_ids = body.get("doc_ids")  # list or None (None = all)
        include_structure: bool = bool(body.get("include_structure", False))
        relation_type = body.get("relation_type")
        if relation_type is not None:
            if not isinstance(relation_type, str):
                self._send_error(
                    "relation_type must be a string",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                )
                return
            relation_type = relation_type.strip() or "none"
            allowed_relation_types = {"none", "translation_of", "excerpt_of", "all"}
            if relation_type not in allowed_relation_types:
                self._send_error(
                    "relation_type must be one of: none, translation_of, excerpt_of, all",
                    code=ERR_BAD_REQUEST,
                    http_status=400,
                    details={"supported_values": sorted(allowed_relation_types)},
                )
                return
        tei_profile_direct: str = body.get("tei_profile", "generic")
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
                _out, _warns = export_tei(self._conn(), doc_id=doc_id, output_path=out_path,
                                           include_structure=include_structure, relation_type=relation_type,
                                           tei_profile=tei_profile_direct)
                files_created.append(str(_out))
            except Exception as exc:
                logger.warning("TEI export failed for doc_id=%s: %s", doc_id, exc)
        self._send_json(success_payload({"files_created": files_created, "count": len(files_created)}))

    # ── Sprint 5 helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _escape_xml(text: str) -> str:
        """Escape special characters for XML text content / attribute values."""
        return (
            str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    @staticmethod
    def _build_tmx(
        tu_list: list[list[tuple[str, str]]],
        srclang: str,
        creationtoolversion: str,
    ) -> str:
        """Build a TMX 1.4 document string.

        tu_list: list of TUs; each TU is a list of (lang, text) tuples.
        """
        import datetime as _dt
        esc = SidecarHandler._escape_xml
        stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<tmx version="1.4">',
            f'  <header creationtool="AGRAFES" creationtoolversion="{esc(creationtoolversion)}"',
            '    datatype="plaintext" segtype="sentence" adminlang="und"',
            f'    srclang="{esc(srclang)}" creationdate="{stamp}"/>',
            "  <body>",
        ]
        for i, tuvs in enumerate(tu_list, 1):
            lines.append(f'    <tu tuid="{i}">')
            for lang, text in tuvs:
                lines.append(f'      <tuv xml:lang="{esc(lang)}">')
                lines.append(f"        <seg>{esc(text)}</seg>")
                lines.append("      </tuv>")
            lines.append("    </tu>")
        lines += ["  </body>", "</tmx>"]
        return "\n".join(lines)

    def _fetch_aligned_pairs(
        self,
        pivot_doc_id: int,
        target_doc_id: int,
    ) -> list[tuple[str, str]]:
        """Return list of (pivot_text, target_text) for aligned pairs, ordered by link."""
        rows = self._conn().execute(
            """
            SELECT pu.text_norm, tu.text_norm
            FROM alignment_links al
            JOIN units pu ON pu.unit_id = al.pivot_unit_id
            JOIN units tu ON tu.unit_id = al.target_unit_id
            WHERE al.pivot_doc_id = ? AND al.target_doc_id = ?
            ORDER BY al.external_id, al.link_id
            """,
            (pivot_doc_id, target_doc_id),
        ).fetchall()
        return [(r[0] or "", r[1] or "") for r in rows]

    def _fetch_doc_meta(self, doc_id: int) -> dict:
        row = self._conn().execute(
            "SELECT doc_id, title, language FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        if row is None:
            return {"doc_id": doc_id, "title": f"doc #{doc_id}", "language": "und"}
        return {"doc_id": row[0], "title": row[1] or f"doc #{row[0]}", "language": row[2] or "und"}

    def _handle_export_tmx(self, body: dict) -> None:
        """POST /export/tmx — export aligned pairs to TMX 1.4 format.

        Body fields:
          pivot_doc_id   : int (required unless family_id is set)
          target_doc_id  : int (required for single-pair export)
          family_id      : int — export all parent↔child pairs in one TMX file
          out_path       : str — absolute path for the output file
          out_dir        : str — directory; file named auto (used when out_path not given)
        """
        from multicorpus_engine.sidecar_contract import API_VERSION

        # ── Resolve pivot / targets ──────────────────────────────────────────
        family_id_raw = body.get("family_id")
        pivot_doc_id_raw = body.get("pivot_doc_id")
        target_doc_id_raw = body.get("target_doc_id")
        out_path_str = body.get("out_path")
        out_dir_str  = body.get("out_dir")

        if not out_path_str and not out_dir_str:
            self._send_error("out_path or out_dir is required", code=ERR_BAD_REQUEST, http_status=400)
            return

        # Build list of (pivot, target) pairs
        pairs_to_export: list[tuple[int, int]] = []

        if family_id_raw is not None:
            try:
                fam_id = int(family_id_raw)
            except (TypeError, ValueError):
                self._send_error("family_id must be an integer", code=ERR_BAD_REQUEST, http_status=400)
                return
            child_rows = self._conn().execute(
                "SELECT doc_id FROM doc_relations WHERE target_doc_id = ?"
                " AND relation_type IN ('translation_of', 'excerpt_of') ORDER BY doc_id",
                (fam_id,),
            ).fetchall()
            pairs_to_export = [(fam_id, r[0]) for r in child_rows]
            if not pairs_to_export:
                self._send_error(
                    f"No children found for family_id={fam_id}",
                    code=ERR_BAD_REQUEST, http_status=400,
                )
                return
            pivot_doc_id = fam_id
        else:
            if pivot_doc_id_raw is None or target_doc_id_raw is None:
                self._send_error(
                    "pivot_doc_id and target_doc_id are required (or use family_id)",
                    code=ERR_BAD_REQUEST, http_status=400,
                )
                return
            try:
                pivot_doc_id = int(pivot_doc_id_raw)
                target_doc_id = int(target_doc_id_raw)
            except (TypeError, ValueError):
                self._send_error("pivot_doc_id and target_doc_id must be integers", code=ERR_BAD_REQUEST, http_status=400)
                return
            pairs_to_export = [(pivot_doc_id, target_doc_id)]

        # ── Collect doc metadata ─────────────────────────────────────────────
        pivot_meta = self._fetch_doc_meta(pivot_doc_id)
        srclang = pivot_meta["language"] or "und"

        # ── Build TU list ────────────────────────────────────────────────────
        tu_list: list[list[tuple[str, str]]] = []

        # For multi-pair (family), we build one TU per pivot unit that is aligned
        # to at least one target. If multiple targets exist, we add all TUVs.
        # Simpler approach: one TU per alignment link (pair-wise, concatenated).
        for pivot_id, tgt_id in pairs_to_export:
            tgt_meta = self._fetch_doc_meta(tgt_id)
            tgt_lang = tgt_meta["language"] or "und"
            raw_pairs = self._fetch_aligned_pairs(pivot_id, tgt_id)
            for src_text, tgt_text in raw_pairs:
                tu_list.append([
                    (srclang, src_text),
                    (tgt_lang, tgt_text),
                ])

        # ── Resolve output path ──────────────────────────────────────────────
        if out_path_str:
            out = Path(out_path_str)
        else:
            out_dir = Path(out_dir_str)  # type: ignore[arg-type]
            out_dir.mkdir(parents=True, exist_ok=True)
            if family_id_raw is not None:
                fname = f"family_{pivot_doc_id}.tmx"
            else:
                fname = f"doc_{pivot_doc_id}_doc_{target_doc_id_raw}.tmx"
            out = out_dir / fname

        out.parent.mkdir(parents=True, exist_ok=True)
        tmx_content = self._build_tmx(tu_list, srclang, API_VERSION)
        out.write_text(tmx_content, encoding="utf-8")

        self._send_json(success_payload({
            "out_path": str(out),
            "tu_count": len(tu_list),
            "pairs": [(p, t) for p, t in pairs_to_export],
        }))

    def _handle_export_bilingual(self, body: dict) -> None:
        """POST /export/bilingual — interleaved bilingual export (HTML or TXT).

        Body fields:
          pivot_doc_id   : int (required)
          target_doc_id  : int (required)
          format         : "html" | "txt" (default "html")
          out_path       : str — path to write (omit or null for preview_only mode)
          preview_only   : bool — if true, return first `preview_limit` pairs as JSON
          preview_limit  : int — max pairs to include in preview (default 20)
        """
        import datetime as _dt

        pivot_doc_id_raw  = body.get("pivot_doc_id")
        target_doc_id_raw = body.get("target_doc_id")
        fmt          = str(body.get("format", "html")).lower()
        out_path_str = body.get("out_path")
        preview_only = bool(body.get("preview_only", False))
        preview_limit = int(body.get("preview_limit", 20))

        if pivot_doc_id_raw is None or target_doc_id_raw is None:
            self._send_error("pivot_doc_id and target_doc_id are required", code=ERR_BAD_REQUEST, http_status=400)
            return
        try:
            pivot_doc_id  = int(pivot_doc_id_raw)
            target_doc_id = int(target_doc_id_raw)
        except (TypeError, ValueError):
            self._send_error("pivot_doc_id and target_doc_id must be integers", code=ERR_BAD_REQUEST, http_status=400)
            return
        if fmt not in ("html", "txt"):
            self._send_error("format must be 'html' or 'txt'", code=ERR_BAD_REQUEST, http_status=400)
            return

        pivot_meta  = self._fetch_doc_meta(pivot_doc_id)
        target_meta = self._fetch_doc_meta(target_doc_id)
        pairs = self._fetch_aligned_pairs(pivot_doc_id, target_doc_id)

        if preview_only:
            preview = [
                {"pivot_text": src, "target_text": tgt}
                for src, tgt in pairs[:preview_limit]
            ]
            self._send_json(success_payload({
                "preview": preview,
                "pair_count": len(pairs),
                "pivot_doc_id": pivot_doc_id,
                "target_doc_id": target_doc_id,
                "pivot_lang": pivot_meta["language"],
                "target_lang": target_meta["language"],
            }))
            return

        if not out_path_str:
            self._send_error(
                "out_path is required when preview_only=false",
                code=ERR_BAD_REQUEST, http_status=400,
            )
            return

        out = Path(out_path_str)
        out.parent.mkdir(parents=True, exist_ok=True)
        date_str = _dt.date.today().isoformat()
        esc = self._escape_xml

        if fmt == "html":
            src_lang = esc(pivot_meta["language"])
            tgt_lang = esc(target_meta["language"])
            src_title = esc(pivot_meta["title"])
            tgt_title = esc(target_meta["title"])
            rows_html = "\n".join(
                f"        <tr>\n"
                f"          <td>{esc(src)}</td>\n"
                f"          <td>{esc(tgt)}</td>\n"
                f"        </tr>"
                for src, tgt in pairs
            )
            content = (
                f'<!DOCTYPE html>\n<html lang="{src_lang}">\n<head>\n'
                f'  <meta charset="UTF-8">\n'
                f'  <title>Bilingue {src_lang} / {tgt_lang} — #{pivot_doc_id} / #{target_doc_id}</title>\n'
                f'  <style>\n'
                f'    body {{ font-family: Georgia, serif; max-width: 960px; margin: 2em auto; color: #1a202c; }}\n'
                f'    h1 {{ font-size: 1.3em; color: #2d3748; }}\n'
                f'    p.meta {{ color: #718096; font-size: 0.88em; }}\n'
                f'    table {{ border-collapse: collapse; width: 100%; }}\n'
                f'    th {{ background: #edf2f7; padding: 8px 12px; text-align: left; '
                f'font-size: 0.85em; color: #4a5568; border-bottom: 2px solid #e2e8f0; }}\n'
                f'    td {{ padding: 7px 12px; vertical-align: top; border-bottom: 1px solid #e2e8f0; '
                f'font-size: 0.93em; }}\n'
                f'    tr:hover td {{ background: #f7fafc; }}\n'
                f'  </style>\n'
                f'</head>\n<body>\n'
                f'  <h1>{src_lang} / {tgt_lang}</h1>\n'
                f'  <p class="meta">#{pivot_doc_id} {src_title} ↔ #{target_doc_id} {tgt_title} · '
                f'Exporté le {date_str} · {len(pairs)} paires</p>\n'
                f'  <table>\n'
                f'    <thead><tr><th>{src_lang} — {src_title}</th><th>{tgt_lang} — {tgt_title}</th></tr></thead>\n'
                f'    <tbody>\n{rows_html}\n    </tbody>\n'
                f'  </table>\n</body>\n</html>'
            )
        else:  # txt
            src_lang = pivot_meta["language"]
            tgt_lang = target_meta["language"]
            lines = [
                f"# Bilingue {src_lang} / {tgt_lang}",
                f"# #{pivot_doc_id} {pivot_meta['title']} ↔ #{target_doc_id} {target_meta['title']}",
                f"# Exporté le {date_str} · {len(pairs)} paires",
                "",
            ]
            for src, tgt in pairs:
                lines.append(f"[{src_lang}] {src}")
                lines.append(f"[{tgt_lang}] {tgt}")
                lines.append("")
            content = "\n".join(lines)

        out.write_text(content, encoding="utf-8")
        self._send_json(success_payload({
            "out_path": str(out),
            "pair_count": len(pairs),
            "format": fmt,
        }))

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

    def _handle_corpus_info_get(self) -> None:
        from multicorpus_engine.corpus_info import get_corpus_info

        with self._lock():
            info = get_corpus_info(self._conn())
        self._send_json(success_payload({"corpus": info}))

    def _handle_corpus_audit(self, qs: dict | None = None) -> None:
        """Return an audit of the corpus: missing fields, empty docs, duplicates, family checks."""
        from pathlib import Path as _Path

        # Optional ratio threshold for family ratio warnings (default 15 %)
        try:
            ratio_threshold_pct = int(((qs or {}).get("ratio_threshold_pct") or ["15"])[0])
            ratio_threshold_pct = max(1, min(ratio_threshold_pct, 100))
        except (TypeError, ValueError):
            ratio_threshold_pct = 15

        with self._lock():
            conn = self._conn()
            rows = conn.execute(
                """
                SELECT d.doc_id, d.title, d.language, d.doc_role, d.resource_type,
                       d.source_path, d.source_hash,
                       COUNT(u.unit_id) AS unit_count
                FROM documents d
                LEFT JOIN units u ON u.doc_id = d.doc_id
                GROUP BY d.doc_id
                ORDER BY d.doc_id
                """
            ).fetchall()

            # ── Family audit data ─────────────────────────────────────────
            # All relations
            rel_rows = conn.execute(
                "SELECT doc_id, target_doc_id, relation_type FROM doc_relations"
                " WHERE relation_type IN ('translation_of', 'excerpt_of')"
            ).fetchall()

            # Seg counts per doc (all docs appearing in any relation)
            all_doc_ids_in_rel: set[int] = set()
            for r in rel_rows:
                all_doc_ids_in_rel.add(r[0])
                all_doc_ids_in_rel.add(r[1])

            seg_counts: dict[int, int] = {}
            if all_doc_ids_in_rel:
                placeholders = ",".join("?" * len(all_doc_ids_in_rel))
                seg_rows = conn.execute(
                    f"SELECT doc_id, COUNT(*) FROM units WHERE unit_type='line'"
                    f" AND doc_id IN ({placeholders}) GROUP BY doc_id",
                    list(all_doc_ids_in_rel),
                ).fetchall()
                seg_counts = {r[0]: r[1] for r in seg_rows}

            # Alignment link counts per (pivot, target) pair — both orderings
            align_rows = conn.execute(
                "SELECT pivot_doc_id, target_doc_id, COUNT(*) AS cnt"
                " FROM alignment_links GROUP BY pivot_doc_id, target_doc_id"
            ).fetchall()
            align_counts: dict[tuple[int, int], int] = {}
            for ar in align_rows:
                align_counts[(ar[0], ar[1])] = ar[2]

            # Doc existence set
            existing_doc_ids: set[int] = {r[0] for r in rows}
            doc_meta: dict[int, dict] = {
                r[0]: {"title": r[1] or f"doc #{r[0]}", "language": r[2] or ""}
                for r in rows
            }

        # ── Standard audit checks (unchanged) ─────────────────────────────
        missing_fields: list[dict] = []
        empty_documents: list[dict] = []
        hash_map: dict[str, list[int]] = {}
        filename_map: dict[str, list[int]] = {}
        title_map: dict[str, list[int]] = {}

        for doc_id, title, language, doc_role, resource_type, source_path, source_hash, unit_count in rows:
            label = title or f"(doc #{doc_id})"

            missing: list[str] = []
            if not title or not title.strip():
                missing.append("title")
            if not language or language.strip().lower() in ("", "und"):
                missing.append("language")
            if not doc_role:
                missing.append("doc_role")
            if missing:
                missing_fields.append({"doc_id": doc_id, "title": label, "missing": missing})

            if unit_count == 0:
                empty_documents.append({"doc_id": doc_id, "title": label})

            if source_hash:
                hash_map.setdefault(source_hash, []).append(doc_id)

            if source_path:
                fn = _Path(source_path).name.strip().lower()
                if fn:
                    filename_map.setdefault(fn, []).append(doc_id)

            if title and title.strip():
                t = title.strip().lower()
                title_map.setdefault(t, []).append(doc_id)

        duplicate_hashes = [
            {"hash_prefix": h[:12], "doc_ids": ids}
            for h, ids in hash_map.items()
            if len(ids) > 1
        ]
        duplicate_filenames = [
            {"filename": fn, "doc_ids": ids}
            for fn, ids in filename_map.items()
            if len(ids) > 1
        ]
        duplicate_titles = [
            {"title": t, "doc_ids": ids}
            for t, ids in title_map.items()
            if len(ids) > 1
        ]

        # ── Family checks ─────────────────────────────────────────────────
        orphan_docs: list[dict] = []            # child's parent is absent from corpus
        unsegmented_children: list[dict] = []   # child (or parent) not yet segmented
        unaligned_pairs: list[dict] = []        # segmented pair but 0 alignment links
        ratio_warnings_fam: list[dict] = []     # |child_segs - parent_segs| / parent_segs > threshold

        for child_id, parent_id, rel_type in rel_rows:
            child_info  = doc_meta.get(child_id,  {"title": f"doc #{child_id}",  "language": ""})
            parent_info = doc_meta.get(parent_id, {"title": f"doc #{parent_id}", "language": ""})

            base = {
                "parent_id": parent_id,
                "parent_title": parent_info["title"],
                "child_id": child_id,
                "child_title": child_info["title"],
                "child_lang": child_info["language"],
                "relation_type": rel_type,
            }

            # Orphan: parent not in corpus
            if parent_id not in existing_doc_ids:
                orphan_docs.append({**base, "issue": f"parent doc #{parent_id} not found in corpus"})
                continue  # remaining checks don't apply

            child_segs  = seg_counts.get(child_id, 0)
            parent_segs = seg_counts.get(parent_id, 0)

            # Unsegmented (child or parent has 0 line units)
            if child_segs == 0 or parent_segs == 0:
                unsegmented_children.append({
                    **base,
                    "child_segmented":  child_segs > 0,
                    "parent_segmented": parent_segs > 0,
                })
                continue  # alignment and ratio checks don't apply without segments

            # Unaligned pair (both segmented, 0 alignment links in either direction)
            link_count = (
                align_counts.get((parent_id, child_id), 0)
                + align_counts.get((child_id, parent_id), 0)
            )
            if link_count == 0:
                unaligned_pairs.append({**base, "parent_segs": parent_segs, "child_segs": child_segs})

            # Ratio warning
            ratio = abs(child_segs - parent_segs) / parent_segs
            ratio_pct = round(ratio * 100)
            if ratio_pct > ratio_threshold_pct:
                ratio_warnings_fam.append({
                    **base,
                    "parent_segs": parent_segs,
                    "child_segs": child_segs,
                    "ratio_pct": ratio_pct,
                })

        family_issues = (
            len(orphan_docs)
            + len(unsegmented_children)
            + len(unaligned_pairs)
            + len(ratio_warnings_fam)
        )

        total_issues = (
            len(missing_fields)
            + len(empty_documents)
            + len(duplicate_hashes)
            + len(duplicate_filenames)
            + len(duplicate_titles)
            + family_issues
        )

        self._send_json(success_payload({
            "total_docs": len(rows),
            "total_issues": total_issues,
            "missing_fields": missing_fields,
            "empty_documents": empty_documents,
            "duplicate_hashes": duplicate_hashes,
            "duplicate_filenames": duplicate_filenames,
            "duplicate_titles": duplicate_titles,
            "families": {
                "ratio_threshold_pct": ratio_threshold_pct,
                "total_family_issues": family_issues,
                "orphan_docs": orphan_docs,
                "unsegmented_children": unsegmented_children,
                "unaligned_pairs": unaligned_pairs,
                "ratio_warnings": ratio_warnings_fam,
            },
        }))

    def _handle_corpus_info_post(self, body: dict) -> None:
        from multicorpus_engine.corpus_info import apply_corpus_info_patch

        try:
            with self._lock():
                info = apply_corpus_info_patch(self._conn(), body)
        except ValueError as exc:
            self._send_error(str(exc), code=ERR_VALIDATION, http_status=400)
            return
        self._send_json(success_payload({"corpus": info}))

    def _handle_db_backup(self, body: dict) -> None:
        out_dir = body.get("out_dir")
        if out_dir is not None and not isinstance(out_dir, str):
            self._send_error("out_dir must be a string", code=ERR_BAD_REQUEST, http_status=400)
            return

        raw_db_path = getattr(self.server, "db_path", None)  # type: ignore[attr-defined]
        if not isinstance(raw_db_path, str) or not raw_db_path.strip():
            self._send_error("Source DB path is not configured", code=ERR_NOT_FOUND, http_status=404)
            return

        source_db = Path(raw_db_path).resolve()
        if not source_db.exists() or not source_db.is_file():
            self._send_error("Source DB file not found", code=ERR_NOT_FOUND, http_status=404)
            return

        target_dir = source_db.parent if not out_dir else Path(out_dir)
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            self._send_error(
                f"Unable to create backup directory: {exc}",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")
        suffix = source_db.suffix or ".db"
        backup_base = f"{source_db.stem}_{stamp}{suffix}"
        backup_path = target_dir / f"{backup_base}.bak"
        collision_index = 1
        while backup_path.exists():
            backup_path = target_dir / f"{backup_base}_{collision_index}.bak"
            collision_index += 1

        try:
            with self._lock():
                self._conn().commit()
                dest = sqlite3.connect(str(backup_path))
                try:
                    self._conn().backup(dest)
                finally:
                    dest.close()
        except (sqlite3.OperationalError, OSError) as exc:
            self._send_error(
                f"Unable to create backup file: {exc}",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        self._send_json(success_payload({
            "source_db_path": str(source_db),
            "backup_path": str(backup_path),
            "file_size_bytes": backup_path.stat().st_size,
            "created_at": utcnow_iso(),
        }))

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

    # ------------------------------------------------------------------
    # Sprint 7 — Curation propagée
    # ------------------------------------------------------------------

    def _handle_align_link_acknowledge_source_change(self, body: dict) -> None:
        """POST /align/link/acknowledge_source_change — clear source_changed_at flag.

        Accepts:
          link_ids: list[int]  — one or more link_id values to acknowledge.
          target_doc_id: int   — (optional alternative) acknowledge all pending
                                 links whose target_doc_id matches (per-doc bulk).

        Sets source_changed_at = NULL on matching links (marking them as reviewed).
        """
        raw_link_ids = body.get("link_ids")
        raw_target_doc_id = body.get("target_doc_id")

        if raw_link_ids is not None:
            if not isinstance(raw_link_ids, list) or len(raw_link_ids) == 0:
                self._send_error("link_ids must be a non-empty array", code=ERR_BAD_REQUEST, http_status=400)
                return
            try:
                link_ids = [int(lid) for lid in raw_link_ids]
            except (TypeError, ValueError):
                self._send_error("link_ids must contain integers", code=ERR_BAD_REQUEST, http_status=400)
                return
            ph = ",".join("?" * len(link_ids))
            with self._lock():
                cur = self._conn().execute(
                    f"UPDATE alignment_links SET source_changed_at = NULL WHERE link_id IN ({ph})",
                    link_ids,
                )
                self._conn().commit()
            self._send_json(success_payload({"acknowledged": cur.rowcount, "link_ids": link_ids}))

        elif raw_target_doc_id is not None:
            try:
                target_doc_id = int(raw_target_doc_id)
            except (TypeError, ValueError):
                self._send_error("target_doc_id must be an integer", code=ERR_BAD_REQUEST, http_status=400)
                return
            with self._lock():
                cur = self._conn().execute(
                    "UPDATE alignment_links SET source_changed_at = NULL"
                    " WHERE target_doc_id = ? AND source_changed_at IS NOT NULL",
                    [target_doc_id],
                )
                self._conn().commit()
            self._send_json(success_payload({"acknowledged": cur.rowcount, "target_doc_id": target_doc_id}))

        else:
            self._send_error("Provide link_ids or target_doc_id", code=ERR_BAD_REQUEST, http_status=400)

    def _handle_family_curation_status(self, family_root_id: int) -> None:
        """GET /families/{family_root_id}/curation_status

        Returns, for each child document in the family, the list of alignment
        links whose source_changed_at IS NOT NULL (i.e. the pivot text was
        modified by curation after the link was last reviewed / created).

        Response shape:
        {
          "family_root_id": int,
          "total_pending": int,
          "children": [
            {
              "doc_id": int,
              "title": str | null,
              "language": str | null,
              "pending_count": int,
              "pending": [
                {
                  "link_id": int,
                  "external_id": int,
                  "pivot_unit_id": int,
                  "pivot_text": str,
                  "target_unit_id": int,
                  "target_text": str,
                  "source_changed_at": str,   -- ISO-8601 datetime
                }
              ]
            }
          ]
        }
        """
        conn = self._conn()

        # Get family children
        child_rows = conn.execute(
            "SELECT doc_id, relation_type FROM doc_relations"
            " WHERE target_doc_id = ? AND relation_type IN ('translation_of', 'excerpt_of')"
            " ORDER BY doc_id",
            [family_root_id],
        ).fetchall()

        if not child_rows:
            self._send_json(success_payload({
                "family_root_id": family_root_id,
                "total_pending": 0,
                "children": [],
            }))
            return

        child_ids = [r[0] for r in child_rows]

        # Fetch document metadata for children
        ph = ",".join("?" * len(child_ids))
        doc_rows = conn.execute(
            f"SELECT doc_id, title, language FROM documents WHERE doc_id IN ({ph})",
            child_ids,
        ).fetchall()
        doc_meta: dict[int, dict] = {r[0]: {"title": r[1], "language": r[2]} for r in doc_rows}

        # Fetch all pending links (source_changed_at IS NOT NULL) for these children
        pending_rows = conn.execute(
            f"""
            SELECT
                al.link_id,
                al.external_id,
                al.pivot_unit_id,
                pu.text_norm AS pivot_text,
                al.target_unit_id,
                tu.text_norm AS target_text,
                al.target_doc_id,
                al.source_changed_at
            FROM alignment_links al
            JOIN units pu ON pu.unit_id = al.pivot_unit_id
            JOIN units tu ON tu.unit_id = al.target_unit_id
            WHERE al.target_doc_id IN ({ph})
              AND al.source_changed_at IS NOT NULL
            ORDER BY al.target_doc_id, al.external_id
            """,
            child_ids,
        ).fetchall()

        # Group by child doc
        from collections import defaultdict
        by_child: dict[int, list[dict]] = defaultdict(list)
        for row in pending_rows:
            by_child[row["target_doc_id"]].append({
                "link_id": row["link_id"],
                "external_id": row["external_id"],
                "pivot_unit_id": row["pivot_unit_id"],
                "pivot_text": row["pivot_text"] or "",
                "target_unit_id": row["target_unit_id"],
                "target_text": row["target_text"] or "",
                "source_changed_at": row["source_changed_at"],
            })

        children_out = []
        total_pending = 0
        for child_id in child_ids:
            pending = by_child[child_id]
            total_pending += len(pending)
            meta = doc_meta.get(child_id, {})
            children_out.append({
                "doc_id": child_id,
                "title": meta.get("title"),
                "language": meta.get("language"),
                "pending_count": len(pending),
                "pending": pending,
            })

        self._send_json(success_payload({
            "family_root_id": family_root_id,
            "total_pending": total_pending,
            "children": children_out,
        }))

    # ------------------------------------------------------------------
    # V1.3 — Batch alignment link operations
    # ------------------------------------------------------------------

    def _handle_align_links_batch_update(self, body: dict) -> None:
        """Apply a batch of set_status / delete operations on alignment_links (token required)."""
        actions = body.get("actions")
        if not isinstance(actions, list) or len(actions) == 0:
            self._send_error(
                "'actions' must be a non-empty array",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        valid_action_types = {"set_status", "delete"}
        valid_statuses = {None, "accepted", "rejected"}

        applied = 0
        deleted = 0
        errors: list[dict] = []

        with self._lock():
            conn = self._conn()
            for i, act in enumerate(actions):
                action_type = act.get("action")
                link_id = act.get("link_id")

                if action_type not in valid_action_types:
                    errors.append({"index": i, "link_id": link_id, "error": f"unknown action '{action_type}'"})
                    continue
                if not isinstance(link_id, int):
                    errors.append({"index": i, "link_id": link_id, "error": "link_id must be an integer"})
                    continue

                if action_type == "set_status":
                    status = act.get("status")  # None, 'accepted', 'rejected'
                    if status not in valid_statuses:
                        errors.append({"index": i, "link_id": link_id, "error": f"invalid status '{status}'"})
                        continue
                    cur = conn.execute(
                        "UPDATE alignment_links SET status = ? WHERE link_id = ?",
                        (status, link_id),
                    )
                    if cur.rowcount == 0:
                        errors.append({"index": i, "link_id": link_id, "error": "not found"})
                    else:
                        applied += 1

                elif action_type == "delete":
                    cur = conn.execute(
                        "DELETE FROM alignment_links WHERE link_id = ?",
                        (link_id,),
                    )
                    deleted += cur.rowcount

            conn.commit()

        self._send_json(success_payload({
            "applied": applied,
            "deleted": deleted,
            "errors": errors,
        }))

    # ------------------------------------------------------------------
    # V1.4 — Retarget candidates (read-only, no token)
    # ------------------------------------------------------------------

    def _handle_align_retarget_candidates(self, body: dict) -> None:
        """Suggest candidate target units for retargeting an alignment link.

        Heuristic (in priority order):
        1. external_id match between pivot and target units → score=1.0
        2. Neighbours ±window from anchor (current target or pivot ext_id) → score 1/(1+Δ)
        """
        import json as _json

        pivot_unit_id = body.get("pivot_unit_id")
        target_doc_id = body.get("target_doc_id")
        if not isinstance(pivot_unit_id, int) or not isinstance(target_doc_id, int):
            self._send_error(
                "pivot_unit_id and target_doc_id must be integers",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        try:
            limit = max(1, min(int(body.get("limit", 10)), 50))
            window = max(1, min(int(body.get("window", 5)), 20))
        except (ValueError, TypeError):
            self._send_error("limit and window must be positive integers", code=ERR_BAD_REQUEST, http_status=400)
            return

        conn = self._conn()

        # Get pivot unit info
        pivot_row = conn.execute(
            "SELECT unit_id, external_id, text_norm FROM units WHERE unit_id = ?",
            (pivot_unit_id,),
        ).fetchone()
        if pivot_row is None:
            self._send_error(
                f"pivot_unit_id={pivot_unit_id} not found",
                code=ERR_NOT_FOUND,
                http_status=404,
            )
            return

        pivot_ext_id: int | None = pivot_row[1]

        # Find existing link to use as anchor in target doc
        current_link = conn.execute(
            "SELECT al.target_unit_id, u.external_id "
            "FROM alignment_links al JOIN units u ON u.unit_id = al.target_unit_id "
            "WHERE al.pivot_unit_id = ? AND al.target_doc_id = ? LIMIT 1",
            (pivot_unit_id, target_doc_id),
        ).fetchone()
        anchor_ext_id: int | None = current_link[1] if current_link else pivot_ext_id

        # All target units ordered by external_id (or unit_id fallback)
        target_units = conn.execute(
            "SELECT unit_id, external_id, text_norm FROM units "
            "WHERE doc_id = ? ORDER BY COALESCE(external_id, unit_id)",
            (target_doc_id,),
        ).fetchall()

        candidates: list[dict] = []
        for u in target_units:
            u_uid, u_ext, u_text = u
            score: float | None = None
            reason: str = ""

            if u_ext is not None and pivot_ext_id is not None and u_ext == pivot_ext_id:
                score = 1.0
                reason = "external_id_match"
            elif anchor_ext_id is not None and u_ext is not None:
                dist = abs(u_ext - anchor_ext_id)
                if dist <= window:
                    score = round(1.0 / (1 + dist), 4)
                    reason = f"neighbor (\u0394{dist})"

            if score is not None:
                candidates.append({
                    "target_unit_id": u_uid,
                    "external_id": u_ext,
                    "target_text": u_text or "",
                    "score": score,
                    "reason": reason,
                })

        candidates.sort(key=lambda c: (-c["score"], c["target_unit_id"]))
        candidates = candidates[:limit]

        self._send_json(success_payload({
            "pivot": {
                "unit_id": pivot_unit_id,
                "external_id": pivot_ext_id,
                "text": pivot_row[2] or "",
            },
            "candidates": candidates,
        }))

    # ------------------------------------------------------------------
    # V1.5 — Collision resolver (read + write)
    # ------------------------------------------------------------------

    def _handle_align_collisions(self, body: dict) -> None:
        """List pivot units with multiple links to the same target doc (collisions).

        Endpoint: POST /align/collisions  (read-only, no token)
        Request:  { pivot_doc_id, target_doc_id, limit?, offset? }
        Response: { total_collisions, collisions: [CollisionGroup], has_more, next_offset }
        """
        pivot_doc_id = body.get("pivot_doc_id")
        target_doc_id = body.get("target_doc_id")
        if not isinstance(pivot_doc_id, int) or not isinstance(target_doc_id, int):
            self._send_error(
                "pivot_doc_id and target_doc_id must be integers",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return
        try:
            limit = max(1, min(int(body.get("limit", 20)), 100))
            offset = max(0, int(body.get("offset", 0)))
        except (ValueError, TypeError):
            self._send_error("limit and offset must be non-negative integers", code=ERR_BAD_REQUEST, http_status=400)
            return

        conn = self._conn()

        # Count total collision pivot_unit_ids (for pagination meta)
        total_row = conn.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT pivot_unit_id
                FROM alignment_links
                WHERE pivot_doc_id = ? AND target_doc_id = ?
                GROUP BY pivot_unit_id
                HAVING COUNT(*) > 1
            )
            """,
            (pivot_doc_id, target_doc_id),
        ).fetchone()
        total_collisions: int = total_row[0] if total_row else 0

        # Fetch collision pivot_unit_ids for this page
        collision_pivot_rows = conn.execute(
            """
            SELECT pivot_unit_id
            FROM alignment_links
            WHERE pivot_doc_id = ? AND target_doc_id = ?
            GROUP BY pivot_unit_id
            HAVING COUNT(*) > 1
            ORDER BY pivot_unit_id
            LIMIT ? OFFSET ?
            """,
            (pivot_doc_id, target_doc_id, limit + 1, offset),
        ).fetchall()

        has_more = len(collision_pivot_rows) > limit
        collision_pivot_rows = collision_pivot_rows[:limit]
        next_offset = offset + len(collision_pivot_rows) if has_more else offset + len(collision_pivot_rows)

        collisions: list[dict] = []
        for (pivot_unit_id,) in collision_pivot_rows:
            # Fetch pivot unit info
            pivot_row = conn.execute(
                "SELECT external_id, text_norm FROM units WHERE unit_id = ?",
                (pivot_unit_id,),
            ).fetchone()
            pivot_ext = pivot_row[0] if pivot_row else None
            pivot_text = (pivot_row[1] or "") if pivot_row else ""

            # Fetch all links for this pivot in the target doc
            link_rows = conn.execute(
                """
                SELECT al.link_id, al.target_unit_id, u.external_id, u.text_norm, al.status
                FROM alignment_links al
                JOIN units u ON u.unit_id = al.target_unit_id
                WHERE al.pivot_unit_id = ? AND al.target_doc_id = ?
                ORDER BY al.link_id
                """,
                (pivot_unit_id, target_doc_id),
            ).fetchall()

            links = [
                {
                    "link_id": lr[0],
                    "target_unit_id": lr[1],
                    "target_external_id": lr[2],
                    "target_text": lr[3] or "",
                    "status": lr[4],
                }
                for lr in link_rows
            ]
            collisions.append({
                "pivot_unit_id": pivot_unit_id,
                "pivot_external_id": pivot_ext,
                "pivot_text": pivot_text,
                "links": links,
            })

        self._send_json(success_payload({
            "total_collisions": total_collisions,
            "collisions": collisions,
            "has_more": has_more,
            "next_offset": next_offset,
        }))

    def _handle_align_collisions_resolve(self, body: dict) -> None:
        """Batch-resolve collision links: keep, delete, reject, or mark unreviewed.

        Endpoint: POST /align/collisions/resolve  (write, token required)
        Request:  { actions: [{ action: "keep"|"delete"|"reject"|"unreviewed", link_id }] }
          keep       → status = "accepted"
          reject     → status = "rejected"
          unreviewed → status = NULL
          delete     → DELETE row
        Response: { applied, deleted, errors }
        """
        actions = body.get("actions")
        if not isinstance(actions, list) or len(actions) == 0:
            self._send_error(
                "'actions' must be a non-empty array",
                code=ERR_BAD_REQUEST,
                http_status=400,
            )
            return

        valid_action_types = {"keep", "delete", "reject", "unreviewed"}
        # Map resolve actions to status values
        _action_to_status = {"keep": "accepted", "reject": "rejected", "unreviewed": None}

        applied = 0
        deleted = 0
        errors: list[dict] = []

        with self._lock():
            conn = self._conn()
            for i, act in enumerate(actions):
                action_type = act.get("action")
                link_id = act.get("link_id")

                if action_type not in valid_action_types:
                    errors.append({"index": i, "link_id": link_id, "error": f"unknown action '{action_type}'"})
                    continue
                if not isinstance(link_id, int):
                    errors.append({"index": i, "link_id": link_id, "error": "link_id must be an integer"})
                    continue

                if action_type == "delete":
                    cur = conn.execute(
                        "DELETE FROM alignment_links WHERE link_id = ?",
                        (link_id,),
                    )
                    deleted += cur.rowcount
                else:
                    status = _action_to_status[action_type]
                    cur = conn.execute(
                        "UPDATE alignment_links SET status = ? WHERE link_id = ?",
                        (status, link_id),
                    )
                    if cur.rowcount == 0:
                        errors.append({"index": i, "link_id": link_id, "error": "not found"})
                    else:
                        applied += 1

            conn.commit()

        self._send_json(success_payload({
            "applied": applied,
            "deleted": deleted,
            "errors": errors,
        }))

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
        self._conn.execute("PRAGMA busy_timeout=30000")
        self._conn.execute("PRAGMA foreign_keys=ON")
        apply_migrations(self._conn)

        bind_port = _find_free_port(self._host) if self._port == 0 else self._port
        self._httpd = HTTPServer((self._host, bind_port), _CorpusHandler)
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
            from multicorpus_engine.indexer import build_index, update_index

            incremental = bool(params.get("incremental", False))
            progress_cb(10, "Incremental FTS sync" if incremental else "Rebuilding FTS index")
            with lock:
                if incremental:
                    stats = update_index(conn, prune_deleted=True)
                    result = {"incremental": True, **stats}
                else:
                    units_indexed = build_index(conn)
                    result = {"units_indexed": units_indexed, "incremental": False}
            progress_cb(100, "Index rebuilt")
            return result

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

            # Selective apply: skip_unit_ids are units the user explicitly ignored
            # in the local review session.  Strategy B: apply all except ignored.
            # Units outside the preview sample (not reviewed) are always applied.
            raw_skip = params.get("ignored_unit_ids", [])
            skip_unit_ids: set[int] | None = None
            if isinstance(raw_skip, list) and raw_skip:
                skip_unit_ids = {int(uid) for uid in raw_skip
                                 if isinstance(uid, (int, float))}

            # Manual overrides: {unit_id → user-supplied replacement text}
            raw_overrides = params.get("manual_overrides", [])
            manual_overrides: dict[int, str] | None = None
            if isinstance(raw_overrides, list) and raw_overrides:
                _parsed = {
                    int(item["unit_id"]): str(item["text"])
                    for item in raw_overrides
                    if isinstance(item, dict)
                       and "unit_id" in item and "text" in item
                }
                if _parsed:
                    manual_overrides = _parsed

            progress_cb(10, "Applying curation rules")
            with lock:
                if doc_id is not None:
                    reports = [curate_document(conn, int(doc_id), rules,
                                               skip_unit_ids=skip_unit_ids,
                                               manual_overrides=manual_overrides)]
                else:
                    reports = curate_all_documents(conn, rules,
                                                   skip_unit_ids=skip_unit_ids,
                                                   manual_overrides=manual_overrides)
            units_modified = sum(r.units_modified for r in reports)
            units_skipped  = sum(r.units_skipped  for r in reports)
            progress_cb(100, "Curation completed")
            return {
                "docs_curated": len(reports),
                "units_modified": units_modified,
                "units_skipped": units_skipped,
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

        if kind == "annotate":
            from multicorpus_engine.annotator import annotate_document

            all_docs = bool(params.get("all_docs", False))
            model_name = params.get("model")
            if model_name is not None and not isinstance(model_name, str):
                raise ValueError("annotate job expects params.model to be a string")

            progress_cb(5, "Preparing annotation")
            if all_docs:
                # Resolve doc ids from the shared sidecar connection quickly under lock,
                # then release lock for the potentially long NLP workload.
                with lock:
                    doc_ids = [
                        int(r[0]) for r in conn.execute(
                            "SELECT doc_id FROM documents ORDER BY doc_id"
                        ).fetchall()
                    ]
                if not doc_ids:
                    return {
                        "docs_annotated": 0,
                        "tokens_written": 0,
                        "units_annotated": 0,
                        "results": [],
                        "model": model_name if isinstance(model_name, str) else None,
                    }
            else:
                if "doc_id" not in params:
                    raise ValueError("annotate job expects params.doc_id or params.all_docs=true")
                doc_ids = [int(params["doc_id"])]

            # NLP is CPU-bound and slow — run it without holding the sidecar lock.
            # We pass the main conn + lock so annotate_document can:
            #   1. read unit rows under lock (fast)
            #   2. run spaCy inference with NO lock held
            #   3. write token rows under lock (fast batch INSERT)
            results: list[dict[str, object]] = []
            total_tokens = 0
            total_units = 0
            for idx, did in enumerate(doc_ids, start=1):
                pct = 5 + int(90 * (idx - 1) / max(len(doc_ids), 1))
                progress_cb(pct, f"Annotating doc #{did} ({idx}/{len(doc_ids)})")
                report = annotate_document(conn, doc_id=did, model_name=model_name, lock=lock)
                results.append(report)
                total_tokens += int(report.get("tokens_written", 0) or 0)
                total_units += int(report.get("units_annotated", 0) or 0)

            progress_cb(100, "Annotation completed")
            return {
                "docs_annotated": len(results),
                "units_annotated": total_units,
                "tokens_written": total_tokens,
                "results": results,
                "model": model_name if isinstance(model_name, str) else None,
            }

        if kind == "segment":
            from multicorpus_engine.segmenter import resegment_document, resegment_document_markers

            if "doc_id" not in params:
                raise ValueError("segment job expects params.doc_id")
            doc_id = int(params["doc_id"])
            seg_mode = str(params.get("mode") or "sentences").strip().lower()

            progress_cb(10, "Resegmenting document")
            with lock:
                if seg_mode == "markers":
                    report = resegment_document_markers(conn, doc_id=doc_id)
                else:
                    lang = str(params.get("lang", "und"))
                    pack = params.get("pack", "auto")
                    if pack is not None and not isinstance(pack, str):
                        raise ValueError("segment job expects params.pack to be a string")
                    calibrate_to_raw = params.get("calibrate_to")
                    calibrate_to: int | None = None
                    if calibrate_to_raw is not None:
                        try:
                            calibrate_to = int(calibrate_to_raw)
                        except (TypeError, ValueError):
                            pass
                    report = resegment_document(conn, doc_id=doc_id, lang=lang, pack=pack)
                    if calibrate_to is not None and report.units_output > 0:
                        ref_count = conn.execute(
                            "SELECT COUNT(*) FROM units WHERE doc_id = ? AND unit_type = 'line'",
                            (calibrate_to,),
                        ).fetchone()[0]
                        if ref_count > 0:
                            ratio = abs(report.units_output - ref_count) / ref_count
                            if ratio > 0.15:
                                report.warnings.append(
                                    f"Ratio warning: {report.units_output} segments vs "
                                    f"{ref_count} in reference doc #{calibrate_to} "
                                    f"({ratio:.0%} diff)"
                                )
            progress_cb(100, "Segmentation completed")
            return {"fts_stale": True, **report.to_dict()}

        if kind == "import":
            from pathlib import Path as _Path

            mode = params.get("mode")
            # Normalise legacy/malformed mode values (e.g. "odt paragraphs" → "odt_paragraphs")
            if isinstance(mode, str):
                mode = mode.strip().lower().replace(" ", "_").replace("-", "_")
            path_str = params.get("path")
            language = params.get("language") or "und"
            title = params.get("title")
            doc_role = params.get("doc_role", "standalone")
            resource_type = params.get("resource_type")
            tei_unit = params.get("tei_unit", "p")
            check_filename = bool(params.get("check_filename", False))

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
                        check_filename=check_filename,
                    )
                elif mode == "txt_numbered_lines":
                    from multicorpus_engine.importers.txt import import_txt_numbered_lines
                    report = import_txt_numbered_lines(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                        check_filename=check_filename,
                    )
                elif mode == "docx_paragraphs":
                    from multicorpus_engine.importers.docx_paragraphs import import_docx_paragraphs
                    report = import_docx_paragraphs(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                        check_filename=check_filename,
                    )
                elif mode == "odt_paragraphs":
                    from multicorpus_engine.importers.odt_paragraphs import import_odt_paragraphs
                    report = import_odt_paragraphs(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                        check_filename=check_filename,
                    )
                elif mode == "odt_numbered_lines":
                    from multicorpus_engine.importers.odt_numbered_lines import import_odt_numbered_lines
                    report = import_odt_numbered_lines(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                        check_filename=check_filename,
                    )
                elif mode == "tei":
                    from multicorpus_engine.importers.tei_importer import import_tei
                    report = import_tei(
                        conn, path=file_path, language=language if language != "und" else None,
                        title=title, unit_element=tei_unit,
                        doc_role=doc_role, resource_type=resource_type,
                        check_filename=check_filename,
                    )
                elif mode == "conllu":
                    from multicorpus_engine.importers.conllu import import_conllu
                    report = import_conllu(
                        conn, path=file_path, language=language,
                        title=title, doc_role=doc_role, resource_type=resource_type,
                        check_filename=check_filename,
                    )
                else:
                    raise ValueError(f"import job: unsupported mode: {mode!r}")

            progress_cb(100, "Import completed")
            result = report.to_dict()

            # If caller wants to attach this doc to a family, create the relation now.
            family_root_doc_id = params.get("family_root_doc_id")
            if family_root_doc_id is not None:
                try:
                    family_root_doc_id = int(family_root_doc_id)
                except (TypeError, ValueError):
                    family_root_doc_id = None
            if family_root_doc_id is not None:
                new_doc_id = result.get("doc_id")
                if isinstance(new_doc_id, int):
                    with lock:
                        parent_exists = conn.execute(
                            "SELECT 1 FROM documents WHERE doc_id = ?",
                            (family_root_doc_id,),
                        ).fetchone()
                        if parent_exists:
                            existing = conn.execute(
                                """SELECT id FROM doc_relations
                                   WHERE doc_id = ? AND target_doc_id = ?
                                     AND relation_type = 'translation_of'""",
                                (new_doc_id, family_root_doc_id),
                            ).fetchone()
                            if existing:
                                result["relation_created"] = False
                                result["relation_id"] = existing[0]
                            else:
                                cur = conn.execute(
                                    """INSERT INTO doc_relations (doc_id, relation_type, target_doc_id)
                                       VALUES (?, 'translation_of', ?)""",
                                    (new_doc_id, family_root_doc_id),
                                )
                                conn.commit()
                                result["relation_created"] = True
                                result["relation_id"] = cur.lastrowid

            return result

        if kind == "align":
            from multicorpus_engine.runs import RunIdConflictError, create_run, update_run_stats

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
            replace_existing = bool(params.get("replace_existing", False))
            preserve_accepted = bool(params.get("preserve_accepted", True))
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
                    "replace_existing": replace_existing,
                    "preserve_accepted": preserve_accepted,
                }
                if strategy == "similarity":
                    run_params["sim_threshold"] = float(params.get("sim_threshold", 0.8))
                try:
                    created_run_id = create_run(conn, "align", run_params, run_id=run_id_param)
                except RunIdConflictError as exc:
                    raise ValueError(
                        f"run_id already exists: {exc.run_id!r}. "
                        "Supply a unique run_id or omit it to auto-generate one."
                    ) from exc
                threshold = float(params.get("sim_threshold", 0.8))
                if strategy == "similarity" and (threshold < 0.0 or threshold > 1.0):
                    raise ValueError("sim_threshold must be in [0.0, 1.0]")
                protected_pairs_by_target: dict[int, set[tuple[int, int]]] | None = None
                deleted_before = 0
                preserved_before = 0
                if replace_existing:
                    protected_pairs_by_target, deleted_before, preserved_before = _prepare_alignment_replace(
                        conn,
                        pivot_doc_id=int(pivot_doc_id),
                        target_doc_ids=[int(t) for t in target_doc_ids],
                        preserve_accepted=preserve_accepted,
                    )
                reports = _run_alignment_strategy(
                    conn,
                    pivot_doc_id=int(pivot_doc_id),
                    target_doc_ids=[int(t) for t in target_doc_ids],
                    run_id=created_run_id,
                    strategy=strategy,
                    debug_align=debug_align,
                    threshold=threshold,
                    protected_pairs_by_target=protected_pairs_by_target,
                )
                total_links = sum(r.links_created for r in reports)
                total_effective_links = total_links + (preserved_before if replace_existing and preserve_accepted else 0)
                update_run_stats(
                    conn,
                    created_run_id,
                    {
                        "strategy": strategy,
                        "pivot_doc_id": int(pivot_doc_id),
                        "target_doc_ids": [int(t) for t in target_doc_ids],
                        "debug_align": debug_align,
                        "replace_existing": replace_existing,
                        "preserve_accepted": preserve_accepted,
                        "deleted_before": deleted_before,
                        "preserved_before": preserved_before,
                        "total_links_created": total_links,
                        "total_effective_links": total_effective_links,
                        "pairs": [r.to_dict() for r in reports],
                    },
                )
            progress_cb(100, "Alignment completed")
            return {
                "run_id": created_run_id,
                "strategy": strategy,
                "pivot_doc_id": pivot_doc_id,
                "debug_align": debug_align,
                "replace_existing": replace_existing,
                "preserve_accepted": preserve_accepted,
                "deleted_before": deleted_before if replace_existing else 0,
                "preserved_before": preserved_before if replace_existing else 0,
                "total_links_created": total_links,
                "total_effective_links": total_effective_links if replace_existing else total_links,
                "reports": [r.to_dict() for r in reports],
            }

        if kind == "export_tei":
            from pathlib import Path as _Path
            from multicorpus_engine.exporters.tei import export_tei

            out_dir = params.get("out_dir")
            if not out_dir:
                raise ValueError("export_tei job requires params.out_dir")
            doc_ids = params.get("doc_ids")
            include_structure_job: bool = bool(params.get("include_structure", False))
            relation_type_job = params.get("relation_type")

            out_path = _Path(out_dir)
            out_path.mkdir(parents=True, exist_ok=True)

            with lock:
                if doc_ids is None:
                    rows = conn.execute("SELECT doc_id FROM documents ORDER BY doc_id").fetchall()
                    doc_ids = [r[0] for r in rows]

            tei_profile_job: str = params.get("tei_profile", "generic")
            files_created: list[str] = []
            progress_cb(5, "Exporting TEI")
            for i, doc_id in enumerate(doc_ids):
                dest = out_path / f"doc_{doc_id}.xml"
                with lock:
                    _out2, _w2 = export_tei(
                        conn,
                        doc_id=int(doc_id),
                        output_path=dest,
                        include_structure=include_structure_job,
                        relation_type=relation_type_job,
                        tei_profile=tei_profile_job,
                    )
                files_created.append(str(_out2))
                pct = 5 + int(90 * (i + 1) / max(len(doc_ids), 1))
                progress_cb(pct, f"Exported {i + 1}/{len(doc_ids)}")
            progress_cb(100, "TEI export completed")
            return {"files_created": files_created, "count": len(files_created)}

        if kind == "export_readable_text":
            from multicorpus_engine.exporters.readable_text import export_readable_text

            out_dir = params.get("out_dir")
            if not out_dir:
                raise ValueError("export_readable_text job requires params.out_dir")
            export_fmt = str(params.get("format", "txt")).strip().lower()
            if export_fmt not in {"txt", "docx"}:
                raise ValueError("export_readable_text params.format must be 'txt' or 'docx'")

            doc_ids = params.get("doc_ids")
            include_structure = bool(params.get("include_structure", False))
            include_external_id = bool(params.get("include_external_id", True))
            source_field = str(params.get("source_field", "text_norm"))
            if source_field not in {"text_norm", "text_raw"}:
                raise ValueError("export_readable_text params.source_field must be 'text_norm' or 'text_raw'")

            progress_cb(10, f"Exporting readable text ({export_fmt})")
            with lock:
                result = export_readable_text(
                    conn,
                    out_dir=str(out_dir),
                    doc_ids=doc_ids if isinstance(doc_ids, list) else None,
                    fmt=export_fmt,
                    include_structure=include_structure,
                    include_external_id=include_external_id,
                    source_field=source_field,
                )
            progress_cb(100, "Readable text export completed")
            return result

        if kind == "qa_report":
            from pathlib import Path as _Path
            from multicorpus_engine.qa_report import write_qa_report

            out_path_str = params.get("out_path")
            if not out_path_str:
                raise ValueError("qa_report job requires params.out_path")

            qa_fmt = params.get("format", "json")
            qa_doc_ids = params.get("doc_ids")
            qa_policy = params.get("policy", "lenient")

            progress_cb(10, "Generating QA report")
            with lock:
                qa_result = write_qa_report(
                    conn=conn,
                    output_path=_Path(out_path_str),
                    fmt=qa_fmt,
                    doc_ids=qa_doc_ids,
                    policy=qa_policy,
                )
            progress_cb(100, "QA report generated")
            return {
                "gate_status": qa_result["gates"]["status"],
                "policy_used": qa_result.get("policy_used", qa_policy),
                "blocking": qa_result["gates"]["blocking"],
                "warnings": qa_result["gates"]["warnings"],
                "summary": qa_result["summary"],
                "out_path": out_path_str,
                "format": qa_fmt,
            }

        if kind == "export_tei_package":
            from pathlib import Path as _Path
            from multicorpus_engine.exporters.tei_package import export_tei_package

            out_path_str = params.get("out_path")
            if not out_path_str:
                raise ValueError("export_tei_package job requires params.out_path")

            doc_ids_pkg = params.get("doc_ids")
            include_structure_pkg: bool = bool(params.get("include_structure", False))
            include_alignment_pkg: bool = bool(params.get("include_alignment", False))
            status_filter_pkg = params.get("status_filter") or ["accepted"]
            tei_profile_pkg: str = params.get("tei_profile", "generic")

            progress_cb(5, "Building TEI publication package")
            with lock:
                result_pkg = export_tei_package(
                    conn=conn,
                    output_path=_Path(out_path_str),
                    doc_ids=doc_ids_pkg,
                    include_structure=include_structure_pkg,
                    include_alignment=include_alignment_pkg,
                    status_filter=status_filter_pkg,
                    tei_profile=tei_profile_pkg,
                )
            progress_cb(100, "TEI package created")
            return result_pkg

        if kind == "export_align_csv":
            import csv as _csv
            from pathlib import Path as _Path

            out_path_str = params.get("out_path")
            if not out_path_str:
                raise ValueError("export_align_csv job requires params.out_path")

            pivot_doc_id = params.get("pivot_doc_id")
            target_doc_id = params.get("target_doc_id")
            delimiter = params.get("delimiter", ",")
            exceptions_only = bool(params.get("exceptions_only", False))

            progress_cb(10, "Querying alignment links")
            where_parts: list[str] = []
            sql_params: list = []
            if pivot_doc_id is not None:
                where_parts.append("al.pivot_doc_id = ?")
                sql_params.append(int(pivot_doc_id))
            if target_doc_id is not None:
                where_parts.append("al.target_doc_id = ?")
                sql_params.append(int(target_doc_id))
            if exceptions_only:
                where_parts.append("al.status = 'rejected'")
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
