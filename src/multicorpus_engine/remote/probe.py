"""Lecture d'un dossier WebDAV **sans rien écrire** — la sonde d'import (SD-01).

L'écran d'import local déduit le mode de chaque fichier en le lisant avant de
l'importer : ``/import/preview`` rend ses unités, l'écran en tire un verdict, et
l'utilisateur voit ce que chaque mode ferait du document avant de décider. ShareDocs
n'avait pas cet équivalent — ``/import/preview`` prend un **chemin local** — et
imposait donc un mode unique à tout un lot, présélectionné sur « lignes numérotées »,
défaut mesuré faux sur 149 des 273 fichiers réels du corpus.

Ce module comble ce manque : il parcourt la collection, télécharge chaque fichier
dans un temporaire, le parse avec :func:`preview_text_units` — la **même** fonction
que ``/import/preview``, pour que la sonde et l'import ne puissent pas diverger — puis
supprime le temporaire. **Aucun accès base de données**, aucun run, aucun document.

Le double téléchargement (sonder puis importer) est payé d'avance : mesuré le 28 août
2026 sur les 514 fichiers des deux arbres de corpus, un dossier compte 20 fichiers en
médiane et pèse 3 Mo au pire. C'est ce qui permet de garder la règle de déduction en
**un seul exemplaire**, côté front, plutôt que de la réécrire en Python.
"""

from __future__ import annotations

import fnmatch
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Callable, Optional

from ..services.import_service import preview_text_units
from . import webdav

#: Callback de progression, une fois par fichier — ``{index, total, name, status}``
#: (index à partir de 1). Le sidecar le branche sur ``JobManager``.
ProgressCb = Callable[[dict], None]

#: Extension → mode de **lecture**, et non mode d'import : on veut voir le texte tel
#: quel. Miroir exact de ``ImportScreen._analyzeFile`` côté front, seule autorité sur
#: la déduction — la sonde ne décide de rien, elle donne à voir.
#:
#: TEI et CoNLL-U sont volontairement absents : ces formats se décrivent eux-mêmes
#: (``xml:lang``, colonnes CoNLL-U), il n'y a rien à déduire, donc rien à télécharger.
PROBE_MODES = {
    ".docx": "docx_paragraphs",
    ".odt": "odt_paragraphs",
    ".txt": "txt_numbered_lines",
}

#: Extensions qu'un import sait router, sondables ou non. Sert à séparer **deux
#: situations que rien ne doit confondre** : un `.tei` n'a rien à déduire mais s'importe
#: très bien, un `.pdf` ne s'importe pas du tout. Les rendre sous un statut unique
#: obligerait l'écran à refaire le tri — ou, plus probablement, à proposer un PDF à
#: l'import.
#:
#: Miroir de ``KNOWN_IMPORT_EXTS`` (``lib/importDetect.ts``), qui fait autorité côté
#: front, et sur-ensemble des extensions de ``ingest._MODE_EXTENSIONS`` : celui-ci ignore
#: les alias ``.tei`` et ``.conll``, que le front accepte. Cette divergence lui préexiste.
IMPORTABLE_EXTS = frozenset({".docx", ".odt", ".txt", ".conllu", ".conll", ".xml", ".tei"})

#: Unités rapatriées par fichier. La déduction n'a besoin que des premières — elle
#: compte les lignes portant un marqueur — tandis que ``units_line`` porte sur le
#: fichier **entier** (cf. :func:`preview_text_units`).
DEFAULT_LIMIT = 50


