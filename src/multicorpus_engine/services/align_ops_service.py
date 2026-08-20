"""Archive et annulation des gestes de lot de l'espace Alignement (décision D-3).

Les sept verbes de ``POST /align/links/batch_update`` (``set_status``, ``delete``,
``set_target_span``, ``clear_target_span``, ``set_bead``, ``clear_bead``,
``set_pivot``) ne laissaient aucune trace : ils touchent des liens sans toucher une
seule unité, donc l'historique de préparation — linéaire *par document* — n'a rien à
quoi les rattacher, et ``align_run_purge`` est clé par run. D'où la troisième archive
(migration 037) et ce module.

Deux choses distinguent cette archive des deux précédentes, et une seule est de fond.

De fond : ici, **six verbes sur sept ne détruisent rien**, ils mutent une ligne qui
survit. La restitution ne peut donc pas être l'``INSERT OR IGNORE`` des deux autres
chemins, qui laisserait la mutation en place tout en rapportant « restauré ». Elle est
UPDATE-si-présent / INSERT-si-absent — voir :func:`undo_batch_op`.

De forme : la pile est bornée. Les deux autres archives n'écrivent que sur une
destruction, qui est rare ; celle-ci écrit à chaque geste, « accepter » compris, qui
est le plus fréquent de l'écran. Elle croîtrait donc avec l'usage normal et non avec
les accidents, ce qu'aucune des deux autres ne fait.
"""

from __future__ import annotations

import sqlite3
from typing import Iterable

from multicorpus_engine.action_history import LINK_SNAPSHOT_COLUMNS, utc_now_iso

from .errors import ConflictError, NotFoundError

# Nombre d'opérations conservées. Ce que le bandeau « Annuler » promet est de défaire
# le geste qu'on vient de faire ; au-delà de quelques dizaines, une pile n'est plus une
# corbeille mais un journal, et un journal se conçoit autrement (il se consulte, se
# filtre, se date). 50 tient un après-midi de travail sur la matrice.
ALIGN_OP_KEEP = 50

_COLS = ", ".join(LINK_SNAPSHOT_COLUMNS)
_PLACEHOLDERS = ", ".join("?" * len(LINK_SNAPSHOT_COLUMNS))

# Libellés de repli, quand le client n'en fournit pas. Le front connaît le nom du geste
# et le passe ; ceci sert aux appels directs et aux anciens fronts.
_VERB_LABELS = {
    "set_status": "statut",
    "delete": "suppression",
    "set_target_span": "coupe",
    "clear_target_span": "coupe annulée",
    "set_bead": "regroupement",
    "clear_bead": "dégroupement",
    "set_pivot": "réancrage",
    # retarget déplace la CIBLE, set_pivot déplace le MOYEU : deux gestes symétriques
    # qu'un libellé commun rendrait indistinguables dans le bandeau.
    "retarget": "re-ciblage",
    # Les quatre verbes de /align/collisions/resolve — même famille, même archive :
    # ils touchent des liens sans toucher une unité, et ne laissaient pas de trace
    # non plus (l'audit ne les avait pas comptés parmi les « sept verbes »).
    "keep": "conservation",
    "reject": "rejet",
    "unreviewed": "remise à relire",
}


def collect_links_by_id(conn: sqlite3.Connection, link_ids: Iterable[int]) -> list[tuple]:
    """Lit les liens visés, tels qu'ils sont AVANT le geste. N'écrit rien.

    Les sept verbes écrivent tous ``WHERE link_id = ?`` — aucun n'a d'effet de bord sur
    un lien voisin (vérifié verbe par verbe dans ``align_links_service``). La liste des
    ``link_id`` de la requête est donc exactement la portée du geste, sans élargissement
    ni angle mort.
    """
    ids = sorted({int(i) for i in link_ids})
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    return [
        tuple(r) for r in conn.execute(
            f"SELECT {_COLS} FROM alignment_links WHERE link_id IN ({ph})", ids
        )
    ]


