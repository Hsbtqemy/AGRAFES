# Revue adverse — chantier 1 : validation d'ancrage amont (`anchoring` + `anchorWarn` + garde `AlignMatrixView`)

**Méthode :** 6 finders (une dimension chacune : classifieur `anchor_status`, extraction
`is_anchored_regime`, intégration payload matrice, cycle de vie de la garde front, builders
purs/fail-open, sémantique & angles morts) → **2 réfutateurs adverses par finding** (lentille
*correction* + lentille *atteignabilité*). Les réfutateurs de la dimension **sémantique** sont
morts sur une **limite de session** (6 échecs) → ces findings ont été **recoupés à la main au
code** (aligneur + stratégie par défaut). Ci-dessous les **confirmés**, classés.

---

## M1 — MAJEUR (décision de design) · l'ancrage était classé *par document*, en ignorant la stratégie

Racine : `anchored=true` (pour `value`/`position`) faisait **taire l'alerte**, en supposant que
l'aligneur exploite l'ancre. Faux sous le défaut : `align_pair_by_length` (Gale-Church borné,
`_load_length_blocks` → `derive_coarse_blocks`) **ne se recale que sur `parent_n`**, jamais sur
`external_id` (celui-ci n'est qu'*enregistré* sur le lien). `similarity` idem.

**Scénario (vérifié au code) :** moyeu FR `docx_paragraphs` 10 ¶ (external_id 1..10, pas de
`parent_n`) + trad EN `docx_paragraphs` 12 ¶ → tous deux `{kind:'position', anchored:true}` →
`anchorWarnings()==[]` → **ni bandeau ni garde**. Clic « Aligner » (défaut `length_bounded`) →
régime *dérivé* (pas de `parent_n`) → 1 ligne = 1 bloc → Gale-Church 10 vs 12 → **dérive
Beigbeder, en silence**. Deux docs identiques *pour l'aligneur de longueur* recevaient des
verdicts opposés selon le seul fait que `external_id == n`.

