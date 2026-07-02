"""spaCy model management — list / resolve / download / remove (audit follow-up).

Phase 1 (engine, headless) of ``docs/DESIGN_spacy_model_download.md``.

Models are downloaded **on demand** (the installer ships none) into a user-level
directory (``paths.spacy_models_dir``) and made loadable by the annotator without
``pip``. The download source is restricted to the official Explosion GitHub
releases over https, model names to a fixed **allowlist**, and archive extraction
is guarded against path traversal (zip-slip).

Network and the compatibility table are injectable (``open_url`` / ``fetch_compat``)
so the whole flow is testable offline with a synthetic wheel.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Optional

from ..paths import spacy_models_dir
from .errors import BadRequestError, NotFoundError, ValidationError

ProgressCb = Callable[[int, Optional[str]], None]


# spaCy model name grammar — the security frontier alongside the compat.json allowlist:
# ``<lang>_<type>_<source>_<size>``, lowercase letters/digits, underscore-separated.
_NAME_RE = re.compile(r"^[a-z]{2,3}(_[a-z0-9]+)+$")

# Indicative download sizes (Mo) by size class — compatibility.json carries no sizes.
_SIZE_MB_BY_CLASS: dict[str, int] = {"sm": 12, "md": 45, "lg": 500, "trf": 450}

# The 9 models the annotator maps languages to by default (annotator._DEFAULT_MODEL_BY_LANG).
_DEFAULT_MODEL_NAMES: tuple[str, ...] = (
    "fr_core_news_md", "en_core_web_md", "de_core_news_md", "es_core_news_md",
    "it_core_news_md", "sv_core_news_sm", "ro_core_news_md", "el_core_news_sm",
    "xx_ent_wiki_sm",
)

# Static catalogue offered for *listing* (offline, lock-free): the defaults plus common
# sizes per language, so the picker offers sm/md/lg without a network call. The full
# compatibility.json catalogue (every language/size) is the *install allowlist*
# (resolve_download) and is fetched on demand — listing never blocks on the network.
_STATIC_CATALOG: tuple[str, ...] = (
    "fr_core_news_sm", "fr_core_news_md", "fr_core_news_lg",
    "en_core_web_sm", "en_core_web_md", "en_core_web_lg", "en_core_web_trf",
    "de_core_news_sm", "de_core_news_md", "de_core_news_lg",
    "es_core_news_sm", "es_core_news_md", "es_core_news_lg",
    "it_core_news_sm", "it_core_news_md", "it_core_news_lg",
    "sv_core_news_sm", "sv_core_news_md", "sv_core_news_lg",
    "ro_core_news_sm", "ro_core_news_md", "ro_core_news_lg",
    "el_core_news_sm", "el_core_news_md", "el_core_news_lg",
    "xx_ent_wiki_sm", "xx_sent_ud_sm",
)

# Offline fallback for the install allowlist + version resolution when compatibility.json
# is unreachable. Tracks the spaCy 3.8.x line bundled in the sidecar (`spacy>=3.7`).
_PINNED_MODEL_VERSIONS: dict[str, str] = {name: "3.8.0" for name in _STATIC_CATALOG}

_COMPAT_URL = "https://raw.githubusercontent.com/explosion/spacy-models/master/compatibility.json"
_RELEASE_URL = (
    "https://github.com/explosion/spacy-models/releases/download/"
    "{name}-{ver}/{name}-{ver}-py3-none-any.whl"
)
_CHUNK = 256 * 1024


# ─── Validation / introspection ─────────────────────────────────────────────

def is_valid_model_name(name: object) -> bool:
    """True if ``name`` matches the spaCy model-name grammar (cheap syntax check, no
    network). Catalogue membership (compat.json) is checked separately at install."""
    return isinstance(name, str) and bool(_NAME_RE.match(name.strip()))


def _validate_name_syntax(name: str) -> str:
    """Blank → BadRequestError; wrong shape → ValidationError. No network, no catalogue."""
    if not isinstance(name, str) or not name.strip():
        raise BadRequestError("model name is required")
    resolved = name.strip()
    if not _NAME_RE.match(resolved):
        raise ValidationError(f"invalid model name: {resolved!r}")
    return resolved


def _parse_model_name(name: str) -> dict:
    """Best-effort split of ``<lang>_<type>_<source>_<size>`` for display fields."""
    parts = name.split("_")
    lang = parts[0] if parts else name
    size_class = parts[-1] if len(parts) >= 2 and parts[-1] in _SIZE_MB_BY_CLASS else ""
    genre = parts[1] if len(parts) >= 2 else ""
    source = parts[2] if len(parts) >= 4 else ""
    return {"language": lang, "genre": genre, "source": source, "size_class": size_class}


def _meta_path(models_dir: Path, name: str) -> Path:
    return models_dir / f".{name}.json"


def _installed_version(models_dir: Path, name: str) -> Optional[str]:
    meta = _meta_path(models_dir, name)
    if meta.is_file():
        try:
            return json.loads(meta.read_text(encoding="utf-8")).get("version")
        except Exception:
            return None
    return None


def _is_model_bundled(name: str) -> bool:
    """True if the model package is importable in-process — i.e. embedded in a frozen
    sidecar (``--collect-all`` at build time). The annotator loads such a model by name
    (``spacy.load(name)``) without it ever being in the user models dir, so a bundled
    model is *available* even though it is not *downloaded*.
    """
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        # find_spec can raise (e.g. a broken/partial parent package) — treat as absent.
        return False


def list_models(
    models_dir: Optional[Path] = None,
    *,
    language: Optional[str] = None,
    is_bundled: Optional[Callable[[str], bool]] = None,
) -> list[dict]:
    """List the catalogue models with availability status (filesystem-only, no network).

    Catalogue = the static extended set (sm/md/lg per language) ∪ anything already
    downloaded (so a model installed outside the static set still shows). Each entry:
      - ``source`` tri-state: ``downloaded`` (user dir, removable) / ``bundled``
        (importable in-process, read-only) / ``absent`` (offered for download);
      - ``genre`` / ``size_class`` / ``approx_size_mb`` parsed from the name;
      - ``installed`` kept (== downloaded) for backward compatibility.

    ``language`` filters to one base code (UI at deploy time). ``is_bundled`` is
    injectable for offline tests (the real detector imports spaCy packages absent from a
    plain dev env).
    """
    target = models_dir or spacy_models_dir()
    bundled = is_bundled if is_bundled is not None else _is_model_bundled
    names = set(_STATIC_CATALOG)
    if target.is_dir():
        for child in target.iterdir():
            if child.is_dir() and _NAME_RE.match(child.name):
                names.add(child.name)
    lang = language.strip().lower() if language else None
    out: list[dict] = []
    for name in sorted(names):
        meta = _parse_model_name(name)
        if lang is not None and meta["language"] != lang:
            continue
        downloaded = (target / name).is_dir()
        if downloaded:
            source = "downloaded"
        elif bundled(name):
            source = "bundled"
        else:
            source = "absent"
        out.append(
            {
                "name": name,
                "language": meta["language"],
                "genre": meta["genre"],
                "size_class": meta["size_class"],
                "approx_size_mb": _SIZE_MB_BY_CLASS.get(meta["size_class"], 0),
                "installed": downloaded,
                "source": source,
                "version": _installed_version(target, name) if downloaded else None,
            }
        )
    return out


# ─── Version resolution ─────────────────────────────────────────────────────

def _installed_spacy_version() -> str:
    try:
        import spacy  # type: ignore[import-not-found]

        return str(spacy.__version__)
    except Exception:
        return ""


def _minor_version(version: str) -> str:
    parts = version.split(".")
    return ".".join(parts[:2]) if len(parts) >= 2 else version


def _lookup_compat(compat: object, spacy_version: str, name: str) -> Optional[str]:
    """Read spaCy's compatibility.json: ``{"spacy": {ver: {model: [v, ...]}}}``.

    The table is keyed by the **minor** version (``"3.8"``), not the patch version
    (``"3.8.14"``) — so try the exact key first (covers dev/rc keys like
    ``"3.7.0.dev0"``), then fall back to the ``major.minor`` key.
    """
    if not isinstance(compat, dict):
        return None
    table = compat.get("spacy")
    if not isinstance(table, dict):
        return None
    for key in (spacy_version, _minor_version(spacy_version)):
        entry = table.get(key)
        if isinstance(entry, dict):
            versions = entry.get(name)
            if isinstance(versions, list) and versions:
                return str(versions[0])
    return None


def _fetch_compat() -> object:
    with _open_url(_COMPAT_URL) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _compat_catalog(compat: object, spacy_version: str) -> Optional[list[str]]:
    """All model names published for this spaCy version in compatibility.json, filtered
    by the name grammar. ``None`` if the table is unusable → callers fall back to pinned."""
    if not isinstance(compat, dict):
        return None
    table = compat.get("spacy")
    if not isinstance(table, dict):
        return None
    for key in (spacy_version, _minor_version(spacy_version)):
        entry = table.get(key)
        if isinstance(entry, dict):
            return sorted(n for n in entry if isinstance(n, str) and _NAME_RE.match(n))
    return None


def resolve_download(
    name: str,
    *,
    spacy_version: Optional[str] = None,
    fetch_compat: Optional[Callable[[], object]] = None,
) -> dict:
    """Resolve a model name to a concrete {name, version, url} download plan.

    Allowlist = the name grammar (checked first, no network) **and** membership in the
    compatibility.json catalogue for the running spaCy version (pinned set as offline
    fallback). One compat fetch covers both the allowlist and the version resolution.
    """
    resolved = _validate_name_syntax(name)  # blank/shape → no network
    version = spacy_version or _installed_spacy_version()
    fetcher = fetch_compat if fetch_compat is not None else _fetch_compat
    try:
        compat = fetcher()
    except Exception:
        compat = None
    catalog = _compat_catalog(compat, version) or sorted(_PINNED_MODEL_VERSIONS)
    if resolved not in catalog:
        raise ValidationError(f"unknown model: {resolved!r}", details={"allowed": catalog})
    found = _lookup_compat(compat, version, resolved) if compat is not None else None
    ver = found or _PINNED_MODEL_VERSIONS.get(resolved)
    if not ver:
        raise NotFoundError(f"no compatible version found for {resolved!r} (spaCy {version!r})")
    return {"name": resolved, "version": ver, "url": _RELEASE_URL.format(name=resolved, ver=ver)}


# ─── Download + extraction ──────────────────────────────────────────────────

def _open_url(url: str):
    if not url.startswith("https://"):
        raise ValidationError("refusing to fetch a non-https URL")
    request = urllib.request.Request(url, headers={"User-Agent": "AGRAFES"})
    return urllib.request.urlopen(request, timeout=60)  # noqa: S310 - url from fixed template


def _download(url: str, dest: Path, *, opener, progress_cb: Optional[ProgressCb]) -> None:
    with opener(url) as resp:
        try:
            total = int(resp.headers.get("Content-Length") or 0)
        except Exception:
            total = 0
        read = 0
        with open(dest, "wb") as handle:
            while True:
                chunk = resp.read(_CHUNK)
                if not chunk:
                    break
                handle.write(chunk)
                read += len(chunk)
                if progress_cb and total:
                    pct = 5 + int(85 * read / total)
                    progress_cb(min(90, pct), f"Téléchargement {read // 1048576} / {total // 1048576} Mo")


def _extract_package(wheel_path: Path, name: str, dest_dir: Path) -> None:
    """Extract only the ``{name}/`` package from the wheel, guarding against zip-slip."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    # Members must stay within the package dir itself (dest_dir/name) — stricter than
    # dest_dir, so even `name/../x` (which would land beside the package) is rejected.
    root = (dest_dir / name).resolve()
    prefix = f"{name}/"
    with zipfile.ZipFile(wheel_path) as archive:
        for member in archive.namelist():
            if not member.startswith(prefix):
                continue
            target = (dest_dir / member).resolve()
            if root != target and root not in target.parents:
                raise ValidationError(f"unsafe path in archive: {member!r}")
            if member.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)


