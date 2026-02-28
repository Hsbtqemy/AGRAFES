from scripts.bench_sidecar_startup import _filter_disallowed_stderr


def test_filter_disallowed_stderr_accepts_allowed_warning_only() -> None:
    stderr_text = "Encoding detection fell back to cp1252 for fixture.txt\n"
    assert _filter_disallowed_stderr(stderr_text) == []


def test_filter_disallowed_stderr_rejects_unknown_text() -> None:
    stderr_text = (
        "Encoding detection fell back to cp1252 for fixture.txt\n"
        "Unexpected stderr line\n"
    )
    assert _filter_disallowed_stderr(stderr_text) == ["Unexpected stderr line"]
