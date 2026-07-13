# Revue adverse — tranche 4 « ⭙ Fusionner + bead de cellule » (D-W16)

**Périmètre :** `500ff26` (moteur, contrat 1.6.57) et `a84a7c3` (front).
**Méthode :** 6 finders (sémantique du bead, migration 030, résolveur de fusion, câblage écran,
adaptateur/contrat, « le lot tient-il vraiment sa promesse ») → 26 findings bruts → 2 réfutateurs
adverses par finding (57/58 agents ont abouti). 17 confirmés, 9 réfutés.

---

## T1 — MAJEUR · Le bug **inverse** : nos gestes effacent les collisions **légitimes**

**Confirmé, reproduit par plusieurs vérificateurs** (une seule voix « by-design », réfutée
ci-dessous).

`buildCellBeadActions` ([alignCellCut.ts](../tauri-prep/src/lib/alignCellCut.ts)) émet `set_bead`
sur **tous** les liens actifs de la cellule, et ses deux appelants lui passent la liste complète :
la cellule voisine dans `_performStraddleCut`, la cellule courante dans `_performCellMerge`. Si
cette cellule portait déjà **deux liens d'aligneur** — c'est-à-dire une **vraie collision**, une
ambiguïté que l'humain doit arbitrer — le geste les fond dans un bead unique et la collision
**disparaît** de `/align/collisions` et du rapport QA. Sans retour possible : aucun chemin d'UI
n'appelle `clear_bead`, et le ↺ ne dégroupe pas (T4).

La **migration 030** a exactement le même défaut : sa « signature de geste » (≥ 1 lien `manual`
coupé) n'exclut pas les cellules dont les *autres* liens forment une collision légitime. Son
en-tête promettait pourtant l'inverse — le test dédié passait parce qu'il plaçait la collision
légitime sur un **autre pivot**.

> **Contre-argument (voix réfutante), et pourquoi il ne tient pas.** Le §3.6 dit bien « les gestes
> posent ce bead sur les cellules qu'ils laissent à ≥ 2 liens », sans clause de signature — et
> l'invariant « ne jamais étouffer une collision légitime » est rattaché, grammaticalement, à la
> migration. Mais l'invariant *vaut pour le lot*, pas pour un fichier : effacer une ambiguïté que
> l'utilisateur n'a jamais vue, parce qu'il coupait la cellule **d'à côté**, n'est défendable dans
> aucune lecture. La voix réfutante ajoute qu'un run d'aligneur ne peut pas produire deux beads
> distincts sur un même pivot (les beads Gale-Church partitionnent) — c'est vrai, mais la forme
> **atteignable** est justement celle que le test du lot utilise : **deux liens sans bead**
> (`bead_uid` NULL), qui comptent comme deux beads distincts. Le scénario reste donc réel.

**Correctif.** Ne grouper que ce que le geste a produit : si la cellule porte **≥ 2 liens
non-gestes** (`manual !== true`), on ne beade pas — la cellule reste signalée, ce qui est la
vérité. Même garde en SQL pour la migration, plus une **migration de réparation** (031) qui rend
leur identité d'origine (`run_id#bead_id`, intacte) aux cellules que 030 a sur-groupées.

## T2 — MAJEUR · Fusionner accepte un lien **fusionné** (cible partagée)

`resolveCellMerge` ne vérifie que la cellule receveuse. Si le lien de bord du voisin pointe vers
une cible **déjà partagée avec une autre ligne moyeu** (fusion ⚠ non résolue), l'absorber duplique
la cible sur deux lignes **non adjacentes** — et fait disparaître le ⚠ (que le view-model ne
calcule que contre la ligne moyeu **précédente**). Correctif : refuser, et renvoyer vers ✂ Couper.

## T3 — MAJEUR · La fusion n'est pas réversible : la cellule vidée n'a plus de bouton

Le dialogue promet « réversible — ⭙ dans l'autre sens », mais après la fusion la cellule voisine
est **vide**, et les boutons ⭙/✂ sont conditionnés à `links.length > 0` (branche `ok` seulement).
Il ne reste que « ∅ non traduit », qui serait un **mensonge** (la phrase existe, elle est ailleurs).
Correctif : le ⭙ s'affiche aussi sur une cellule vide — `resolveCellMerge` tolère déjà un `cur`
vide.

## T4 — MINEUR · Le bead est en écriture seule (↺ ne dégroupe pas)

`buildUncutActions` n'émet pas de `clear_bead` : après un ↺, les liens gardent `cell#<p>#<d>`.
Avec T1 corrigé, le dégât se limite à la cellule que le geste avait légitimement groupée — mais le
↺ doit être l'inverse **exact**. Correctif : ↺ dégroupe les liens qu'il laisse en place.

## T5 — MINEUR · Aucune garde de version pour 1.6.57

Les `set_bead` partent dans le **batch atomique** du geste : contre un sidecar 1.6.54–1.6.56,
l'action inconnue fait **rouler tout le batch en arrière** — la coupe à cheval, qui marchait,
régresse. Correctif : le regroupement part dans un **second batch non atomique, best-effort** ; le
cœur du geste (coupe / fusion) reste atomique et ne dépend pas de la nouveauté.

## T6-T8 — MINEURS

| # | Défaut | Correctif |
|---|---|---|
| T6 | L'aperçu et le toast affirment que le voisin « deviendra ∅ » — faux dès qu'il porte plusieurs liens (seul le lien de **bord** part). | Texte conditionnel au nombre de liens restants. |
| T7 | Un lien **rejeté** (P,T) occupe encore l'index unique (mig 008) : la fusion résout, puis `createAlignLink` renvoie un **409 opaque**. | Message actionnable (« un lien rejeté existe déjà — le réactiver en Révision fine »). |
| T8 | Quand les deux sens échouent, le toast affiche l'erreur **structurelle** de `resDown` (« Pas de segment en dessous ») en masquant la vraie raison de `resUp`. | Préférer l'erreur non structurelle. |

## T9 — MINEUR (trouvé hors passe, par recoupement) · Un lien **rejeté** maintient sa collision

Le prédicat de collision compte les liens **morts** (ALN-03) comme des beads distincts, alors que
toute la chaîne les exclut depuis F8. Deux conséquences, reproduites : **« rejeter » — l'action de
résolution que le panneau Collisions propose lui-même — ne fait jamais disparaître la collision
qu'elle résout** ; et notre regroupement est **défait** dès qu'une cellule traîne un lien rejeté.
Correctif : exclure les liens rejetés des trois prédicats (endpoint, `/align/quality`, `qa_report`)
— déjà appliqué.

## Réfutés (voix unanimes)

- **`set_bead` dissout un bead N-M de l'aligneur** entre plusieurs pivots (`run1#5` → `cell#2#2`) :
  réel, mais **sans conséquence** — le front groupe ses beads par `bead_id` (intact) et `bead_uid`
  n'est lu que par la détection de collisions, qui groupe **par pivot**. Dette latente documentée,
  pas un bug.
- **`okBtn.innerHTML`** (chaîne statique, pas de corpus) — corrigé quand même, la convention du
  repo est le sink sûr.
- **`applied` dans le .md du contrat** ne mentionne que `set_status` — nit de doc, corrigé.

---

## Ordre des correctifs

1. **T1** (garde front + garde SQL + migration 031 de réparation) — le plus grave.
2. **T2**, **T3** (le geste n'est ni sûr ni réversible sans eux).
3. **T5** (pas de régression contre un sidecar plus ancien).
4. **T4**, **T6-T8**, nits de doc.
