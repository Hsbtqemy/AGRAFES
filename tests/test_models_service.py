"""Phase 1 of the spaCy on-demand model download (docs/DESIGN_spacy_model_download.md).

Covers the engine service headlessly: the user models dir resolver, version
resolution (live compatibility table + pinned fallback), install from a synthetic
wheel via an injected opener (no network), the security guards (allowlist +
zip-slip), removal, and the CLI `models list` wiring. All offline.
"""

import io
import json
import zipfile

import pytest

from multicorpus_engine import paths
from multicorpus_engine.services import models_service as ms
from multicorpus_engine.services.errors import (
    BadRequestError,
    NotFoundError,
    ValidationError,
)

MODEL = "fr_core_news_md"
VERSION = "3.8.0"


# ─── Test doubles ───────────────────────────────────────────────────────────

class _FakeResp:
    """Minimal urlopen-like context manager over in-memory bytes."""

    def __init__(self, data: bytes):
        self._buf = io.BytesIO(data)
        self.headers = {"Content-Length": str(len(data))}

    def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._buf.close()
        return False


def _wheel_bytes(name: str, version: str, *, extra: list[str] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{name}/__init__.py", "# model package\n")
        zf.writestr(f"{name}/meta.json", json.dumps({"name": name, "version": version}))
        zf.writestr(f"{name}/{name}-{version}/config.cfg", "[nlp]\nlang = 'xx'\n")
        zf.writestr(f"{name}/{name}-{version}/meta.json", json.dumps({"version": version}))
        # dist-info is outside the `{name}/` package and must be ignored on extract.
        zf.writestr(f"{name}-{version}.dist-info/METADATA", f"Name: {name}\n")
        for member in extra or []:
            zf.writestr(member, "x")
    return buf.getvalue()


def _opener(data: bytes):
    return lambda _url: _FakeResp(data)


# ─── Paths resolver ─────────────────────────────────────────────────────────

def test_spacy_models_dir_env_override(tmp_path, monkeypatch):
    target = tmp_path / "models-override"
    monkeypatch.setenv("AGRAFES_MODELS_DIR", str(target))
    resolved = paths.spacy_models_dir()
    assert resolved == target
    assert resolved.is_dir()  # created on resolve


# ─── Listing ────────────────────────────────────────────────────────────────

def test_list_models_empty(tmp_path):
    # Inject "nothing bundled" so the result is deterministic regardless of what spaCy
    # model packages happen to be importable in the test environment. The catalogue is
    # the static extended set (sm/md/lg per language), offline — no network.
    models = ms.list_models(tmp_path, is_bundled=lambda _n: False)
    assert len(models) == len(ms._STATIC_CATALOG) > 9
    assert all(m["installed"] is False and m["version"] is None for m in models)
    assert all(m["source"] == "absent" for m in models)
    fr = next(m for m in models if m["name"] == MODEL)
    assert fr["language"] == "fr" and fr["approx_size_mb"] > 0


def test_list_models_parses_genre_and_size(tmp_path):
    models = {m["name"]: m for m in ms.list_models(tmp_path, is_bundled=lambda _n: False)}
    lg = models["fr_core_news_lg"]
    assert lg["genre"] == "core" and lg["size_class"] == "lg" and lg["approx_size_mb"] == 500
    xx = models["xx_ent_wiki_sm"]
    assert xx["language"] == "xx" and xx["genre"] == "ent" and xx["size_class"] == "sm"


def test_list_models_language_filter(tmp_path):
    fr = ms.list_models(tmp_path, language="fr", is_bundled=lambda _n: False)
    assert fr and all(m["language"] == "fr" for m in fr)
    # Filtering never invents models outside the catalogue.
    assert {m["name"] for m in fr} <= set(ms._STATIC_CATALOG)


def test_list_models_includes_downloaded_outside_static_set(tmp_path):
    # A model installed but not in the static list still shows (source downloaded).
    (tmp_path / "nl_core_news_sm").mkdir()
    names = {m["name"]: m for m in ms.list_models(tmp_path, is_bundled=lambda _n: False)}
    assert names["nl_core_news_sm"]["source"] == "downloaded"


def test_list_models_marks_bundled(tmp_path):
    # A model importable in-process (embedded in a frozen sidecar) is *available*
    # even though it was never downloaded to the user dir → source "bundled", not
    # "absent". This is the incoherence Lot 1 fixes: annotation worked but Paramètres
    # showed "Absent" + "Télécharger".
    models = ms.list_models(tmp_path, is_bundled=lambda n: n == MODEL)
    fr = next(m for m in models if m["name"] == MODEL)
    assert fr["source"] == "bundled"
    assert fr["installed"] is False  # not in the user dir
    assert fr["version"] is None
    # Every other model is still absent.
    assert all(m["source"] == "absent" for m in models if m["name"] != MODEL)


# ─── Version resolution ─────────────────────────────────────────────────────

def test_resolve_version_from_compat_table():
    # The real compatibility.json keys by MINOR version ("3.8"), not patch ("3.8.14").
    # Use a model version distinct from the pinned fallback (3.8.0) so this test FAILS
    # if live resolution silently falls back instead of reading the table.
    compat = {"spacy": {"3.8": {MODEL: ["3.8.7", "3.7.0"]}}}
    plan = ms.resolve_download(MODEL, spacy_version="3.8.14", fetch_compat=lambda: compat)
    assert plan["version"] == "3.8.7"
    assert plan["url"] == (
        f"https://github.com/explosion/spacy-models/releases/download/"
        f"{MODEL}-3.8.7/{MODEL}-3.8.7-py3-none-any.whl"
    )


def test_resolve_version_prefers_exact_key_for_dev_builds():
    # Dev/rc spaCy versions appear as exact keys (e.g. "3.7.0.dev0"); exact wins over minor.
    compat = {"spacy": {"3.7.0.dev0": {MODEL: ["3.7.9"]}, "3.7": {MODEL: ["3.7.0"]}}}
    plan = ms.resolve_download(MODEL, spacy_version="3.7.0.dev0", fetch_compat=lambda: compat)
    assert plan["version"] == "3.7.9"


def test_resolve_version_falls_back_to_pinned_when_compat_unusable():
    # Empty table and a raising fetcher both fall back to the pinned version.
    assert ms.resolve_download(MODEL, spacy_version="9.9.9", fetch_compat=lambda: {})["version"] == VERSION

    def _boom():
        raise RuntimeError("offline")

    assert ms.resolve_download(MODEL, spacy_version="9.9.9", fetch_compat=_boom)["version"] == VERSION


# ─── Install / remove ───────────────────────────────────────────────────────

def test_install_then_remove_model(tmp_path):
    seen: list[int] = []
    result = ms.install_model(
        MODEL,
        tmp_path,
        progress_cb=lambda pct, msg=None: seen.append(pct),
        fetch_compat=lambda: {},  # force pinned 3.8.0
        open_url=_opener(_wheel_bytes(MODEL, VERSION)),
    )
    assert result == {"name": MODEL, "version": VERSION, "path": str(tmp_path / MODEL)}
    assert (tmp_path / MODEL / "__init__.py").is_file()
    assert (tmp_path / MODEL / f"{MODEL}-{VERSION}" / "config.cfg").is_file()
    # dist-info (outside the package) is not extracted.
    assert not (tmp_path / f"{MODEL}-{VERSION}.dist-info").exists()
    assert seen and seen[-1] == 100

    listed = next(m for m in ms.list_models(tmp_path, is_bundled=lambda _n: False) if m["name"] == MODEL)
    assert listed["installed"] is True and listed["version"] == VERSION
    assert listed["source"] == "downloaded"

    assert ms.remove_model(MODEL, tmp_path) == {"name": MODEL}
    assert not (tmp_path / MODEL).exists()
    assert not (tmp_path / f".{MODEL}.json").exists()


def test_model_data_dir_resolves_after_install(tmp_path):
    # The annotator loads a downloaded model by PATH to its data dir (it has no
    # distribution metadata, so spacy.load(name) can't find it).
    ms.install_model(MODEL, tmp_path, fetch_compat=lambda: {}, open_url=_opener(_wheel_bytes(MODEL, VERSION)))
    data = paths.model_data_dir(MODEL, tmp_path)
    assert data == tmp_path / MODEL / f"{MODEL}-{VERSION}"
    assert (data / "config.cfg").is_file()
    # A non-installed model resolves to None.
    assert paths.model_data_dir("en_core_web_md", tmp_path) is None


def test_install_is_atomic_overwrite(tmp_path):
    opener = _opener(_wheel_bytes(MODEL, VERSION))
    ms.install_model(MODEL, tmp_path, fetch_compat=lambda: {}, open_url=opener)
    # Re-installing over an existing model replaces it cleanly (no leftover temp dirs).
    ms.install_model(MODEL, tmp_path, fetch_compat=lambda: {}, open_url=opener)
    assert (tmp_path / MODEL / "__init__.py").is_file()
    leftovers = [p.name for p in tmp_path.iterdir() if p.name.startswith(f".{MODEL}-")]
    assert leftovers == []


# ─── Security guards ────────────────────────────────────────────────────────

def test_unknown_model_rejected(tmp_path):
    # "evil_model" fails the name grammar (regex) — rejected before any network.
    with pytest.raises(ValidationError):
        ms.install_model("evil_model", tmp_path, fetch_compat=lambda: {}, open_url=_opener(b""))
    with pytest.raises(BadRequestError):
        ms.install_model("  ", tmp_path)


def test_install_allowlist_is_dynamic(tmp_path):
    # A regex-valid name that is NOT in the compatibility.json catalogue is refused —
    # the allowlist is the live table, not a hardcoded list. (fr_core_news_md is present.)
    compat = {"spacy": {"3.8": {"fr_core_news_md": ["3.8.0"]}}}
    with pytest.raises(ValidationError):
        ms.resolve_download("zz_core_news_lg", spacy_version="3.8", fetch_compat=lambda: compat)
    plan = ms.resolve_download("fr_core_news_md", spacy_version="3.8", fetch_compat=lambda: compat)
    assert plan["version"] == "3.8.0"


def test_is_valid_model_name():
    assert ms.is_valid_model_name("fr_core_news_lg")
    assert ms.is_valid_model_name("xx_ent_wiki_sm")
    assert not ms.is_valid_model_name("evil_model")   # 4-letter lead, no early underscore
    assert not ms.is_valid_model_name("../etc/passwd")
    assert not ms.is_valid_model_name("")
    assert not ms.is_valid_model_name(None)


def test_zip_slip_rejected(tmp_path):
    malicious = _wheel_bytes(MODEL, VERSION, extra=[f"{MODEL}/../escaped.txt"])
    with pytest.raises(ValidationError):
        ms.install_model(MODEL, tmp_path, fetch_compat=lambda: {}, open_url=_opener(malicious))
    # Nothing escaped the models dir.
    assert not (tmp_path.parent / "escaped.txt").exists()
    assert not (tmp_path / "escaped.txt").exists()


def test_remove_missing_model_raises(tmp_path):
    with pytest.raises(NotFoundError):
        ms.remove_model(MODEL, tmp_path, is_bundled=lambda _n: False)


def test_remove_refuses_bundled(tmp_path):
    # A bundled (embedded) model has no user-dir copy to delete → removal is refused
    # with BadRequestError (not the misleading NotFoundError of a truly-absent model).
    with pytest.raises(BadRequestError):
        ms.remove_model(MODEL, tmp_path, is_bundled=lambda _n: True)


# ─── CLI wiring ─────────────────────────────────────────────────────────────

def test_cli_models_list(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("AGRAFES_MODELS_DIR", str(tmp_path))
    from multicorpus_engine.cli import build_parser

    args = build_parser().parse_args(["models", "list"])
    args.func(args)
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "ok"
    # Static extended catalogue (offline, no network) — more than the former 9.
    assert len(payload["models"]) == len(ms._STATIC_CATALOG) > 9
    assert all(not m["installed"] for m in payload["models"])