**Correctif (option 1 retenue) :** `anchorWarnings(matrix, strategy)` conscient de la stratégie.
- **Camp longueur** (`length_bounded`, `similarity`) : une traduction est protégée **ssi** elle
  est ¶-appariée au moyeu (`parent_n` des deux côtés) **ou** parallèle (même `line_count`).
  Sinon → motif `unused-anchor` (« ancré par [N]/position, mais « longueur » ne l'exploite pas »).
  Un moyeu non-ancré porte sa propre alerte globale — pas de double-alerte par colonne.
- **Camp identité** (`external_id`, `external_id_then_position`, `position`) : `[N]`/position
  **protègent** ; seul un texte réellement non-ancré (`kind:null`) est signalé.

Note §3 (« docx déjà couvert ») **corrigée** en conséquence.

## m1 — MINEUR · la garde (et le rerun-confirm) survivait à un changement de famille

Le handler `change` du select et `_loadMatrix` ne fermaient pas `#matrix-align-strip` → un
bandeau (garde d'ancrage **ou** « Recalcul global ») armé pour la famille N restait affiché
au-dessus de la grille de la famille M. Sûr fonctionnellement (la garde `run()` interceptait un
lancement erroné), mais trompeur. **Fix :** `_closeAlignStrip()` dans le handler `change`. (Le
test tranche-5 qui vérifiait le *toast* de garde-après-switch est mis à jour : la fermeture du
strip est le meilleur garde — le bouton destructif disparaît.)

## m2 + m3 — MINEURS · `anchorRemedy` : cas 0-ligne et référence morte

- **m2 :** un doc 100 % structure (0 unité-ligne — prose importée en `*_numbered_lines` sans
  marqueur) donnait `line_count:0` → branche `<=1` → remède « texte en un seul bloc… extraire
  ses paragraphes » alors qu'il n'y a **ni bloc ni paragraphe**. Fix : branche `=== 0` distincte
  (« ne porte que de la structure → ré-importer / re-segmenter »).
- **m3 :** le remède blob nommait « **extraire ses paragraphes** » = R2.3 **non construit**
  (seul `/units/split` existe, binaire). Fix : retiré ; ne reste que « ré-importer découpé »
  (réel). Le remède multi-lignes (regrouper — R5.4c/`/segment/coarse`) était, lui, correct.

## m4 + n2 — MINEUR + nit · acquittement de la garde lié à la famille « pour toujours »

`_anchorAckFamilyId` n'était remis à `null` que dans `_resetMatrix` (changement de connexion).
Conséquences : (m4) un ré-import dans le **même** corpus qui re-casse l'ancrage laissait la garde
**sautée** (consentement périmé) ; (n2) slot unique → alterner deux familles re-prévient la
première. **Fix commun :** réinitialiser `_anchorAckFamilyId` dans `_loadMatrix` — le
consentement est lié au **contenu chargé**, pas à la famille. Résout m4 (re-import ré-arme) et
n2 (chaque chargement repart neuf).

## Nit acté acceptable

- **n1 — `anchor_status` = N+1 lectures `units` par chargement matrice** (hub + T traductions,
  ~6 scans / +30 % de requêtes sur Beigbeder 5 langues). **CONFIRMED ×2** comme mécanisme, mais
  borné, indexé (`idx_units_doc_n`), motif identique à `coarse_blocks_for_doc` (design sanctionné).
  **Aucun correctif** ; batchable en un `WHERE doc_id IN (...)` si un profil le fait ressortir.

## Réfuté

- **KeyError `_external_id_anchor`** (accès `u["n"]` par crochet, except sans `KeyError`) —
  **REFUTED ×2** : l'unique appelant (`anchor_status_for_doc`) construit chaque dict via
  `SELECT n, …` donc `n` est **toujours** présent ; un `n` NULL en base donnerait `int(None)` →
  `TypeError`, **déjà** capturé (retombée `value`). État inatteignable.

---

## Résolution (2026-07-18) — M1 + 4 mineurs corrigés, chacun RED-sur-ancien

- **M1** → `anchorWarnings(matrix, strategy)` + motif `unused-anchor` + remèdes orientés.
  *(tests : `value` sous longueur → alerte ; parallèle position → silence ; both-¶ → silence ;
  `value` sous external_id → silence)*
- **m1** → `_closeAlignStrip()` au changement de famille. *(test align mis à jour : strip fermé)*
- **m2 + m3** → `anchorRemedy(0)` distinct + « extraire » purgé. *(tests `anchorRemedy(0)`/`(1)`)*
- **m4 + n2** → `_anchorAckFamilyId` réinitialisé dans `_loadMatrix`.
- **n1** → acté acceptable, pas de correctif.

**Vérifs :** vitest **1059** · eslint ✓ · build ✓ ; moteur inchangé (pytest 37 + contrat 72 déjà verts).

---

## Passage adverse ciblé sur le correctif M1 (2026-07-18) — 4 réfutateurs, 1 défaut

Le code neuf de M1 (non revu) a été éprouvé par 4 réfutateurs (un par choix de jugement) :

- **M1-b (minor) — CONFIRMED, corrigé.** Le raccourci `parallel = hub.line_count === a.line_count`
  taisait l'alerte pour une ancre **`value`** à comptes égaux mais `[N]` **décalés** (FR `[11..15]`
  vs EN `[12..16]`) : sous `length_bounded` (qui ignore `external_id`), l'alignement diagonal
  dérive, en silence — le cas que M1 devait couvrir pour l'ancre la plus forte. **Fix :** `parallel`
  ne vaut que si aucun côté n'est `value` (une ancre valeur est non-positionnelle par définition).
- **Ack-reset / strip-close / suppression moyeu-nul → tiennent** (traces au code) : pas de boucle
  ni double-run (garde `_aligning`) ; le strip n'est jamais relu comme état ; sous un moyeu nul, la
  notice globale « tout dérive » couvre les colonnes et **éviter** un `unused-anchor` par colonne est
  *plus* correct (un remède « bascule external_id » serait faux quand le moyeu n'a pas de `[N]`).
