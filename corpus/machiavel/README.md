# Corpus Machiavel — Il Principe, corpus multilingue aligné

Corpus de comparaison pour AGRAFES (Concordancier).  
Textes dans le domaine public.

## Structure du corpus

| Fichier | Langue | Rôle d'import | Source |
|---------|--------|--------------|--------|
| `il_principe_it.txt` | Italien | `primary` | Texte original, Machiavelli (1532) |
| `le_prince_fr.txt` | Français | `translation` | Traduction Périès (1825) |
| `the_prince_en.txt` | Anglais | `translation` | Traduction Thomson (1882) |

## Principe de l'alignement

**Chaque `[N]` correspond exactement au même paragraphe dans les 3 langues.**

```
[1] Sogliono el più delle volte coloro...  (IT)
[1] L'usage de ceux qui veulent acquérir...  (FR)
[1] It is customary for those who wish...  (EN)
```

L'alignement automatique via `strategy=external_id` fonctionne donc immédiatement.

## Couverture

- Dédicace à Laurent de Médicis
- Chapitres I à XVIII (des principautés, des armes, du gouvernement)
- 148 unités parallèles par document
- 18 titres de chapitre (unités structurelles, sans numéro)

## Procédure d'import dans AGRAFES

### Étape 1 — Importer les 3 documents

Dans **Préparation > Importer**, répéter pour chaque fichier :

| Champ | `il_principe_it.txt` | `le_prince_fr.txt` | `the_prince_en.txt` |
|-------|---------------------|-------------------|---------------------|
| Mode | `txt_numbered_lines` | `txt_numbered_lines` | `txt_numbered_lines` |
| Langue | `it` | `fr` | `en` |
| Rôle (`doc_role`) | `primary` | `translation` | `translation` |
| Type (`resource_type`) | `text` | `text` | `text` |

### Étape 2 — Aligner les documents

Dans **Préparation > Aligner** (ou via l'API) :

```json
POST /align
{
  "pivot_doc_id": <id du document italien>,
  "target_doc_ids": [<id FR>, <id EN>],
  "strategy": "external_id"
}
```

La stratégie `external_id` fait correspondre les `[N]` directement, sans calcul de similarité.

### Étape 3 — Explorer dans le Concordancier

Chercher un mot (ex. : `prince`, `fortune`, `armes`) :
- Les hits apparaissent dans la langue de recherche
- Ouvrir le meta panel → section "Alignés" pour voir les passages correspondants dans les autres langues
- Utiliser les filtres `Langue` pour restreindre à une version

## Mots-clés utiles pour tester

| Thème | Italien | Français | Anglais |
|-------|---------|----------|---------|
| Gouvernement | `principe`, `stato` | `prince`, `État` | `prince`, `state` |
| Vertu | `virtù`, `fortuna` | `vertu`, `fortune` | `merit`, `fortune` |
| Armées | `arme`, `milizie` | `armes`, `soldats` | `arms`, `troops` |
| Peuple | `popolo`, `grandi` | `peuple`, `grands` | `people`, `nobles` |
| Politique | `crudeltà`, `pietà` | `cruauté`, `clémence` | `cruelty`, `clemency` |

## Format des fichiers

Convention `txt_numbered_lines` :
- `[N] texte` → unité de recherche indexable (`unit_type=line`)
- Ligne sans numéro → unité structurelle (titre de chapitre, `unit_type=structure`)
- Lignes vides → ignorées