def default_description(action_types: Iterable[str], links_count: int) -> str:
    """Libellé de repli : la nature du geste si elle est homogène, son ampleur sinon."""
    kinds = {t for t in action_types if t in _VERB_LABELS}
    lien = "lien" if links_count == 1 else "liens"
    if len(kinds) == 1:
        return f"{_VERB_LABELS[next(iter(kinds))]} — {links_count} {lien}"
    return f"geste composé — {links_count} {lien}"


def _op_exists(conn: sqlite3.Connection, op_id: object) -> int | None:
    if not isinstance(op_id, int):
        return None
    row = conn.execute("SELECT op_id FROM align_op WHERE op_id = ?", (op_id,)).fetchone()
    return int(row[0]) if row else None


def _refresh_op(conn: sqlite3.Connection, op_id: int, label: str | None) -> None:
    """Remet à jour le compte, et le libellé si l'appelant en fournit un.

    Un geste multi-requêtes se nomme mieux à sa fin qu'à son début : le dernier appel
    qui passe un ``label`` explicite l'emporte. Sans libellé, on ne touche pas à la
    description — recalculer le repli à chaque jointure ferait dire « suppression » à
    un geste dont la première moitié était une création.
    """
    n = conn.execute(
        "SELECT COUNT(*) FROM align_op_link_snapshots WHERE op_id = ?", (op_id,)
    ).fetchone()[0]
    explicite = (label or "").strip()
    if explicite:
        conn.execute(
            "UPDATE align_op SET links_count = ?, description = ? WHERE op_id = ?",
            (n, explicite[:200], op_id),
        )
    else:
        conn.execute("UPDATE align_op SET links_count = ? WHERE op_id = ?", (n, op_id))


def archive_batch_op(
    conn: sqlite3.Connection,
    link_ids: Iterable[int],
    *,
    op_id: int | None = None,
    label: str | None = None,
    action_types: Iterable[str] = (),
    kind: str = "batch_update",
) -> int | None:
    """Archive l'état des liens visés. Ouvre une opération, ou rejoint ``op_id``.

    À appeler **avant** d'appliquer le lot, dans la transaction de l'appelant : c'est
    tout le contrat. Renvoie l'``op_id``, ou ``None`` si rien n'a pu être archivé (un
    lot entièrement en erreur n'ouvre pas d'opération vide).

    ``op_id`` permet à un geste multi-requêtes de tenir en **une seule** opération — la
    coupe à cheval et le rattachement au voisin appellent `create` puis `batch_update`,
    et n'en défaire que la moitié laisserait le doublon d'ALI-22. Un ``op_id`` inconnu
    (sorti de la pile, base rouverte) n'est pas une erreur : on ouvre une opération
    neuve. Un geste ne doit jamais échouer à cause de sa propre comptabilité d'annulation.

    Le libellé de repli se calcule **après** la lecture, sur le nombre de liens
    réellement archivés : un lot qui vise quatre liens dont un a disparu doit annoncer
    trois, sinon le bandeau promet plus qu'il ne peut rendre.
    """
    rows = collect_links_by_id(conn, link_ids)
    rejoint = _op_exists(conn, op_id)
    if not rows and rejoint is None:
        return None
    if rejoint is None:
        description = (label or "").strip() or default_description(action_types, len(rows))
        cur = conn.execute(
            "INSERT INTO align_op (kind, performed_at, description, links_count)"
            " VALUES (?, ?, ?, ?)",
            (kind, utc_now_iso(), description[:200], len(rows)),
        )
        rejoint = int(cur.lastrowid)
        _prune(conn)
    _snapshot(conn, rejoint, rows, existed=1)
    _refresh_op(conn, rejoint, label)
    return rejoint


