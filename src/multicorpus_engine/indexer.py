"""FTS5 index management.

Builds or rebuilds the fts_units FTS5 index from the units table.
Only unit_type='line' units are indexed (structure units excluded).

fts_units is a regular (non-content) FTS5 table. Its rowid equals unit_id,
enabling efficient JOINs back to units and documents.

See docs/DECISIONS.md ADR-005.
"""

from __future__ import annotations

import logging
import sqlite3

logger = logging.getLogger(__name__)

_FTS5_CREATE_SQL = """CREATE VIRTUAL TABLE fts_units USING fts5(
    text_norm,
    tokenize='unicode61'
)"""


def _is_fts_error(e: BaseException) -> bool:
    """True if the exception suggests fts_units is missing or broken (recreate will help)."""
    msg = str(e).lower()
    return (
        "no such table" in msg
        or "vtable" in msg
        or "fts_units" in msg
        or "constructor failed" in msg
    )


# FTS5 shadow tables (real tables); dropping them first can allow DROP of corrupted fts_units
_FTS5_SHADOW_SUFFIXES = ("_data", "_idx", "_content", "_docsize", "_config")


def _recreate_fts_table(conn: sqlite3.Connection) -> None:
    """Drop and recreate fts_units. If DROP fails (e.g. corrupted vtable), drop shadow tables then retry."""
    try:
        conn.execute("DROP TABLE IF EXISTS fts_units")
        conn.commit()
    except sqlite3.Error as e:
        if not _is_fts_error(e):
            raise
        logger.warning("DROP fts_units failed (%s), dropping FTS5 shadow tables", e)
        for suffix in _FTS5_SHADOW_SUFFIXES:
            try:
                conn.execute(f"DROP TABLE IF EXISTS fts_units{suffix}")
            except sqlite3.Error:
                pass
        conn.commit()
        try:
            conn.execute("DROP TABLE IF EXISTS fts_units")
            conn.commit()
        except sqlite3.Error as e2:
            if _is_fts_error(e2):
                logger.warning("DROP fts_units still failed after shadow drop (%s), removing from sqlite_master", e2)
                conn.execute("PRAGMA writable_schema = 1")
                try:
                    conn.execute("DELETE FROM sqlite_master WHERE type = 'table' AND name = 'fts_units'")
                    conn.commit()
                    cur = conn.execute("PRAGMA schema_version").fetchone()
                    if cur:
                        conn.execute(f"PRAGMA schema_version = {cur[0] + 1}")
                finally:
                    conn.execute("PRAGMA writable_schema = 0")
            else:
                raise

    # `DROP TABLE IF EXISTS fts_units` ci-dessus ne fait **rien** quand la déclaration a
    # déjà quitté le schéma — or les cinq tables d'ombre, elles, sont toujours là. Le
    # CREATE qui suit échouait donc sur « fts5: error creating shadow table fts_units_data:
    # table 'fts_units_data' already exists », et la réindexation était **incapable de
    # réparer** la panne présente sur trois des quatre instantanés abîmés (FTS-01). La
    # branche qui nettoie les ombres n'était atteinte que lorsque le DROP *échoue*, ce qui
    # n'arrive jamais dans ce cas-là. Mesuré le 31 août sur une copie de
    # `…PRE-FTS-REPAIR.db` : ce seul geste suffit — 46 674 lignes réindexées,
    # `integrity_check` à `ok`, la recherche répond.
    #
    # Sans déclaration, les ombres ne sont plus lisibles par personne : ce sont des
    # orphelines, et l'index se refabrique intégralement depuis `units.text_norm`.
    orpheline = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE name = 'fts_units'"
    ).fetchone()[0] == 0
    if orpheline:
        logger.warning("fts_units declaration missing; dropping %d orphan shadow tables",
                       len(_FTS5_SHADOW_SUFFIXES))
        for suffix in _FTS5_SHADOW_SUFFIXES:
            try:
                conn.execute(f"DROP TABLE IF EXISTS fts_units{suffix}")
            except sqlite3.Error:
                pass
        conn.commit()

    conn.execute(_FTS5_CREATE_SQL)
    conn.commit()
    logger.info("Recreated fts_units virtual table")


