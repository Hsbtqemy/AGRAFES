"""Diagnostic: list documents whose text_norm contains literal `$N` artefacts.

These artefacts come from curation runs executed before the JS->Python
replacement-syntax fix in `multicorpus_engine.curation` (rules using
`$1`, `$&` were treated as literal text by Python's re.sub).

Usage:
    python scripts/diagnose_dollar_pollution.py <path/to/agrafes.db>

Reports per affected doc_id: title, polluted unit count, total units,
ratio, and one sample. Read-only -- does not modify the DB.
"""
from __future__ import annotations

import io
import re
import sqlite3
import sys
from pathlib import Path

# Force UTF-8 stdout so Windows cp1252 consoles don't choke on Unicode samples.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Signature patterns left by the buggy presets. Tightened to avoid false
# positives on legitimate dollar amounts ("cost $5", "$1 million").
#   - " $<digit>"  : FR punctuation rule emitted narrow-nbsp + literal $N
#   - "[$<digits>]"     : numbering preset emitted [$1]/[$2]
#   - "$<d>$<d>"        : repeated capture like "$1$1" / "$1$2" / "$2$1"
#   - "$&"              : whole-match marker (rare in everyday text)
_ARTEFACT_RE = re.compile(
    r" \$\d"
    r"|\[\$\d{1,2}\]"
    r"|\$\d\$\d"
    r"|\$&"
)


def main(db_path: str) -> int:
    p = Path(db_path)
    if not p.exists():
        print(f"DB introuvable : {p}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # Narrow with LIKE first (uses index/scan well), then confirm with regex.
    rows = conn.execute(
        "SELECT u.doc_id, u.unit_id, u.n, u.text_norm,"
        "       d.title, d.language"
        "  FROM units u"
        "  JOIN documents d ON d.doc_id = u.doc_id"
        " WHERE u.text_norm LIKE '%$%'"
        " ORDER BY u.doc_id, u.n"
    ).fetchall()

    by_doc: dict[int, dict] = {}
    for r in rows:
        text = r["text_norm"] or ""
        if not _ARTEFACT_RE.search(text):
            continue
        d = by_doc.setdefault(r["doc_id"], {
            "title": r["title"],
            "language": r["language"],
            "polluted": 0,
            "sample_n": r["n"],
            "sample_text": text,
        })
        d["polluted"] += 1

    if not by_doc:
        print("Aucune unité polluée détectée. Rien à faire.")
        return 0

    # Total units per affected doc, for the ratio.
    placeholders = ",".join("?" * len(by_doc))
    totals = {
        row["doc_id"]: row["c"]
        for row in conn.execute(
            f"SELECT doc_id, COUNT(*) AS c FROM units"
            f" WHERE doc_id IN ({placeholders}) AND unit_type = 'line'"
            f" GROUP BY doc_id",
            list(by_doc.keys()),
        ).fetchall()
    }

    print(f"{len(by_doc)} document(s) affecté(s) :\n")
    print(f"{'doc_id':>7}  {'lang':<4}  {'polluées/total':>16}  title")
    print("-" * 80)
    grand_total = 0
    for doc_id, info in sorted(by_doc.items(), key=lambda kv: -kv[1]["polluted"]):
        total = totals.get(doc_id, 0)
        grand_total += info["polluted"]
        ratio = f"{info['polluted']}/{total}"
        title = (info["title"] or "")[:50]
        print(f"{doc_id:>7}  {info['language'] or '?':<4}  {ratio:>16}  {title}")

    print("-" * 80)
    print(f"Total unités polluées : {grand_total}\n")
    print("Échantillon (1ère unité polluée par doc) :")
    for doc_id, info in sorted(by_doc.items()):
        snippet = info["sample_text"][:140].replace("\n", " | ")
        print(f"  #{doc_id} n={info['sample_n']} -> {snippet!r}")

    print("\nProchaine étape : réimporter ces docs depuis leur fichier source,")
    print("puis resegmenter et relancer la curation (les presets sont maintenant corrigés).")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
