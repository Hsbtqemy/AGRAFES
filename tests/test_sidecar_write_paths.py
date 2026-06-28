"""Unit tests for the POST write-path token gate (audit SID-02).

`_post_requires_write_token` is the single source of truth for which POST routes
require the write token. It's a pure predicate — no server needed — so it guards
cheaply against the SID-02 class of bug: a mutating route silently falling outside
the token gate (exact-match set blind to prefix/suffix-dispatched routes).
"""

from __future__ import annotations

import pytest

from multicorpus_engine.sidecar import _WRITE_PATHS, _post_requires_write_token


@pytest.mark.parametrize("path", [
    "/index", "/import", "/curate", "/segment", "/annotate",
    "/documents/update", "/documents/bulk_update", "/documents/delete",
    "/units/merge", "/units/split", "/units/update_text",
    "/jobs", "/jobs/enqueue", "/import-remote",
    # Previously-missing mutators that this fix closes:
    "/curate/exceptions/set", "/curate/exceptions/delete",
    "/export/tmx", "/export/bilingual",
])
def test_exact_write_paths_require_token(path: str) -> None:
    assert path in _WRITE_PATHS
    assert _post_requires_write_token(path)


@pytest.mark.parametrize("path", [
    "/jobs/abc-123/cancel",
    "/families/5/segment",
    "/families/42/align",
])
def test_dynamic_mutators_require_token(path: str) -> None:
    """Routes dispatched by prefix/suffix the exact set can't see (SID-02 class)."""
    assert path not in _WRITE_PATHS          # not an exact entry…
    assert _post_requires_write_token(path)  # …but still gated


@pytest.mark.parametrize("path", [
    "/curate/preview", "/curate/exceptions", "/curate/apply-history",
    "/align/audit", "/align/quality", "/segment/preview",
    "/families/5/curation_status",            # GET read, not a write
    "/jobs/abc-123",                          # GET job status
    "/webdav/list",                           # read-only PROPFIND (lock-free)
    "/token_query", "/token_stats",
])
def test_read_paths_do_not_require_token(path: str) -> None:
    assert not _post_requires_write_token(path)
