# Note de design — R3 : alignement à la phrase (aligneur borné par ancre)

> Statut : **intention de design — décisions figées**. Date : 2026-07-01 · révisé : **B+C adoptés** (aligneur hiérarchique à deux étages + beads N-M persistés).
> Ancrage : cartographie code (4 explorations ciblées, 2026-07-01) + [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §5/§6/§8, [grounding](DESIGN_peritext_conventions_grounding.md) §0/§8, [`ROADMAP_REFONTE.md`](ROADMAP_REFONTE.md) §R3.
> Dépend de **R2.1** (ancre `meta_json.parent_n` persistée à la resegmentation) — livré.
> Jalon de valeur (§6 roadmap) : *le cœur contrastif*.

## 1. But & périmètre

Ajouter une **stratégie d'alignement automatique à la phrase**, par longueurs (type
Gale-Church, stdlib), **bornée par le paragraphe** (l'ancre `parent_n` de R2.1), plus
les **garde-fous anti-dérive** (pré-vol + post-check) et l'**UX de choix de méthode +
provenance**.

- **R3.1** garde-fous — [MOTEUR] · **R3.2** aligneur + dispatch — [MIXTE] (contrat) · **R3.3** UX — [FRONT].
- **WORKCOPY obligatoire** : la resegmentation supprime les liens (ADR-017) ; tout essai sur une copie, jamais le corpus réel.

## 2. État réel du sous-système (ce sur quoi on branche)

**Le socle est mûr — R3 s'y greffe, ne le refonde pas.**

- **Modèle** (`migrations/003_alignment.sql` + 004/008/011) : `alignment_links(link_id, run_id, pivot_unit_id, target_unit_id, external_id **NOT NULL**, pivot_doc_id, target_doc_id, created_at, status?, source_changed_at?)`. **UNIQUE(pivot_unit_id, target_unit_id)** (mig 008), `INSERT OR IGNORE`. Un lien = **une unité pivot ↔ une unité cible** (strictement 1-1).
- **Stratégies** (`aligner.py`, ~987 l.) : `external_id`, `position`, `external_id_then_position` (défaut), `similarity`. Contrat commun `(conn, pivot_doc_id, target_doc_ids, run_id, debug, protected_pairs_by_target, run_logger) → list[AlignmentReport]`. Paratexte exclu via `text_start_n`.
- **Dispatch** : `_run_alignment_strategy` (sidecar.py:373) ← `_handle_align` (sidecar.py:6049, `allowed_strategies` ~6096) et `cmd_align` (cli.py:455). Front : sélecteur `#align-strategy-sel` (`alignPanelTemplate.ts:53`).
- **Provenance déjà amorcée** : `AlignExplain{strategy, notes[]}` + `include_explain` (sidecarClient.ts:809/822) — R3.3 se greffe dessus, pas de champ neuf indispensable.
- **QA** (`qa_report.py`) : **outil CLI autonome** (`multicorpus qa-report`), **pas un endpoint sidecar**. `generate_qa_report` + `POLICY_RULES` (lenient=warning / strict=error). `_check_alignment_pairs` donne couverture/orphelins/collisions mais **aucun contrôle de cardinalité de segments**.
- **Ratio segments** : `SEGMENT_RATIO_WARN_THRESHOLD = 0.15` (sidecar.py:76), 7 sites, **tous advisory** (calibration `calibrate_to`/`calibrate_ratio_pct`), jamais bloquant.
- **Préservation** : `preserve_accepted` + `protected_pairs_by_target` (ADR-035) protègent les liens acceptés d'un re-run.

**Ce qui manque pour R3** : (a) une stratégie longueurs bornée par ancre ; (b) le pré-vol (compteurs ¶) + post-check (cohérence d'ancre) ; (c) l'UX méthode-par-texte + affichage de provenance.

## 3. Architecture retenue — aligneur hiérarchique à deux étages

Localiser une divergence entre un ¶ pivot et un ¶ cible n'est **pas un diff** (aucune clé commune entre deux langues) : c'est **déjà un alignement**. On applique donc **le même algorithme de longueurs à deux grains** :

1. **Étage paragraphe** — Gale-Church sur les **longueurs de coarse blocks** (R2.2, `coarse_blocks_for_doc`) → correspondances ¶↔¶, les insertions/suppressions de paragraphe étant des **beads 1-0 / 0-1** produits *naturellement* par la DP.
2. **Étage phrase** — pour chaque paire ¶↔¶ **1-1**, Gale-Church sur les **longueurs de phrases** (les membres du bloc) → les liens matérialisés.

Une **seule** fonction DP pure `gale_church_beads(longueurs_A, longueurs_B) → list[bead]` (stdlib), appelée à deux grains. Ce que ça résout :

- **La correspondance ¶↔¶** n'est plus « positionnelle + garde-fou » : l'étage ¶ l'établit et **absorbe l'écart de cardinalité** sous forme de beads ¶ 1-0/0-1. Le pré-vol **cesse d'être un portail** (cf. D4).
- **Précondition dégradée en douceur** : l'étage ¶ marche sur *n'importe quel* doc (1 ligne = 1 bloc quand non fine-segmenté) ; l'étage phrase n'opère que là où `parent_n` existe, sinon l'alignement s'arrête au grain ¶ (≈ un `position` plus tolérant). Granularité moindre, pas d'échec — signalée (cf. D7).
- **Beads N-M** : ils tombent aux deux étages ; reste à les **stocker** dans une table 1-1 → `bead_id` (cf. D2).

## 4. Décisions (figées sauf mention)

- **D1 — Modèle de longueurs : caractères.** `len(text_norm)` (stdlib, zéro dépendance, corrèle bien FR↔EN). *Alternative tokens rejetée* (tokenisation lourde, dépend de spaCy). **Figé : caractères.**
- **D1bis — Taille des beads : ≤ 2 par côté (Gale-Church classique).** Jeu de pas figé = `1-1, 1-2, 2-1, 2-2, 1-0, 0-1` (`gale_church._STEPS`). **`3-1` / `1-3` (et plus) sont HORS PÉRIMÈTRE** : la DP les décompose en `2-1`/`1-2` + un **orphelin** (une phrase sans lien → section Orphelins → rattachement manuel), *validé le 2026-07-01 sur un cas 3-1 réel*. Rationale : priors bien calibrés (papier), zéro risque de sur-fusion, orphelin récupérable. **Note** : `2-2` est inclus, au-delà de la liste `1-1/1-2/2-1/1-0/0-1` de [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §8.4 (l'impl = Gale-Church complet). **Escape hatch** : si le corpus révèle des `3-1`/`1-3` *fréquents*, extension ~20 l. (2 pas + 2 priors + tests) avec priors **calés sur de vrais exemples**, pas devinés. **Preuve (indicative, 2026-07-01)** : pipeline réel (import→2-grain→`length_bounded`) passé sur **13 œuvres GRAFE** (FR/EN/ES, ~17 k segments) — les orphelins « latent 1-3+ » vont de **0 (4 œuvres à parité stricte de phrases) à 92 (Simenon-Vacances)**, total ~183 (~1 %), **queue lourde pilotée par le style de traduction** (asymétrie du nb de phrases P/T), *pas* par la langue. Presse (M-GW Texte 6) : **0**. Enseignement : le besoin de `1-3` est une **propriété du bitexte**, pas une constante → **ne pas figer le cap en dur**, le garder **paramétrable** (le `_STEPS`), priors **calibrés par corpus** le jour où un bitexte le réclame. C'est **un corpus situé dans le temps, un parmi de nombreux à venir** — indicatif, non décisif. **Figé : ≤ 2 pour l'instant, cap à rendre paramétrique le moment venu.**
- **D2 — Beads N-M persistés (B adopté), via `bead_id`.** Les correspondances 1-2/2-1 (aux deux étages) sont **matérialisées** comme plusieurs liens 1-1 partageant un **`bead_id`** (colonne nullable, migration) ; les liens d'un même bead **ne comptent pas** comme collision (la détection exclut le même `bead_id`). **1-0/0-1 = absence de lien** (orphelin), aucun stockage neuf — le statut sémantique `non_traduit`/`ajout` reste R4.1, distinct. **Rendu minimal** : lignes d'un bead groupées/en retrait + étiquette « 1-2 » dans le constructeur de lignes existant. **Différé (R3.3+)** : l'**éditeur de beads** manuel (fusion/scission/ré-attribution au clic) — non nécessaire à la fidélité des données. **Figé : fidélité complète en données + rendu minimal ; éditeur plus tard.**
- **D3 — `external_id` des liens phrase : la position `n` du pivot.** La colonne est NOT NULL et les phrases n'ont pas d'external_id ; on y met la position (comme `position`/`similarity` déjà), cohérent avec le badge `[§n]` de l'AlignPanel. **Figé : position `n` pivot.**
- **D4 — Pré-vol : avertissement de bon sens, plus un portail.** L'étage ¶ (§3) absorbe l'écart de cardinalité en beads 1-0/0-1 → plus besoin de bloquer. On calcule **après** l'étage ¶ le ratio de ¶ non appariés ; au-delà du seuil (réutilise `SEGMENT_RATIO_WARN_THRESHOLD = 0.15`) → **avertissement** « X % des ¶ non appariés — vérifier que c'est bien une traduction », jamais bloquant. Plus de `force`/`strict`, plus d'acquittement. **Figé : avertissement post-alignement, zéro blocage.**
- **D5 — Post-check (cohérence d'ancre) : extension minimale de `qa_report.py`.** Nouveau `_check_anchor_consistency(conn)` : `JOIN units` sur `alignment_links`, comparer `unit_role` pivot vs cible, lister les incohérences localisées. Intégré à `generate_qa_report` + `POLICY_RULES` (lenient=warning/strict=error). **Audit de relecture, pas un blocage live.** Limite assumée (design §5b) : n'attrape que la dérive qui *traverse* une ancre. **Figé : minimal dans qa_report, `integrity_report` riche différé.**
- **D6 — Stratégie `length_bounded`.** Ajout : la DP pure `gale_church_beads` + les orchestrateurs deux-étages `align_by_length_bounded`/`align_pair_by_length` (aligner.py, même moule + skip `protected_pairs`) ; entrée dans `_run_alignment_strategy`, `allowed_strategies` (sidecar + cli), l'**enum `strategy` du schéma `/align`** ; les réponses audit/link exposent **`bead_id`** (additif) ; `<select>` AlignPanel. Tout **additif** côté API → bump contrat (3 artefacts). **Figé : `length_bounded`.**
- **D7 — Précondition manquante : dégradation signalée, pas d'erreur sèche.** Si un doc n'a pas de `parent_n`, l'**étage phrase est sauté** : on aligne au grain ¶ et on **signale** « alignement au paragraphe (resegmenter en phrases pour le grain fin) ». Pas de fallback *silencieux* (le signal est explicite), pas de refus non plus — l'étage ¶ reste utile. **Figé : dégrader au grain ¶ + signaler.**
- **D8 — WORKCOPY.** Tests sur DB tmp (pattern `test_resegment_parent`) ; essais manuels sur copie du corpus. Jamais de resegment/align expérimental sur le réel.

## 5. Implications contrat / migration / risque

- **Migration : une** — `bead_id` (nullable INTEGER + index) sur `alignment_links` (prochaine numérotée). Pas d'autre changement de schéma (gaps = orphelins ; `external_id` = position pivot).
- **Contrat : oui** (additif, 3 artefacts) — `strategy` gagne `length_bounded` ; les réponses audit/link exposent `bead_id`.
- **Growth-gate** : DP + aligneur dans `aligner.py`, garde-fous dans `qa_report.py`/module dédié — **hors `sidecar.py`** ; `_handle_align` ne gagne que l'adaptateur.
- **Ordre d'implémentation** : **R3.1** (post-check cohérence de rôle dans `qa_report` + avertissement ¶ post-alignement ; moteur pur, tmp DB, faible risque) → **R3.2** (DP `gale_church_beads` + aligneur 2 étages + migration `bead_id` + exclusion collision + rendu minimal ; le gros) → **R3.3** (UX méthode/provenance + éditeur de beads).

## 6. Décisions figées (revue 2026-07-01) & ce qui reste

**Figé avec l'humain** : **B** (beads N-M persistés via `bead_id`) + **C** (aligneur hiérarchique à deux étages ; pré-vol → avertissement). Plus D1 caractères · D3 `external_id`=position · D6 `length_bounded` · D7 dégradation signalée · D8 WORKCOPY.

**Seule limite posée** : l'**éditeur de beads manuel** (fusion/scission/ré-attribution au clic) est **différé R3.3+** — les données restent fidèles sans lui. Cadré dans sa propre note : [`DESIGN_R3_3_bead_editor.md`](DESIGN_R3_3_bead_editor.md) (dont le point dur : la fusion est bornée au même `run_id` par la clé de collision).

**Reste ouvert (au fil de R3.2, non bloquant)** : introduit-on un **seuil de confiance** de la DP pour marquer certains liens « à revoir », ou tous naissent `status=NULL` (non revus) comme aujourd'hui ? — hérité de [`DESIGN_peritext_conventions.md`](DESIGN_peritext_conventions.md) §8.4.
