"""Threading behaviour of the sidecar HTTP server (audit finding R-01b).

The server runs `ThreadingHTTPServer`, but DB *dispatch* is serialized by a global
reentrant lock at the `do_GET`/`do_POST`/`do_PUT` level (so requests still run one
DB-access at a time, exactly like the former single-threaded server). Only
`/health`, `/openapi.json` and `/shutdown` run lock-free — so a handler blocked on
slow/locked DB I/O can no longer freeze `/health` and `/shutdown`, which is what
lets the desktop client health-check and reap a wedged sidecar.

These run the server **in-process** (no subprocess), so they avoid the flaky
real-sidecar-subprocess path of the other ``test_sidecar_*`` modules.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

from multicorpus_engine.sidecar import CorpusServer


def _get_json(base_url: str, path: str, timeout: float = 3.0) -> tuple[int, dict]:
    with urlopen(f"{base_url}{path}", timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _start_server(tmp_path: Path) -> CorpusServer:
    server = CorpusServer(str(tmp_path / "threading.db"), host="127.0.0.1", port=0)
    server.start()
    return server


def test_server_is_threaded_with_daemon_threads(tmp_path: Path) -> None:
    """ThreadingHTTPServer with daemon request threads, so a stuck handler thread
    can never block process exit at shutdown."""
    server = _start_server(tmp_path)
    try:
        assert isinstance(server._httpd, ThreadingHTTPServer)
        assert server._httpd.daemon_threads is True
    finally:
        server.shutdown()


def test_dispatch_lock_reentrancy_does_not_deadlock(tmp_path: Path) -> None:
    """A normal DB request goes through the dispatch RLock AND the handler's inner
    `with self._lock()` — the reentrant lock must not deadlock."""
    server = _start_server(tmp_path)
    base_url = f"http://127.0.0.1:{server.actual_port}"
    try:
        status, payload = _get_json(base_url, "/corpus/info", timeout=5.0)
        assert status == 200
        assert payload["ok"] is True
    finally:
        server.shutdown()


def test_health_stays_responsive_while_a_handler_holds_the_lock(tmp_path: Path) -> None:
    """A DB handler blocked on the dispatch lock must NOT freeze /health (R-01b).

    We hold the server's lock from the test, fire a GET /corpus/info (which acquires
    that lock at dispatch) so it blocks inside the server occupying one worker thread,
    then assert /health still answers. Under the old single-threaded HTTPServer the
    server would be busy in the blocked handler and /health would time out.
    """
    server = _start_server(tmp_path)
    base_url = f"http://127.0.0.1:{server.actual_port}"
    lock = server._httpd.lock  # type: ignore[attr-defined]

    lock.acquire()
    blocked_done = threading.Event()

    def _blocked_request() -> None:
        try:
            _get_json(base_url, "/corpus/info", timeout=10.0)
        except Exception:
            pass
        finally:
            blocked_done.set()

    worker = threading.Thread(target=_blocked_request, daemon=True)
    worker.start()
    time.sleep(0.4)  # let the request connect and block on the (held) dispatch lock

    try:
        status, payload = _get_json(base_url, "/health", timeout=3.0)
        assert status == 200
        assert payload["ok"] is True
        # The blocked request is still pending — proving it held a worker thread
        # (blocked on the lock) while /health was served concurrently.
        assert not blocked_done.is_set()
    finally:
        lock.release()
        worker.join(timeout=5.0)
        server.shutdown()
