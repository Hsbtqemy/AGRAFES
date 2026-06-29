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

import json
import shutil
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from ..paths import spacy_models_dir
from .errors import BadRequestError, NotFoundError, ValidationError

ProgressCb = Callable[[int, Optional[str]], None]


@dataclass(frozen=True)
class ModelSpec:
    name: str
    language: str       # ISO code, or "mul" for the multilingual model
    approx_size_mb: int  # for UI hints only


# The 9 models the annotator maps languages to (annotator._DEFAULT_MODEL_BY_LANG).
MODEL_CATALOG: dict[str, ModelSpec] = {
    "fr_core_news_md": ModelSpec("fr_core_news_md", "fr", 45),
    "en_core_web_md": ModelSpec("en_core_web_md", "en", 40),
    "de_core_news_md": ModelSpec("de_core_news_md", "de", 45),
    "es_core_news_md": ModelSpec("es_core_news_md", "es", 45),
    "it_core_news_md": ModelSpec("it_core_news_md", "it", 45),
    "sv_core_news_sm": ModelSpec("sv_core_news_sm", "sv", 13),
    "ro_core_news_md": ModelSpec("ro_core_news_md", "ro", 45),
    "el_core_news_sm": ModelSpec("el_core_news_sm", "el", 13),
    "xx_ent_wiki_sm": ModelSpec("xx_ent_wiki_sm", "mul", 11),
}

# Offline fallback when the live compatibility table is unreachable. Tracks the
# spaCy 3.8.x line bundled in the sidecar (`spacy>=3.7`); live compatibility.json
# overrides this when available.
_PINNED_MODEL_VERSIONS: dict[str, str] = {name: "3.8.0" for name in MODEL_CATALOG}

_COMPAT_URL = "https://raw.githubusercontent.com/explosion/spacy-models/master/compatibility.json"
_RELEASE_URL = (
    "https://github.com/explosion/spacy-models/releases/download/"
    "{name}-{ver}/{name}-{ver}-py3-none-any.whl"
)
_CHUNK = 256 * 1024


# ─── Validation / introspection ─────────────────────────────────────────────

def _validate_name(name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise BadRequestError("model name is required")
    resolved = name.strip()
    if resolved not in MODEL_CATALOG:
        raise ValidationError(
            f"unknown model: {resolved!r}",
            details={"allowed": sorted(MODEL_CATALOG)},
        )
    return resolved


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


def list_models(models_dir: Optional[Path] = None) -> list[dict]:
    """List the known models with install status (installed-only knows the version)."""
    target = models_dir or spacy_models_dir()
    out: list[dict] = []
    for spec in MODEL_CATALOG.values():
        installed = (target / spec.name).is_dir()
        out.append(
            {
                "name": spec.name,
                "language": spec.language,
                "approx_size_mb": spec.approx_size_mb,
                "installed": installed,
                "version": _installed_version(target, spec.name) if installed else None,
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


def _resolve_version(
    name: str,
    *,
    spacy_version: Optional[str] = None,
    fetch_compat: Optional[Callable[[], object]] = None,
) -> str:
    version = spacy_version or _installed_spacy_version()
    fetcher = fetch_compat if fetch_compat is not None else _fetch_compat
    try:
        compat = fetcher()
    except Exception:
        compat = None
    found = _lookup_compat(compat, version, name) if compat is not None else None
    if found:
        return found
    pinned = _PINNED_MODEL_VERSIONS.get(name)
    if pinned:
        return pinned
    raise NotFoundError(f"no compatible version found for {name!r} (spaCy {version!r})")


def resolve_download(
    name: str,
    *,
    spacy_version: Optional[str] = None,
    fetch_compat: Optional[Callable[[], object]] = None,
) -> dict:
    """Resolve a model name to a concrete {name, version, url} download plan."""
    name = _validate_name(name)
    version = _resolve_version(name, spacy_version=spacy_version, fetch_compat=fetch_compat)
    return {"name": name, "version": version, "url": _RELEASE_URL.format(name=name, ver=version)}


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
    name = _validate_name(name)
    target = models_dir or spacy_models_dir()
    target.mkdir(parents=True, exist_ok=True)

    plan = resolve_download(name, fetch_compat=fetch_compat)
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


def remove_model(name: str, models_dir: Optional[Path] = None) -> dict:
    """Remove an installed model and its metadata marker."""
    name = _validate_name(name)
    target = models_dir or spacy_models_dir()
    dest = target / name
    if not dest.is_dir():
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
