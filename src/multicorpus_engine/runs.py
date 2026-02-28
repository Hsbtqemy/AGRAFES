"""Run management — create, log, and finalize runs.

Every CLI operation is a run (init/import/index/query/align/export/curate/
validate-meta/segment/serve). Each run gets a UUID, is persisted in the runs
table, and writes a log file.
See docs/DECISIONS.md ADR-004.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def new_run_id() -> str:
    return str(uuid.uuid4())


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def create_run(
    conn: sqlite3.Connection,
    kind: str,
    params: dict,
) -> str:
    """Insert a new run record and return the run_id."""
    run_id = new_run_id()
    created_at = utcnow_iso()
    conn.execute(
        """
        INSERT INTO runs (run_id, kind, params_json, stats_json, created_at)
        VALUES (?, ?, ?, NULL, ?)
        """,
        (run_id, kind, json.dumps(params, ensure_ascii=False), created_at),
    )
    conn.commit()
    return run_id


def update_run_stats(
    conn: sqlite3.Connection,
    run_id: str,
    stats: dict,
) -> None:
    """Update the stats_json field of an existing run."""
    conn.execute(
        "UPDATE runs SET stats_json = ? WHERE run_id = ?",
        (json.dumps(stats, ensure_ascii=False), run_id),
    )
    conn.commit()


def setup_run_logger(db_path: str | Path, run_id: str) -> tuple[logging.Logger, Path]:
    """Create a file logger for this run and return (logger, log_path)."""
    db_path = Path(db_path)
    log_dir = db_path.parent / "runs" / run_id
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "run.log"

    logger = logging.getLogger(f"multicorpus.run.{run_id}")
    logger.setLevel(logging.DEBUG)

    if not logger.handlers:
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger, log_path
