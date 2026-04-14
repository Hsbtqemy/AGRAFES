from scripts.bench_sidecar_startup import _filter_disallowed_stderr


def test_filter_disallowed_stderr_empty_is_ok() -> None:
    assert _filter_disallowed_stderr("") == []
    assert _filter_disallowed_stderr("\n") == []


def test_filter_disallowed_stderr_allows_known_pyinstaller_pkgres_warning() -> None:
    stderr_text = (
        "pyi_rth_pkgres.py:44: DeprecationWarning: pkg_resources is deprecated as an API.\n"
    )
    assert _filter_disallowed_stderr(stderr_text) == []


def test_filter_disallowed_stderr_rejects_unexpected_lines() -> None:
    stderr_text = "Encoding detection fell back to cp1252 for fixture.txt\n"
    assert _filter_disallowed_stderr(stderr_text) == [
        "Encoding detection fell back to cp1252 for fixture.txt"
    ]
    stderr_text = "Unexpected stderr line\n"
    assert _filter_disallowed_stderr(stderr_text) == ["Unexpected stderr line"]
