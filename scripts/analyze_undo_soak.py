#!/usr/bin/env python3
"""Mode A undo soak — agrégation locale du NDJSON télémétrie.

Lit `<db_dir>/.agrafes_telemetry.ndjson`, agrège les 3 events liés à l'undo
sur la fenêtre demandée, sort un rapport texte avec une recommandation
calculée selon des seuils figés en tête de fichier.

Stdlib only. Conçu pour être lancé à la main par l'utilisateur au moment
où le soak arrive à terme. Voir docs/SOAK_MODE_A.md pour le protocole.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ─── Seuils de recommandation (modifiables ici) ────────────────────────────

# Mode A est considéré « utilisé » si on dépasse ces deux seuils ensemble :
THRESHOLD_USED_CLICKS    = 5    # nombre de stage_returned (undo) sur la fenêtre
THRESHOLD_USED_ELIGIBLE  = 20   # nombre de prep_undo_eligible_view sur la fenêtre

# Mode A est considéré « peu utilisé » sous ces deux conditions ensemble :
THRESHOLD_LOW_CLICKS     = 2    # < 2 clics
THRESHOLD_LOW_DAYS       = 14   # ≥ 14 jours de soak

# Frustration apparente : besoin frustré dépasse besoin servi.
THRESHOLD_FRUSTRATION_MIN_UNAVAIL = 5  # déclenche seulement si > 5 unavailable_views

# Date de livraison Mode A — borne min pour --since.
MODE_A_RELEASE_DATE = "2026-04-30"

NDJSON_FILENAME = ".agrafes_telemetry.ndjson"
EVENT_ELIGIBLE  = "prep_undo_eligible_view"
EVENT_UNAVAIL   = "prep_undo_unavailable_view"
EVENT_RETURNED  = "stage_returned"


def parse_args(argv: list[str]) -> argparse.Namespace:
    today = datetime.now(timezone.utc).date()
    default_since = today - timedelta(days=14)

    p = argparse.ArgumentParser(
        description="Aggregate Mode A undo telemetry from local NDJSON.",
    )
    p.add_argument(
        "--db-dir",
        type=Path,
        required=True,
        help="Directory containing .agrafes_telemetry.ndjson (next to the SQLite DB).",
    )
    p.add_argument(
        "--since",
        type=str,
        default=default_since.isoformat(),
        help=f"Inclusive start date (YYYY-MM-DD). Default: 14 days ago. "
             f"Bornée à {MODE_A_RELEASE_DATE} (date de livraison Mode A).",
    )
    p.add_argument(
        "--until",
        type=str,
        default=today.isoformat(),
        help="Inclusive end date (YYYY-MM-DD). Default: today.",
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="Dump each matched event line to stdout before the summary.",
    )
    return p.parse_args(argv)


def _parse_date(s: str) -> datetime:
    """Parse YYYY-MM-DD into UTC datetime at start of day."""
    d = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return d


def _ts_in_window(ts_str: str, start: datetime, end_exclusive: datetime) -> bool:
    """Compare an event's `ts` field (ISO8601 UTC) to the window."""
    try:
        # The telemetry writes ts like "2026-04-29T12:34:56.789Z".
        # fromisoformat accepts "+00:00" but not "Z" before py3.11. Replace.
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    return start <= ts < end_exclusive


def _is_undo_returned(event: dict) -> bool:
    """A stage_returned event counts as an undo iff from_stage == 'undo'."""
    return (
        event.get("event") == EVENT_RETURNED
        and event.get("from_stage") == "undo"
    )


def aggregate(
    ndjson_path: Path,
    since: datetime,
    until_exclusive: datetime,
    verbose: bool,
) -> dict:
    """Stream the NDJSON, return aggregated counts.

    Returns a dict with:
      total_lines, malformed_lines, in_window_events,
      eligible_count, unavailable_count, undo_click_count,
      eligible_by_screen, unavailable_by_reason,
      undo_by_action_type
    """
    eligible_count = 0
    unavailable_count = 0
    undo_click_count = 0
    eligible_by_screen: Counter[str] = Counter()
    unavailable_by_reason: Counter[str] = Counter()
    undo_by_action_type: Counter[str] = Counter()
    total_lines = 0
    malformed_lines = 0
    in_window_events = 0

    with open(ndjson_path, "r", encoding="utf-8") as f:
        for line in f:
            total_lines += 1
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                malformed_lines += 1
                continue
            ts_str = ev.get("ts", "")
            if not _ts_in_window(ts_str, since, until_exclusive):
                continue
            in_window_events += 1
            name = ev.get("event")
            if name == EVENT_ELIGIBLE:
                eligible_count += 1
                eligible_by_screen[ev.get("screen", "unknown")] += 1
                if verbose:
                    print(f"  [eligible_view] {ts_str} {ev}")
            elif name == EVENT_UNAVAIL:
                unavailable_count += 1
                unavailable_by_reason[ev.get("reason", "unknown")] += 1
                if verbose:
                    print(f"  [unavail_view]  {ts_str} {ev}")
            elif _is_undo_returned(ev):
                undo_click_count += 1
                # to_stage carries the action_type that was undone.
                undo_by_action_type[ev.get("to_stage", "unknown")] += 1
                if verbose:
                    print(f"  [undo click]    {ts_str} {ev}")

    return {
        "total_lines":           total_lines,
        "malformed_lines":       malformed_lines,
        "in_window_events":      in_window_events,
        "eligible_count":        eligible_count,
        "unavailable_count":     unavailable_count,
        "undo_click_count":      undo_click_count,
        "eligible_by_screen":    dict(eligible_by_screen),
        "unavailable_by_reason": dict(unavailable_by_reason),
        "undo_by_action_type":   dict(undo_by_action_type),
    }


