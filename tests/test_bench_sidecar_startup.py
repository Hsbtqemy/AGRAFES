from scripts.bench_sidecar_startup import _filter_disallowed_stderr


def test_filter_disallowed_stderr_empty_is_ok() -> None:
    assert _filter_disallowed_stderr("") == []
    assert _filter_disallowed_stderr("\n") == []


def test_filter_disallowed_stderr_rejects_any_non_empty_line() -> None:
    stderr_text = "Encoding detection fell back to cp1252 for fixture.txt\n"
    assert _filter_disallowed_stderr(stderr_text) == [
        "Encoding detection fell back to cp1252 for fixture.txt"
    ]
    stderr_text = "Unexpected stderr line\n"
    assert _filter_disallowed_stderr(stderr_text) == ["Unexpected stderr line"]