def build_index(conn: sqlite3.Connection) -> int:
    """Rebuild the FTS5 index from scratch.

    Clears all FTS rows and repopulates from line units.
    fts_units is a regular FTS5 table so DELETE FROM is supported.
    On "vtable constructor failed" (e.g. corrupted FTS data), recreates the table then repopulates.
    Returns the count of units indexed.
    """
    logger.info("Rebuilding FTS5 index...")

    try:
        conn.execute("DELETE FROM fts_units")
    except sqlite3.Error as e:
        if _is_fts_error(e):
            logger.warning("FTS table unusable (%s), recreating fts_units", e)
            _recreate_fts_table(conn)
        else:
            raise

    try:
        conn.execute(
            """
            INSERT INTO fts_units(rowid, text_norm)
            SELECT unit_id, text_norm
            FROM units
            WHERE unit_type = 'line'
            """
        )
    except sqlite3.Error as e:
        if _is_fts_error(e):
            logger.warning("FTS insert failed (%s), recreating fts_units and retrying", e)
            _recreate_fts_table(conn)
            conn.execute(
                """
                INSERT INTO fts_units(rowid, text_norm)
                SELECT unit_id, text_norm
                FROM units
                WHERE unit_type = 'line'
                """
            )
        else:
            raise

    conn.commit()

    count = conn.execute(
        "SELECT COUNT(*) FROM units WHERE unit_type = 'line'"
    ).fetchone()[0]

    logger.info("FTS5 index rebuilt: %d units indexed", count)
    return count


def _changes(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT changes()").fetchone()[0])


def update_index(
    conn: sqlite3.Connection,
    *,
    prune_deleted: bool = True,
) -> dict[str, int]:
    """Incrementally synchronize ``fts_units`` with ``units``.

    This mode is explicit and optimized for corpora where a full rebuild is
    expensive. It applies three steps:
    1. optional prune of stale FTS rows (units deleted / no longer ``line``),
    2. refresh rows whose ``text_norm`` changed,
    3. insert missing ``line`` rows.

    Returns counters suitable for run logs and API payloads:
      - units_indexed: total ``line`` units after sync,
      - inserted: newly indexed rows,
      - refreshed: rows reindexed due to ``text_norm`` changes,
      - deleted: stale rows removed from FTS.
    """
    logger.info("Running incremental FTS5 sync (prune_deleted=%s)...", prune_deleted)

    try:
        conn.execute("SELECT rowid FROM fts_units LIMIT 1").fetchall()
    except sqlite3.Error as e:
        if _is_fts_error(e):
            logger.warning("FTS table unusable (%s), recreating fts_units", e)
            _recreate_fts_table(conn)
        else:
            raise

    deleted = 0
    if prune_deleted:
        conn.execute(
            """
            DELETE FROM fts_units
            WHERE rowid IN (
                SELECT f.rowid
                FROM fts_units f
                LEFT JOIN units u ON u.unit_id = f.rowid
                WHERE u.unit_id IS NULL OR u.unit_type <> 'line'
            )
            """
        )
        deleted = _changes(conn)

    # Refresh changed rows by deleting stale FTS rows first.
    conn.execute(
        """
        DELETE FROM fts_units
        WHERE rowid IN (
            SELECT u.unit_id
            FROM units u
            JOIN fts_units f ON f.rowid = u.unit_id
            WHERE u.unit_type = 'line'
              AND f.text_norm <> u.text_norm
        )
        """
    )
    refreshed = _changes(conn)

    # Insert missing rows (new units + refreshed rows removed above).
    conn.execute(
        """
        INSERT INTO fts_units(rowid, text_norm)
        SELECT u.unit_id, u.text_norm
        FROM units u
        LEFT JOIN fts_units f ON f.rowid = u.unit_id
        WHERE u.unit_type = 'line'
          AND f.rowid IS NULL
        """
    )
    inserted_total = _changes(conn)
    inserted = max(0, inserted_total - refreshed)

    conn.commit()

    units_indexed = int(
        conn.execute(
            "SELECT COUNT(*) FROM units WHERE unit_type = 'line'"
        ).fetchone()[0]
    )

    stats = {
        "units_indexed": units_indexed,
        "inserted": inserted,
        "refreshed": refreshed,
        "deleted": deleted,
    }
    logger.info("Incremental FTS sync complete: %s", stats)
    return stats


def classify_index_failure(conn: sqlite3.Connection, exc: sqlite3.Error) -> str:
    """Name the FTS failure: ``declaration-missing`` or ``corrupted``.

    The two documented failures need telling apart because **only one of them is
    repairable from inside the app** (FTS-01): with the declaration gone,
    :func:`build_index` recreates the table and refills it from ``units``; with
    corrupted pages, every SQL route measured on 25 August dies on the damaged
    tree, and the file must be rebuilt offline.

    The question is asked of the **schema**, not of the exception type. Sniffing
    ``isinstance(exc, OperationalError)`` looks equivalent and is not: a locked
    database raises ``OperationalError`` too, and would be declared repairable —
    the app would then offer a repair button for a transient lock.
    """
    try:
        declared = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'fts_units'"
        ).fetchone()[0]
    except sqlite3.Error:
        # Le schéma lui-même est illisible : on ne promet aucune réparation.
        return "corrupted"
    return "corrupted" if declared else "declaration-missing"


