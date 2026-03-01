"""Async job manager for sidecar operations."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


JobRunner = Callable[[str, str, dict[str, Any], Callable[[int, str | None], None]], dict[str, Any]]


@dataclass
class JobRecord:
    """In-memory representation of one async job."""

    job_id: str
    kind: str
    params: dict[str, Any]
    status: str = "queued"  # queued | running | done | error
    progress_pct: int = 0
    progress_message: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    error_code: str | None = None
    created_at: str = field(default_factory=_utcnow)
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "kind": self.kind,
            "status": self.status,
            "progress_pct": self.progress_pct,
            "progress_message": self.progress_message,
            "params": self.params,
            "result": self.result,
            "error": self.error,
            "error_code": self.error_code,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    """Thread-safe async job manager."""

    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def submit(self, kind: str, params: dict[str, Any], runner: JobRunner) -> JobRecord:
        """Create and start a new async job."""
        job_id = str(uuid.uuid4())
        job = JobRecord(job_id=job_id, kind=kind, params=params)
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(
            target=self._run_job,
            args=(job_id, runner),
            daemon=True,
            name=f"sidecar-job-{job_id[:8]}",
        )
        thread.start()
        return job

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[JobRecord]:
        with self._lock:
            return sorted(
                list(self._jobs.values()),
                key=lambda j: j.created_at,
            )

    def _set_progress(self, job_id: str, progress_pct: int, message: str | None = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            progress_pct = max(0, min(100, int(progress_pct)))
            if progress_pct < job.progress_pct:
                progress_pct = job.progress_pct
            job.progress_pct = progress_pct
            if message is not None:
                job.progress_message = message

    def cancel(self, job_id: str) -> str | None:
        """Cancel a job. Queued → immediately canceled; running → best-effort (marks canceled).

        Returns the new status string, or None if job_id not found.
        Already-terminal statuses (done/error/canceled) return current status (idempotent).
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if job.status in ("done", "error", "canceled"):
                return job.status
            job.status = "canceled"
            job.finished_at = _utcnow()
            if not job.progress_message:
                job.progress_message = "Canceled"
            return "canceled"

    def _run_job(self, job_id: str, runner: JobRunner) -> None:
        with self._lock:
            job = self._jobs[job_id]
            # If already canceled (e.g. cancel called before thread started)
            if job.status == "canceled":
                return
            job.status = "running"
            job.started_at = _utcnow()
            job.progress_pct = 1
            job.progress_message = "Job started"

        def progress_cb(progress_pct: int, message: str | None = None) -> None:
            self._set_progress(job_id, progress_pct, message)

        try:
            result = runner(job_id, job.kind, job.params, progress_cb)
            with self._lock:
                job = self._jobs[job_id]
                if job.status == "canceled":
                    return  # don't overwrite a cancel that arrived during execution
                job.status = "done"
                job.progress_pct = 100
                if job.progress_message is None:
                    job.progress_message = "Completed"
                job.result = result
                job.finished_at = _utcnow()
        except Exception as exc:
            with self._lock:
                job = self._jobs[job_id]
                if job.status == "canceled":
                    return
                job.status = "error"
                job.error = str(exc)
                job.error_code = "INTERNAL_ERROR"
                job.finished_at = _utcnow()
                if job.progress_pct < 100:
                    job.progress_pct = max(1, job.progress_pct)
                if not job.progress_message:
                    job.progress_message = "Failed"