def recommend(stats: dict, soak_days: int) -> str:
    """Compute the recommendation string from aggregated stats + soak length."""
    clicks  = stats["undo_click_count"]
    elig    = stats["eligible_count"]
    unavail = stats["unavailable_count"]

    if (
        unavail > THRESHOLD_FRUSTRATION_MIN_UNAVAIL
        and unavail > clicks
    ):
        return (
            "FRUSTRATION DÉTECTÉE — examiner les reasons dominantes "
            "(no_action est neutre ; structural_dependency / unit_diverged "
            "indiquent un besoin frustré qui justifie d'élargir le périmètre)."
        )

    if clicks >= THRESHOLD_USED_CLICKS and elig >= THRESHOLD_USED_ELIGIBLE:
        return (
            "Mode A est utilisé. Envisager Mode B si une demande explicite "
            "de rollback historique apparaît, sinon continuer à observer."
        )

    if clicks < THRESHOLD_LOW_CLICKS and soak_days >= THRESHOLD_LOW_DAYS:
        return (
            "Mode A peu utilisé sur la fenêtre. Mode B probablement prématuré ; "
            "attendre un signal explicite (demande utilisateur, friction réelle) "
            "avant d'investir."
        )

    return (
        "Signal ambigu sur cette fenêtre. Prolonger le soak d'une semaine "
        "et relancer le rapport, OU décider sur intuition + cas vécus si "
        "l'attente n'apporte plus."
    )


def render_report(
    ndjson_path: Path,
    since: datetime,
    until_inclusive: datetime,
    soak_days: int,
    stats: dict,
) -> str:
    lines: list[str] = []
    lines.append("=== Mode A soak report ===")
    lines.append(
        f"Période : {since.date().isoformat()} → "
        f"{until_inclusive.date().isoformat()} ({soak_days} jours)"
    )
    lines.append(
        f"NDJSON  : {ndjson_path} ({stats['total_lines']} lignes, "
        f"{stats['malformed_lines']} malformées ignorées, "
        f"{stats['in_window_events']} events dans la fenêtre)"
    )
    lines.append("")
    lines.append("— Événements undo —")
    lines.append(
        f"prep_undo_eligible_view    : {stats['eligible_count']} occurrences"
        + (
            f" (par screen : {_fmt_breakdown(stats['eligible_by_screen'])})"
            if stats["eligible_by_screen"] else ""
        )
    )
    lines.append(
        f"prep_undo_unavailable_view : {stats['unavailable_count']} occurrences"
        + (
            f" (par reason : {_fmt_breakdown(stats['unavailable_by_reason'])})"
            if stats["unavailable_by_reason"] else ""
        )
    )
    lines.append(
        f"stage_returned (undo)      : {stats['undo_click_count']} occurrences"
        + (
            f" (par action_type : {_fmt_breakdown(stats['undo_by_action_type'])})"
            if stats["undo_by_action_type"] else ""
        )
    )
    lines.append("")
    lines.append("— Distribution undo / éligibilité —")
    if stats["eligible_count"] > 0:
        ratio = 100.0 * stats["undo_click_count"] / stats["eligible_count"]
        lines.append(
            f"Ratio click / eligible_view : {ratio:.1f}% "
            f"(stage_returned ÷ eligible_view, indicateur « voulu / disponible »)"
        )
    else:
        lines.append(
            "Ratio click / eligible_view : N/A (aucune éligibilité observée)"
        )
    lines.append(
        f"Frustration apparente       : {stats['unavailable_count']} events "
        "unavailable_view (utilisateur regardant un bouton grisé)"
    )
    lines.append("")
    lines.append("— Recommandation —")
    lines.append(recommend(stats, soak_days))
    return "\n".join(lines) + "\n"


def _fmt_breakdown(d: dict) -> str:
    return ", ".join(f"{k} {v}" for k, v in sorted(d.items()))


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    ndjson_path = (args.db_dir / NDJSON_FILENAME).resolve()
    if not ndjson_path.is_file():
        sys.stderr.write(
            f"NDJSON introuvable : {ndjson_path}\n"
            f"Vérifie --db-dir (doit pointer vers le dossier contenant la DB).\n"
        )
        return 1

    # Borne le since à la date de livraison Mode A — données antérieures
    # n'ont pas les events soak instrumentés.
    release = _parse_date(MODE_A_RELEASE_DATE)
    since   = max(_parse_date(args.since), release)
    until_inclusive  = _parse_date(args.until)
    until_exclusive  = until_inclusive + timedelta(days=1)
    soak_days = (until_inclusive.date() - since.date()).days + 1

    stats = aggregate(ndjson_path, since, until_exclusive, args.verbose)
    sys.stdout.write(render_report(ndjson_path, since, until_inclusive, soak_days, stats))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