def record_created_link(
    conn: sqlite3.Connection,
    link_id: int,
    *,
    op_id: int | None = None,
    label: str | None = None,
    kind: str = "link_create",
) -> int:
    """Note qu'une opération a **créé** ``link_id`` : la défaire, c'est le supprimer.

    À appeler **après** l'insertion (les colonnes archivées sont celles du lien neuf ;
    seul ``existed = 0`` compte pour l'annulation, mais les remplir évite de relâcher
    les ``NOT NULL`` pour un cas qui ne s'en sert pas).
    """
    rows = collect_links_by_id(conn, [link_id])
    rejoint = _op_exists(conn, op_id)
    if rejoint is None:
        description = (label or "").strip() or "rattachement — 1 lien"
        cur = conn.execute(
            "INSERT INTO align_op (kind, performed_at, description, links_count)"
            " VALUES (?, ?, ?, ?)",
            (kind, utc_now_iso(), description[:200], len(rows)),
        )
        rejoint = int(cur.lastrowid)
        _prune(conn)
    _snapshot(conn, rejoint, rows, existed=0)
    _refresh_op(conn, rejoint, label)
    return rejoint


def _snapshot(
    conn: sqlite3.Connection, op_id: int, rows: list[tuple], *, existed: int
) -> None:
    """Écrit les instantanés. ``INSERT OR IGNORE`` : le PREMIER gagne.

    C'est volontaire et c'est le cœur de la jointure d'opération — si deux requêtes du
    même geste touchent le même lien, l'instantané qui vaut est celui pris avant la
    première, pas l'état intermédiaire vu par la seconde.
    """
    if not rows:
        return
    conn.executemany(
        f"INSERT OR IGNORE INTO align_op_link_snapshots (op_id, {_COLS}, existed)"
        f" VALUES (?, {_PLACEHOLDERS}, ?)",
        [(op_id, *r, existed) for r in rows],
    )


def discard_batch_op(
    conn: sqlite3.Connection, op_id: int | None, *, joined: object = None
) -> None:
    """Referme une opération qui n'a finalement rien changé (lot en erreur, ou vide).

    Une opération sans effet proposerait un « Annuler » qui ne défait rien : le bandeau
    mentirait, et la pile bornée perdrait une place pour un geste qui n'a pas eu lieu.

    ``joined`` est l'``op_id`` que l'appelant avait REÇU. S'il est celui qu'on s'apprête
    à refermer, c'est qu'on a rejoint l'opération de quelqu'un d'autre : on n'y touche
    pas. Refermer une opération rejointe emporterait la première moitié du geste — la
    création — ce qui est bien pire que le « Annuler » vide qu'on voulait éviter.
    """
    if op_id is None or (isinstance(joined, int) and joined == int(op_id)):
        return
    conn.execute("DELETE FROM align_op WHERE op_id = ?", (int(op_id),))


def _prune(conn: sqlite3.Connection) -> None:
    """Ne garde que les ``ALIGN_OP_KEEP`` opérations les plus récentes (CASCADE)."""
    conn.execute(
        "DELETE FROM align_op WHERE op_id NOT IN ("
        "  SELECT op_id FROM align_op ORDER BY op_id DESC LIMIT ?"
        ")",
        (ALIGN_OP_KEEP,),
    )