def index_failure(conn: sqlite3.Connection) -> str | None:
    """``None`` when the FTS index reads; otherwise the failure's name.

    Single probe, so callers that need both *readable* and *repairable* pay one
    scan rather than two — see :func:`index_readable` for why the scan is a
    ``COUNT(*)`` and not a cheaper peek.
    """
    try:
        conn.execute("SELECT COUNT(*) FROM fts_units").fetchone()
        return None
    except sqlite3.Error as exc:
        failure = classify_index_failure(conn, exc)
        logger.warning("index_failure: FTS index unusable (%s) — %s", exc, failure)
        return failure


def index_readable(conn: sqlite3.Connection) -> bool:
    """Can the FTS index be read at all?

    Distinguishes *nothing to reindex* from *cannot tell* — a distinction the
    product got wrong in the only place it mattered. :func:`stale_doc_ids`
    swallows ``sqlite3.Error`` and returns an empty set, so a **broken** index
    was indistinguishable from a **fresh** one, and the screen answered the
    user's question with a green "✓ Index à jour".

    Measured on the corpus snapshots kept from the 25 August incident: both
    documented failure modes returned zero stale documents — pages corrupted
    (``database disk image is malformed``) and declaration removed while the
    five shadow tables survive (``no such table: fts_units``). See FTS-01.

    **The probe must scan the whole index, not peek at one row.** An earlier
    version used ``SELECT rowid FROM fts_units LIMIT 1`` on the assumption that
    "both failures raise on the first read". Measured on the snapshots, that is
    false for the corruption that actually cost the 25 August incident: the bad
    page is deep in the file (tree 12, page 55999), so the first row comes back
    fine and the probe answered *readable* on the very database whose symptom
    was "internal error" everywhere. ``COUNT(*)`` reaches it, and catches both:

    ==========================  =========  ==========
    snapshot                    ``LIMIT 1``  ``COUNT(*)``
    ==========================  =========  ==========
    PRE-REBUILD (pages corrupt)  ok (2 ms)  raises
    PRE-FTS-REPAIR (no decl.)    raises     raises
    WORKCOPY (healthy, 47908)    ok (2 ms)  ok (14 ms)
    ==========================  =========  ==========

    The 14 ms is the price, on a 48k-unit corpus, and it grows with the index;
    it sits next to a :func:`stale_doc_ids` call measured at 80 ms in the same
    request. Note that ``PRAGMA quick_check`` is *not* an alternative: it says
    ``ok`` on three of the four broken snapshots (the declaration-removed ones).
    """
    return index_failure(conn) is None


def stale_doc_ids(conn: sqlite3.Connection) -> set[int]:
    """Return the set of doc_ids whose FTS index is stale.

    A document is stale when at least one of its ``line`` units is either
    absent from ``fts_units`` or has a ``text_norm`` that diverges from the
    indexed value — the exact criterion ``update_index`` uses to decide what
    to (re)index. Derived live from ``units`` ↔ ``fts_units`` ; no persisted
    flag, so it cannot drift out of sync with reality.

    A document with zero line units is never reported stale (nothing to
    index). Orphan ``fts_units`` rows (units deleted) are a global cleanup
    concern handled by ``update_index``'s prune step, not a per-doc signal.
    """
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT u.doc_id
            FROM units u
            LEFT JOIN fts_units f ON f.rowid = u.unit_id
            WHERE u.unit_type = 'line'
              AND (f.rowid IS NULL OR f.text_norm <> u.text_norm)
            """
        ).fetchall()
    except sqlite3.Error as exc:
        # fts_units missing/unusable → treat everything as "not stale" rather
        # than crash the documents list. A reindex recreates the table.
        logger.warning("stale_doc_ids: FTS query failed (%s)", exc)
        return set()
    return {int(r[0]) for r in rows}
