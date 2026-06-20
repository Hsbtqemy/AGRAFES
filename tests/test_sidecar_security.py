"""Security hardening of the sidecar HTTP server (audit findings S-01, S-02).

Run in-process (no subprocess) so they avoid the flaky real-sidecar-subprocess path
of the other ``test_sidecar_*`` modules.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from multicorpus_engine.sidecar import CorpusServer, sidecar_portfile_path


def _start(tmp_path: Path, db_name: str = "sec.db") -> CorpusServer:
    server = CorpusServer(str(tmp_path / db_name), host="127.0.0.1", port=0)
    server.start()
    return server


# ── S-01 — Host header loopback guard (DNS-rebinding) ─────────────────────────

def test_foreign_host_header_is_rejected(tmp_path: Path) -> None:
    server = _start(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        req = Request(f"{base}/health", headers={"Host": "evil.example.com"})
        with pytest.raises(HTTPError) as exc:
            urlopen(req, timeout=3)
        assert exc.value.code == 403
    finally:
        server.shutdown()


def test_loopback_host_is_accepted(tmp_path: Path) -> None:
    server = _start(tmp_path)
    base = f"http://127.0.0.1:{server.actual_port}"
    try:
        # urllib sets Host: 127.0.0.1:<port> by default → allowed.
        with urlopen(f"{base}/health", timeout=3) as resp:
            assert resp.status == 200
        # An explicit `localhost` Host is allowed too.
        req = Request(f"{base}/health", headers={"Host": f"localhost:{server.actual_port}"})
        with urlopen(req, timeout=3) as resp:
            assert resp.status == 200
    finally:
        server.shutdown()


# ── S-02 — portfile created with restrictive perms, no race ───────────────────

def test_portfile_created_with_restrictive_perms(tmp_path: Path) -> None:
    server = _start(tmp_path)
    try:
        pf = sidecar_portfile_path(tmp_path / "sec.db")
        assert pf.exists()
        data = json.loads(pf.read_text(encoding="utf-8"))
        assert data["port"] == server.actual_port
        if os.name == "posix":
            mode = stat.S_IMODE(pf.stat().st_mode)
            assert mode == 0o600, f"expected 0o600, got {oct(mode)}"
    finally:
        server.shutdown()


def test_portfile_overwrites_stale(tmp_path: Path) -> None:
    """A stale portfile must be replaced (O_EXCL → unlink → recreate), not appended to."""
    db = tmp_path / "sec.db"
    pf = sidecar_portfile_path(db)
    pf.write_text("STALE GARBAGE", encoding="utf-8")
    server = CorpusServer(str(db), host="127.0.0.1", port=0)
    server.start()
    try:
        data = json.loads(pf.read_text(encoding="utf-8"))
        assert data["port"] == server.actual_port
    finally:
        server.shutdown()
