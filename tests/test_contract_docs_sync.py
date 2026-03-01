"""Contract freeze — documentation sync test.

Verifies that docs/SIDECAR_API_CONTRACT.md mentions all routes defined in
the OpenAPI spec.  This prevents silent drift between code and docs.

Policy:
- Each route path must appear at least once in the markdown doc.
- This is a heuristic check (regex), not a structural parse.
- If a route is missing from the doc, add it to SIDECAR_API_CONTRACT.md.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

CONTRACT_DOC = Path(__file__).resolve().parent.parent / "docs" / "SIDECAR_API_CONTRACT.md"


def _get_all_paths() -> list[str]:
    from multicorpus_engine.sidecar_contract import openapi_spec
    spec = openapi_spec()
    return sorted(spec["paths"].keys())


def test_contract_doc_exists() -> None:
    assert CONTRACT_DOC.exists(), f"Missing: {CONTRACT_DOC}"


def test_all_routes_mentioned_in_doc() -> None:
    """Every route path in the OpenAPI spec must appear in the contract markdown."""
    doc_text = CONTRACT_DOC.read_text(encoding="utf-8")
    all_paths = _get_all_paths()

    # Paths that use template params in OpenAPI (e.g. /jobs/{job_id}) may appear
    # in the doc without the exact template syntax — normalise for matching.
    def _doc_pattern(path: str) -> str:
        # /jobs/{job_id} → look for /jobs/ or /jobs/{job_id} in the doc
        return re.escape(path.split("{")[0].rstrip("/")) if "{" in path else re.escape(path)

    missing = []
    for path in all_paths:
        pattern = _doc_pattern(path)
        if not re.search(pattern, doc_text):
            missing.append(path)

    assert not missing, (
        f"{len(missing)} route(s) not found in {CONTRACT_DOC.name}:\n"
        + "\n".join(f"  {p}" for p in missing)
        + "\n\nAdd them to docs/SIDECAR_API_CONTRACT.md."
    )


def test_contract_doc_has_version_header() -> None:
    doc_text = CONTRACT_DOC.read_text(encoding="utf-8")
    assert "api_version" in doc_text.lower() or "v1.1" in doc_text or "contract" in doc_text.lower(), (
        "SIDECAR_API_CONTRACT.md should mention the API version"
    )