def install_model(
    name: str,
    models_dir: Optional[Path] = None,
    *,
    progress_cb: Optional[ProgressCb] = None,
    fetch_compat: Optional[Callable[[], object]] = None,
    open_url: Optional[Callable[[str], object]] = None,
) -> dict:
    """Download + install a model into the user models dir (atomic move into place)."""
    target = models_dir or spacy_models_dir()
    target.mkdir(parents=True, exist_ok=True)

    plan = resolve_download(name, fetch_compat=fetch_compat)  # validates name + version
    name = plan["name"]
    if progress_cb:
        progress_cb(5, f"Résolution {name} {plan['version']}")

    opener = open_url or _open_url
    tmp_dir = Path(tempfile.mkdtemp(prefix=f".{name}-", dir=str(target)))
    try:
        wheel = tmp_dir / "model.whl"
        _download(plan["url"], wheel, opener=opener, progress_cb=progress_cb)
        if progress_cb:
            progress_cb(90, "Extraction…")
        staged = tmp_dir / "pkg"
        _extract_package(wheel, name, staged)
        src_pkg = staged / name
        if not src_pkg.is_dir():
            raise ValidationError(f"wheel for {name!r} did not contain the expected package")
        dest = target / name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(src_pkg), str(dest))
        _meta_path(target, name).write_text(
            json.dumps({"version": plan["version"]}), encoding="utf-8"
        )
        if progress_cb:
            progress_cb(100, "Terminé")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    clear_model_cache()
    return {"name": name, "version": plan["version"], "path": str(target / name)}


def remove_model(
    name: str,
    models_dir: Optional[Path] = None,
    *,
    is_bundled: Optional[Callable[[str], bool]] = None,
) -> dict:
    """Remove a *downloaded* model and its metadata marker.

    A model embedded in a frozen sidecar (``source == "bundled"``) is read-only: there
    is no user-dir copy to delete, so removal is refused with a clear error rather than
    a misleading "not installed". A model that is both bundled *and* downloaded still
    removes its user-dir duplicate (the bundled copy keeps working).
    """
    name = _validate_name_syntax(name)
    target = models_dir or spacy_models_dir()
    dest = target / name
    if not dest.is_dir():
        bundled = is_bundled if is_bundled is not None else _is_model_bundled
        if bundled(name):
            raise BadRequestError(f"model is bundled (read-only), cannot remove: {name}")
        raise NotFoundError(f"model not installed: {name}")
    shutil.rmtree(dest)
    meta = _meta_path(target, name)
    if meta.exists():
        meta.unlink()
    clear_model_cache()
    return {"name": name}


def clear_model_cache() -> None:
    """Drop the annotator's cached pipelines (lazy import keeps spaCy optional)."""
    try:
        from ..annotator import clear_model_cache as _clear

        _clear()
    except Exception:
        pass
