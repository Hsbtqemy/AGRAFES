---
chantier: ING-01
statut: à venir
---

# ING-01 — un import peut réussir sans rien produire d'exploitable

**Point de départ** — deux causes indépendantes du même symptôme, constatées en pleine passe de QA et mesurées sur le corpus, aucune ligne écrite, 25 août 2026.

## Reste

- [ ] Trancher la reconnaissance de la numérotation `n.` : élargir `_NUMBERED_RE`, ajouter un mode dédié, ou détecter et avertir sans jamais deviner — la décision commande tous les items suivants, et élargir la regex risque d'attraper « 1. Introduction » dans de la prose ordinaire
- [ ] 45 des 241 `.txt` des arbres de corpus numérotent en `n.` et non `[n]` : importés aujourd'hui, ils donnent 100 % d'unités `structure` sans `external_id` — donc **sans leurs ancres d'alignement**, alors que leur nom porte « Aligné »
- [ ] Un `.docx` sans marqueur importé dans le mode proposé par défaut (`docx_numbered_lines`, `importDetect.ts:83`) produit le même résultat : 28 unités `structure`, 0 indexée — décider si la détection doit renifler le contenu plutôt que retomber sur un mode
- [ ] Le chemin sans `column_index` (`docx_numbered_lines.py:247`) n'émet aucun avertissement quand aucune ligne ne matche, alors que le chemin voisin porte le commentaire « never silent data loss » : décider du seuil (zéro ligne ? moins de la moitié ?) et du canal (avertissement, ou refus)
- [ ] `ImportScreen` n'affiche `units_line` que si des tables ont été traitées (`ImportScreen.ts:858`) : sans table, un import sans la moindre ligne se solde par « ✓ Importé » et rien d'autre
- [ ] Vérifier ce que l'aperçu d'import (`/import/preview`) montre déjà de ce cas : s'il annonce le type des unités, le trou est seulement dans l'écran et pas dans le moteur
- [ ] Décider si un document déjà importé sans aucune unité `line` doit être rattrapable après coup (réimport ? conversion en place ?) ou seulement empêché à l'entrée

## QA

Aucune passe dédiée. `qa/italique-import.md` porte deux points qui touchent le symptôme
(vérifier que les unités sont de type `line`, distinguer la recherche du concordancier de
celle de la couche), mais ils constatent le trou sans le couvrir. Une passe propre n'aura
de sens qu'une fois l'avertissement écrit — c'est lui qui sera vérifiable.

## Contexte

**Le symptôme, en une phrase.** Un document s'importe, l'écran affiche « ✓ Importé », et
le document ne contient aucune unité cherchable ni aucune ancre d'alignement.

**Première cause — la convention de numérotation.** Les deux importateurs numérotés
partagent la même expression, crochets obligatoires (`txt.py:30`,
`docx_numbered_lines.py:30`) :

```python
_NUMBERED_RE = re.compile(r"^\[\s*(\d+)\s*\]\s*(.+)$")
```

Or `9_CI-TrFr-2021_Aligné_UTF8.txt` numérote au point — `1. Texte 9`, `2. Pour vacciner,
la France préfère la manière forte au libre choix [T]`, … Aucune des 48 lignes ne matche :
le `doc_id` 426 porte 48 unités, **0 de type `line`, 0 `external_id`, 0 ligne indexée**.
Sur les 241 `.txt` des deux arbres de corpus, 196 utilisent `[n]` et **45 utilisent `n.`** —
`1-MGW2010_or_fr.txt`, `10_CI-OrEn-2021_Aligné_UTF8.txt`, `10_GW-OrFr-2011_Aligné.txt`…
les familles CI et GW/MGW, toutes marquées « Aligné ». Ces fichiers portent d'ailleurs
deux systèmes de marques — le numéro de ligne et les rôles `[T]` que le *marker lift* sait
relever — dont un seul est reconnu à l'entrée.

**L'enjeu n'est pas que la recherche.** Pour un fichier aligné, le numéro **est** l'ancre :
il devient l'`external_id`. Importé ainsi, le document n'est pas seulement invisible au
concordancier — il arrive sans l'alignement qu'il portait déjà, et rien ne le dit.

**Seconde cause — le mode retenu par défaut.** Pour un `.docx`, `importDetect` retombe sur
`docx_numbered_lines` quel que soit le contenu (`importDetect.ts:83`), et ce mode range en
`structure` tout paragraphe sans marqueur (`docx_numbered_lines.py:107`). D'où le `doc_id`
424 : `8-CI-TrEn-2022_A Aligner.docx`, 28 unités toutes `structure`, 0 indexée. Le
balisage riche, lui, survit — 16 unités sur 28 le portent — ce qui rend le document
trompeusement normal à l'écran.

**Pourquoi une seule fiche pour les deux.** Les causes sont indépendantes et leurs
correctifs le seront peut-être aussi, mais le défaut qu'elles partagent est le même, et
c'est lui qui compte : rien, ni dans le moteur ni dans l'écran, ne distingue un import qui
a produit 28 lignes d'un import qui n'en a produit aucune. Traiter les deux causes sans
traiter ce silence laisserait la troisième cause, celle qu'on n'a pas encore rencontrée,
se comporter exactement pareil.

Pas de champ `audit:` : `docs/AUDIT_IMPORT_2026-07-20.md` (chantier IMP-01) laisse 11
constats ouverts mais ne contient pas ceux-ci — les mesures ci-dessus sont la seule source
de cette fiche.