def _probe_one(
    entry: webdav.RemoteEntry,
    *,
    auth_header: dict,
    max_bytes: Optional[int],
    tmpdir: Path,
    limit: int,
) -> dict:
    """Sonde un fichier. Ne lève jamais : un échec est un statut."""
    ext = Path(entry.name).suffix.lower()
    base = {"source_url": entry.href, "name": entry.name, "ext": ext.lstrip(".")}

    mode = PROBE_MODES.get(ext)
    if mode is None:
        # Aucun téléchargement dans les deux cas — c'est la moitié de l'économie du lot —
        # mais **deux statuts distincts**, parce que la suite n'est pas la même : un
        # format auto-descriptif s'importe (l'écran doit le proposer, simplement sans
        # verdict à afficher), une extension inconnue ne s'importe pas du tout.
        statut = "skipped-no-probe" if ext in IMPORTABLE_EXTS else "skipped-unsupported"
        return {**base, "status": statut, "mode": None}

    if max_bytes is not None and entry.size is not None and entry.size > max_bytes:
        return {**base, "status": "skipped-oversize", "mode": mode, "size": entry.size}

    fd, tmp_name = tempfile.mkstemp(suffix=ext, dir=str(tmpdir))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        webdav.download(entry.href, tmp_path, auth_header=auth_header, max_bytes=max_bytes)
    except webdav.WebdavTooLarge:
        return {**base, "status": "skipped-oversize", "mode": mode, "size": entry.size}
    except webdav.WebdavError as exc:
        return {**base, "status": "error", "mode": mode, "error": str(exc)}

    try:
        units, total, tables, n_line, n_structure = preview_text_units(tmp_path, mode, limit)
    except Exception as exc:  # fichier illisible dans ce mode — jamais fatal pour le lot
        return {**base, "status": "error", "mode": mode, "error": str(exc)}

    # Forme **identique** à la réponse de `/import/preview` : l'écran rejoue dessus le
    # même code de déduction que pour un fichier local, sans branche distante.
    return {
        **base,
        "status": "probed",
        "mode": mode,
        "units": units,
        "units_total": total,
        "units_line": n_line,
        "units_structure": n_structure,
        "truncated": total > limit,
        "tables": tables,
    }


def probe_remote_folder(
    *,
    url: str,
    auth_header: dict,
    only_hrefs: Optional[set[str]] = None,
    include: Optional[str] = None,
    max_file_mb: Optional[float] = 200.0,
    limit: int = DEFAULT_LIMIT,
    logger: Optional[logging.Logger] = None,
    progress: Optional[ProgressCb] = None,
) -> dict:
    """Lit chaque fichier sondable du dossier *url* et rend un rapport par fichier.

    Lève ``webdav.WebdavError`` seulement si le PROPFIND du dossier échoue ; un échec
    **par fichier** est capté dans le rapport et n'interrompt jamais la boucle.

    *only_hrefs* restreint la sonde aux fichiers choisis, **intersectés avec le
    listing PROPFIND** : un href que le serveur n'a pas listé est ignoré et jamais
    téléchargé — c'est la garde anti-SSRF de :func:`webdav.propfind` qu'on ne
    contourne pas. La sélection explicite court-circuite le glob *include*, l'utilisateur
    ayant choisi ces fichiers délibérément.
    """
    max_bytes = int(max_file_mb * 1024 * 1024) if max_file_mb else None

    entries = webdav.propfind(url, auth_header=auth_header)
    files = [e for e in entries if not e.is_dir]
    if only_hrefs is not None:
        files = [e for e in files if e.href in only_hrefs]
    elif include:
        files = [e for e in files if fnmatch.fnmatch(e.name.lower(), include.lower())]
    total = len(files)

    results: list[dict] = []
    tmpdir = Path(tempfile.mkdtemp(prefix="agrafes_probe_"))
    try:
        for index, entry in enumerate(files, start=1):
            res = _probe_one(
                entry, auth_header=auth_header, max_bytes=max_bytes,
                tmpdir=tmpdir, limit=limit,
            )
            results.append(res)
            # Le temporaire du fichier courant est libéré tout de suite : l'occupation
            # disque reste celle d'UN fichier, pas celle du lot (même parti pris que
            # l'ingestion, SID-15). Le rmtree du `finally` reste le filet.
            for leftover in tmpdir.iterdir():
                leftover.unlink(missing_ok=True)
            if logger is not None:
                logger.info("webdav-probe %s -> %s", entry.name, res["status"])
            if progress is not None:
                progress({"index": index, "total": total, "name": entry.name, "status": res["status"]})
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {
        "url": url,
        "total": total,
        "probed": counts.get("probed", 0),
        "skipped_no_probe": counts.get("skipped-no-probe", 0),
        "skipped_unsupported": counts.get("skipped-unsupported", 0),
        "skipped_oversize": counts.get("skipped-oversize", 0),
        "errors": counts.get("error", 0),
        "files": results,
    }
