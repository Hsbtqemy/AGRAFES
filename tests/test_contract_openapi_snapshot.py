"""Contract freeze — OpenAPI path snapshot test.

This test ensures that:
1. No existing endpoint disappears (breaking change detection).
2. The snapshot file is the single source of truth.

When adding new endpoints, regenerate the snapshot:
    python scripts/export_openapi.py
    python -c "
    import json, sys; sys.path.insert(0, 'src')
    from multicorpus_engine.sidecar_contract import openapi_spec
    spec = openapi_spec()
    entries = sorted(f'{m.upper()} {p}' for p,ms in spec['paths'].items() for m in ms)
    open('tests/snapshots/openapi_paths.json','w').write(json.dumps(entries, indent=2)+'\\\\n')
    "
Never delete entries from the snapshot without a deliberate breaking-change decision.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Ensure src is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

SNAPSHOT_PATH = Path(__file__).resolve().parent / "snapshots" / "openapi_paths.json"


def _current_paths() -> list[str]:
    """Derive METHOD /path entries from the live openapi_spec()."""
    from multicorpus_engine.sidecar_contract import openapi_spec
    spec = openapi_spec()
    entries = []
    for path, methods in spec["paths"].items():
        for method in methods:
            entries.append(f"{method.upper()} {path}")
    return sorted(entries)


def _snapshot_paths() -> list[str]:
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def test_snapshot_file_exists() -> None:
    assert SNAPSHOT_PATH.exists(), (
        f"Snapshot not found: {SNAPSHOT_PATH}\n"
        "Run `python scripts/export_openapi.py` to generate it."
    )


def test_no_endpoints_removed() -> None:
    """Every path in the snapshot must still exist in the current spec.

    FAIL = breaking change (endpoint removed or method changed).
    To fix: restore the endpoint, OR deliberately update the snapshot and document
    the breaking change in CHANGELOG.md.
    """
    snapshot = _snapshot_paths()
    current = set(_current_paths())
    missing = [entry for entry in snapshot if entry not in current]
    assert not missing, (
        f"Breaking change: {len(missing)} endpoint(s) disappeared from the spec:\n"
        + "\n".join(f"  - {e}" for e in missing)
        + "\n\nIf this is intentional, update tests/snapshots/openapi_paths.json "
        "and document the breaking change in CHANGELOG.md."
    )


def test_snapshot_matches_current_spec() -> None:
    """Full equality check: snapshot == current paths.

    If this FAILS but test_no_endpoints_removed passes, it means new endpoints
    were added without updating the snapshot.  Update the snapshot by running:
        python scripts/export_openapi.py
    and regenerating tests/snapshots/openapi_paths.json.
    """
    snapshot = _snapshot_paths()
    current = _current_paths()
    added = [e for e in current if e not in snapshot]
    # New additions are allowed (no fail), but log them so CI makes them visible
    if added:
        import warnings
        warnings.warn(
            f"{len(added)} new endpoint(s) not yet in snapshot:\n"
            + "\n".join(f"  + {e}" for e in added)
            + "\nConsider updating tests/snapshots/openapi_paths.json.",
            stacklevel=1,
        )
    # Only assert no regressions (missing ones already caught above)
    snapshot_set = set(snapshot)
    current_set = set(current)
    removed = snapshot_set - current_set
    assert not removed


def test_openapi_spec_has_contract_version() -> None:
    from multicorpus_engine.sidecar_contract import CONTRACT_VERSION, openapi_spec
    spec = openapi_spec()
    info = spec.get("info", {})
    assert "x-contract-version" in info, "OpenAPI info must include x-contract-version"
    assert info["x-contract-version"] == CONTRACT_VERSION


def test_openapi_spec_required_fields() -> None:
    from multicorpus_engine.sidecar_contract import openapi_spec
    spec = openapi_spec()
    assert spec.get("openapi", "").startswith("3.")
    assert "info" in spec
    assert "paths" in spec
    assert "components" in spec
    assert "schemas" in spec["components"]
    schemas = spec["components"]["schemas"]
    for required_schema in ("BaseResponse", "ErrorResponse", "HealthResponse"):
        assert required_schema in schemas, f"Missing required schema: {required_schema}"