def undo_batch_op(conn: sqlite3.Connection, op_id: int) -> dict[str, object]:
    """Remet les liens de ``op_id`` dans l'état archivé, puis consomme l'opération.

    Ne commite pas — l'adaptateur détient le verrou d'écriture.

    Deux refus, tous deux explicites plutôt que silencieux :

    * l'opération n'existe pas — déjà annulée, ou sortie de la pile bornée ;
    * une opération **plus récente** a touché l'un de ces liens. L'annuler écraserait ce
      geste-là sans le dire. C'est la même discipline qu'ALI-03 : on ne défait pas par
      surprise une décision humaine postérieure.

    Le compte renvoyé sépare ``updated`` (le lien avait survécu au geste, on lui rend ses
    colonnes), ``reinserted`` (le verbe ``delete`` l'avait détruit, on le remet avec son
    ``link_id`` d'origine — AUTOINCREMENT ne recycle pas un rowid libéré, donc la
    restitution est identique et non approchée) et ``deleted`` (l'opération l'avait
    **créé** : le défaire, c'est le supprimer). ``skipped`` compte ce qui n'a pas pu
    revenir : une unité disparue depuis, ou la paire ``(pivot, target)`` réoccupée par un
    lien plus jeune que l'on préfère laisser vivre.
    """
    op = conn.execute(
        "SELECT op_id, kind, performed_at, description, links_count"
        " FROM align_op WHERE op_id = ?",
        (int(op_id),),
    ).fetchone()
    if op is None:
        raise NotFoundError(
            f"opération {op_id} introuvable — déjà annulée, ou sortie de la pile"
            f" (les {ALIGN_OP_KEEP} derniers gestes sont conservés)"
        )

    later = conn.execute(
        "SELECT COUNT(DISTINCT s2.op_id) FROM align_op_link_snapshots s1"
        " JOIN align_op_link_snapshots s2"
        "   ON s2.link_id = s1.link_id AND s2.op_id > s1.op_id"
        " WHERE s1.op_id = ?",
        (int(op_id),),
    ).fetchone()[0]
    if later:
        raise ConflictError(
            f"{later} geste(s) plus récent(s) portent sur ces mêmes liens :"
            " les annuler d'abord, sinon cette annulation les écraserait sans le dire"
        )

    rows = conn.execute(
        f"SELECT {_COLS}, existed FROM align_op_link_snapshots WHERE op_id = ?",
        (int(op_id),),
    ).fetchall()

    updated = reinserted = deleted = skipped = 0

    # PREMIÈRE PASSE — supprimer ce que l'opération avait créé.
    # L'ordre n'est pas cosmétique. La paire (pivot_unit_id, target_unit_id) est unique
    # depuis la migration 008 : si l'on restituait d'abord, un lien à rendre pourrait
    # buter sur une paire encore occupée par une création de la MÊME opération, et se
    # retrouver compté en « skipped » alors que la place allait se libérer une ligne
    # plus bas. C'est la même leçon que l'ordre d'annulation d'une famille (§12.5).
    for row in rows:
        if row[-1]:
            continue
        cur = conn.execute("DELETE FROM alignment_links WHERE link_id = ?", (row[0],))
        deleted += cur.rowcount

    # SECONDE PASSE — rendre aux liens préexistants l'état qu'ils avaient.
    assignments = ", ".join(f"{c} = ?" for c in LINK_SNAPSHOT_COLUMNS[1:])
    for row in rows:
        if not row[-1]:
            continue
        values = tuple(row)[:-1]
        link_id = values[0]
        exists = conn.execute(
            "SELECT 1 FROM alignment_links WHERE link_id = ?", (link_id,)
        ).fetchone()
        try:
            if exists:
                conn.execute(
                    f"UPDATE alignment_links SET {assignments} WHERE link_id = ?",
                    (*values[1:], link_id),
                )
                updated += 1
            else:
                conn.execute(
                    f"INSERT INTO alignment_links ({_COLS}) VALUES ({_PLACEHOLDERS})",
                    values,
                )
                reinserted += 1
        except sqlite3.IntegrityError:
            # ABORT au niveau de l'instruction : SQLite défait CETTE instruction et
            # laisse la transaction vivante. Un lien qui ne peut pas revenir ne fait
            # donc pas échouer les autres — il est compté, jamais avalé.
            skipped += 1

    conn.execute("DELETE FROM align_op WHERE op_id = ?", (int(op_id),))
    return {
        "op_id": int(op_id),
        "description": op[3],
        "updated": updated,
        "reinserted": reinserted,
        "deleted": deleted,
        "skipped": skipped,
    }
