---
chantier: IMP-01
statut: clos
audit: docs/AUDIT_IMPORT_2026-07-20.md
---

# IMP-01 — hang puis OOM sur `_analyze_external_ids`

**Arrêté sur** — revue adverse, préservation du gate QA « >20 % de trous » malgré la borne, commit `9743d12`, 20 juillet 2026.

## Contexte

**Aucun reliquat.** Le tracker porte `✅ corrigé`, fix **et** revue adverse inclus.

Le défaut : `range(min, max)` plus un `set()` reconstruit à chaque itération, coût
proportionnel à l'écart entre identifiants — un `[900000000]`, un `xml:id=p99999999` ou un
`sent_id=999999999` gelait le sidecar. Sous `self._lock()`, donc un hang, pas une
exception. Fix : `set` construit une seule fois plus une borne `_MAX_HOLES=1000` avec
early-break — temps et mémoire bornés, ce qui referme au passage le gonflement de
`report.warnings`. Trois tests `test_import.py::test_analyze_external_ids_*`, RED prouvé
sur un écart de 5000 (4998 ≠ 1000). `docx_numbered_lines.py:169`.

La revue adverse a rattrapé une régression silencieuse que le fix venait d'introduire : la
troncature désarmait le gate QA « >20 % de trous → error » (`qa_report.py:55`, qui lisait
`len(holes)` capé), au point qu'un document de 6001 identifiants avec 1999 trous
ressortait « ok ». Le gate compte désormais les trous exactement en O(1)
(`span − |distincts|`), indépendamment de la liste tronquée qui reste l'échantillon
d'affichage. Test `test_qa_report.py::test_import_integrity_hole_gate_survives_cap`, RED
prouvé.

Le chantier est clos, mais **l'audit import ne l'est pas**. Restent ouverts, sous d'autres
codes : IMP-09 (`🟦 partiel` — pas de reniflage de contenu, l'échappatoire reste manuelle),
IMP-05, IMP-06, IMP-07, IMP-08 et IMP-14 (`🔵 dette` assumée), IMP-10 et IMP-12
(`📝 documenté` — limite intrinsèque de la détection par nom de fichier). Verdict
structurant de cet audit : `resource_type` **reste manuel**, le signal est nul et
non auto-détectable.

Sources : `docs/AUDIT_FOLLOW_UP.md` ligne IMP-01, corps de `9743d12`.
