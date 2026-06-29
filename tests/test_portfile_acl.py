"""SEC-04 — portfile DACL tightening on Windows.

The sidecar portfile is created with POSIX mode 0o600, which is a near no-op on
Windows (the file inherits the parent directory's ACL). `_restrict_file_to_current_user`
shells out to the built-in `icacls` to restrict it to the current user. The helper
is tested via its injectable `is_windows`/`run` hooks so these run on any platform
without touching real ACLs.
"""

from __future__ import annotations

from pathlib import Path

from multicorpus_engine.sidecar import _restrict_file_to_current_user


def test_noop_off_windows() -> None:
    calls = []
    result = _restrict_file_to_current_user(
        Path("x.json"), is_windows=False, run=lambda *a, **k: calls.append((a, k))
    )
    assert result is False
    assert calls == []  # never shells out off Windows


def test_runs_icacls_on_windows() -> None:
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))

    result = _restrict_file_to_current_user(
        Path("port.json"), is_windows=True, run=fake_run
    )
    assert result is True
    assert len(calls) == 1
    argv = calls[0][0]
    assert argv[0] == "icacls"
    assert "/inheritance:r" in argv          # drop inherited ACEs
    assert "/grant:r" in argv                # replace, not add
    assert argv[-1].endswith(":F")           # grant Full to the current user


def test_never_raises_when_icacls_fails() -> None:
    def boom(*a, **k):
        raise OSError("icacls not found")

    # Must swallow the error and report not-applied (portfile creation must not fail).
    assert _restrict_file_to_current_user(Path("p.json"), is_windows=True, run=boom) is False
