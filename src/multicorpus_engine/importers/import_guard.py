"""Guard against importing the same file twice (same path or same content hash)."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DuplicateImportMatch:
    """Metadata describing why an import was considered duplicate."""

    doc_id: int
    reason: str
    matched_value: str | None = None


def column_scoped_source_hash(file_hash: str, column_index: int | None) -> str:
    """L'identité d'un document extrait par colonne, c'est ``(fichier, colonne)``.

    Un bitexte en tableau est **un** fichier qui doit produire **deux** documents.
    Tant que le ``source_hash`` était celui du fichier entier, la seconde colonne
    était refusée comme doublon de la première (IMPO-01) — défaut partagé par les
    deux modes DOCX, et invisible en test parce que les deux cas de colonne
    utilisaient chacun une base neuve.

    Sans colonne, le hash est rendu inchangé : la mesure du 27 août 2026 sur la
    base de travail (1141 runs d'import, **0** avec un ``column_index``) garantit
    qu'aucun document existant ne voit son identité bouger.
    """
    return file_hash if column_index is None else f"{file_hash}:col{column_index}"


def normalize_import_path_str(s: str) -> str:
    """Align with Prep UI `normalizeImportPath`: separators, case, trailing slash.

    Also strips Windows long-path prefix ``\\\\?\\`` so ``\\\\?\\C:\\a.doc`` and
    ``C:\\a.doc`` compare equal.
    """
    x = s.replace("\\", "/").strip().rstrip("/").lower()
    if x.startswith("//?/"):
        x = x[4:]
    return x


def _path_raw_variants(path: Path) -> set[str]:
    """Exact strings the importer may have stored as ``source_path``."""
    raw: set[str] = {str(path)}
    try:
        raw.add(str(path.resolve()))
    except (OSError, RuntimeError):
        pass
    return raw


def find_duplicate_import_match(
    conn: sqlite3.Connection,
    path: Path,
    source_hash: str,
    check_filename: bool = False,
    column_index: int | None = None,
) -> DuplicateImportMatch | None:
    """Return duplicate match metadata if this file is already in the corpus.

    Avec un ``column_index``, seul le hash — déjà porté à la colonne par
    :func:`column_scoped_source_hash` — décide : les contrôles par **chemin** et par
    **nom de fichier** sont écartés, puisque le fichier est légitimement importé une
    fois par colonne et que son chemin est le même des deux côtés. Réimporter la
    *même* colonne reste refusé, le hash portant la colonne.
    """
    if not source_hash:
        return None
    row = conn.execute(
        "SELECT doc_id FROM documents WHERE source_hash = ? LIMIT 1",
        (source_hash,),
    ).fetchone()
    if row:
        return DuplicateImportMatch(
            doc_id=int(row[0]),
            reason="source_hash",
            matched_value=source_hash[:12],
        )

    if column_index is not None:
        return None

    raw_paths = _path_raw_variants(path)
    placeholders = ",".join("?" * len(raw_paths))
    sql = f"SELECT doc_id, source_path FROM documents WHERE source_path IN ({placeholders}) LIMIT 1"
    row = conn.execute(sql, tuple(raw_paths)).fetchone()
    if row:
        return DuplicateImportMatch(
            doc_id=int(row[0]),
            reason="source_path_exact",
            matched_value=str(row[1] or ""),
        )

    candidates = {normalize_import_path_str(p) for p in raw_paths}
    for doc_id, stored in conn.execute(
        "SELECT doc_id, source_path FROM documents WHERE source_path IS NOT NULL"
    ):
        if stored and normalize_import_path_str(stored) in candidates:
            return DuplicateImportMatch(
                doc_id=int(doc_id),
                reason="source_path_normalized",
                matched_value=str(stored),
            )

    if check_filename:
        target_name = path.name.lower()
        for doc_id, stored in conn.execute(
            "SELECT doc_id, source_path FROM documents WHERE source_path IS NOT NULL"
        ):
            if stored and Path(stored).name.lower() == target_name:
                return DuplicateImportMatch(
                    doc_id=int(doc_id),
                    reason="filename",
                    matched_value=target_name,
                )

    return None


def find_duplicate_doc_id(
    conn: sqlite3.Connection,
    path: Path,
    source_hash: str,
    check_filename: bool = False,
    column_index: int | None = None,
) -> int | None:
    """Return an existing doc_id if this file is already in the corpus."""
    match = find_duplicate_import_match(
        conn,
        path,
        source_hash,
        check_filename=check_filename,
        column_index=column_index,
    )
    return match.doc_id if match is not None else None


def assert_not_duplicate_import(
    conn: sqlite3.Connection,
    path: Path,
    source_hash: str,
    check_filename: bool = False,
    column_index: int | None = None,
) -> None:
    """Raise ValueError if the file is already imported."""
    match = find_duplicate_import_match(
        conn,
        path,
        source_hash,
        check_filename=check_filename,
        column_index=column_index,
    )
    if match is None:
        return

    extra = ""
    if match.reason == "source_hash" and match.matched_value:
        extra = f", hash_prefix={match.matched_value}"
    elif match.reason.startswith("source_path") and match.matched_value:
        extra = f", source_path={match.matched_value}"
    elif match.reason == "filename" and match.matched_value:
        extra = f", filename={match.matched_value}"

    raise ValueError(
        f"Fichier déjà présent dans le corpus (doc_id={match.doc_id}, reason={match.reason}{extra})."
    )

