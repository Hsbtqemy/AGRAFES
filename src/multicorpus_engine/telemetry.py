"""Local-only NDJSON telemetry for AGRAFES.

Append-only events to `<db_dir>/.agrafes_telemetry.ndjson`. NO network. NO
servers. Used by the Shell diagnostics view to aggregate locally and by
post-hoc offline analysis. Privacy guarantee: nothing leaves the machine.

Design principles :

- Fire-and-forget : every emission swallows all exceptions. A telemetry
  write failure must never propagate to the caller (which is a real
  business logic that's already done its job).
- One JSON object per line, compact (no internal newlines), UTF-8.
- ISO 8601 UTC timestamp with millisecond precision in `ts` field.
- File lock (`fcntl.flock` on POSIX, `msvcrt.locking` on Windows) when
  appending — handles the rare case of two sidecars on different DBs in
  the same parent directory writing to the same file.

Event schema (5 events + 1 meta) is documented in HANDOFF_PREP and the
mission prompt. Adding new events should be discussed before being
implemented — instrumentation creep is a real risk.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_TELEMETRY_FILENAME = ".agrafes_telemetry.ndjson"


def telemetry_path(db_path: str | Path) -> Path:
    """Return the NDJSON path next to the given DB file."""
    return Path(db_path).resolve().parent / _TELEMETRY_FILENAME


def _utc_now_iso() -> str:
    """ISO 8601 UTC with millisecond precision, e.g. 2026-04-29T12:34:56.789Z"""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _append_locked(path: Path, line: str) -> None:
    """Append `line + \\n` to `path`, with a best-effort file lock.

    On POSIX, uses `fcntl.flock(LOCK_EX)`. On Windows, uses `msvcrt.locking`.
    If locking is unavailable or fails, falls back to plain append (the
    risk is interleaved lines on the rare race; acceptable for telemetry).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        try:
            if os.name == "posix":
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            elif os.name == "nt":
                import msvcrt
                # Lock 1 byte at the end-of-file region
                msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        except Exception:  # noqa: BLE001
            # Lock unavailable; proceed without — interleaving risk is
            # negligible and we never want telemetry to crash the caller.
            pass
        try:
            f.write(line + "\n")
        finally:
            try:
                if os.name == "posix":
                    import fcntl
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                elif os.name == "nt":
                    import msvcrt
                    msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            except Exception:  # noqa: BLE001
                pass


def emit_event(db_path: str | Path, event_name: str, **payload: Any) -> None:
    """Append a telemetry event to the NDJSON. Swallow ALL exceptions.

    Caller MUST never need to handle telemetry failures.

    Schema:
        { "ts": "<ISO8601>", "event": "<name>", ...payload }

    `event_name` is required; `payload` is merged into the JSON object.
    Any non-JSON-serializable values in payload are coerced via str().
    """
    if not event_name or not isinstance(event_name, str):
        return
    try:
        target = telemetry_path(db_path)
        record: dict[str, Any] = {
            "ts": _utc_now_iso(),
            "event": event_name,
            **payload,
        }
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"), default=str)
        _append_locked(target, line)
    except Exception as exc:  # noqa: BLE001
        # Last-resort: log at debug, never propagate. If logging itself fails,
        # we silently drop the event. That's the contract.
        try:
            logger.debug("telemetry emit failed (%s): %s", event_name, exc)
        except Exception:  # noqa: BLE001
            pass
