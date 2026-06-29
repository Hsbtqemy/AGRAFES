"""User-level filesystem path resolvers for engine data (spaCy models, …).

Stdlib-only (no ``platformdirs`` dependency). The spaCy models directory is
**shared across all corpora** — models are per-language and large (hundreds of
MB total), so duplicating them per-DB would be wasteful. Override with the
``AGRAFES_MODELS_DIR`` environment variable for tests / portable installs.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_APP_DIRNAME = "AGRAFES"
_MODELS_SUBDIR = "spacy-models"


def _user_data_root() -> Path:
    """Platform user-data base directory, resolved from env with home fallbacks."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        return Path(base) if base else Path.home() / "AppData" / "Local"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    # Linux / other POSIX: XDG base dir spec.
    xdg = os.environ.get("XDG_DATA_HOME")
    return Path(xdg) if xdg else Path.home() / ".local" / "share"


def spacy_models_dir(*, create: bool = True) -> Path:
    """Resolve the user-level spaCy models directory.

    Resolution order: ``AGRAFES_MODELS_DIR`` env override → platform user-data dir
    (``%LOCALAPPDATA%/AGRAFES/spacy-models`` on Windows,
    ``~/Library/Application Support/AGRAFES/spacy-models`` on macOS,
    ``${XDG_DATA_HOME:-~/.local/share}/agrafes/spacy-models`` elsewhere).

    With ``create=True`` (default) the directory is created if missing.
    """
    override = os.environ.get("AGRAFES_MODELS_DIR")
    if override:
        path = Path(override)
    else:
        app = _APP_DIRNAME if sys.platform in ("win32", "darwin") else _APP_DIRNAME.lower()
        path = _user_data_root() / app / _MODELS_SUBDIR
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path
