---
chantier: QAS-01
statut: à venir
audit: docs/REVIEW_QA_SHELL_2026-08-16.md
---

# QAS-01 — les quatorze constats de la passe shell n'ont pas de propriétaire

**Point de départ** — hérité du chantier `JOURNAL` le 2026-08-27, quand celui-ci a été
clos : la question ne portait pas sur le journal mais sur la tenue de ce dossier-ci, et
elle serait partie avec la fiche.

## Reste

### Établir l'état réel avant de décider
- [ ] **Aucun des quatorze `QA-01`…`QA-14` n'est suivi, sauf `QA-06`.** Vérifié un par un
      le 2026-08-27 en cherchant chaque code dans `pilotage/` : seul `QA-06` apparaît dans
      une fiche — dans `R2` depuis ce matin, dans `R6` avant. Les treize autres ne sont
      cités que par le document qui les a écrits
- [ ] **Le compte de treize est un compte de suivi, pas un compte de travail — et l'écart
      est déjà visible.** Trois constats sondés au code le 2026-08-27 : `QA-13` (le panneau
      Diagnostic sondait le sidecar par un `fetch` brut bloqué par CORS) porte désormais en
      `tauri-shell/src/diagnostics.ts:127` un commentaire qui explique précisément ce
      blocage — la forme d'un correctif, pas du défaut. Donc **au moins un des treize est
      probablement clos sans que rien ne le dise**. Les deux autres sondés ne se laissent
      pas trancher à la lecture. Confronter les treize au code est le préalable : décider
      du sort d'une liste dont on ne connaît pas l'état, c'est planifier sur un chiffre faux

### Puis trancher la forme
- [ ] Une fiche par constat, un seul chantier de correction, ou une répartition dans les
      fiches existantes selon la surface touchée ? Les quatorze sont hétérogènes — `QA-04`
      touche l'index FTS (voisin de `FTS-01`), `QA-05` l'import sans unité exploitable
      (voisin d'`ING-01`), `QA-07` la double définition de « rôle structurel » dans le
      moteur, `QA-14` l'accessibilité du tiroir Journal. La répartition par surface est
      donc possible, mais elle n'a de sens qu'après le point précédent

## Contexte

Les constats vivent dans `docs/REVIEW_QA_SHELL_2026-08-16.md`, sous la forme
`### QA-NN — titre` suivie d'une ligne `- **Sévérité** : 🟠`. J'ai d'abord écrit ici que le
contrôleur annoncerait « format non reconnu ». **C'est faux, et le vrai comportement est
pire** : mesuré le 2026-08-27, il répond `reconnu: true, total: 1` sur un document qui en
porte **quatorze**. Il ne trouve que `QA-09`, seul dont le titre porte sa pastille en
ligne (`### QA-09 — 🔴 le stylo…`) ; les treize autres la mettent sur une ligne
`- **Sévérité** :` séparée, que le lecteur ne regarde pas.

Un « format non reconnu » aurait été honnête. Un « 1 constat ouvert » est un chiffre qui
se lit comme une mesure et n'en est pas une. Le défaut est côté outil et suivi là-bas
(`P-6` de Pilote, rouverte pour ça) ; en attendant, **ne pas lire le compte d'audit de
cette fiche** : le vrai est quatorze.

La passe rejouable `pilotage/qa/shell-v040.md` **cite** ces codes sans les définir : elle
s'en sert comme repères (« position décalée = QA-02, connu »). Elle ne les suit donc pas
non plus.
