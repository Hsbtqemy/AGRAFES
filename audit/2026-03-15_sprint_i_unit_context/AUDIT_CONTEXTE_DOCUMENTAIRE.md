# Sprint I — Audit : Contexte documentaire local

**Date :** 2026-03-15  
**Scope :** tauri-app / Concordancier — meta panel navigation documentaire locale

---

## 1. Données déjà disponibles

| Champ | Source | Disponibilité |
|---|---|---|
| `doc_id` | `QueryHit` | Toujours présent |
| `unit_id` | `QueryHit` | Toujours présent |
| `external_id` | `QueryHit` | Souvent présent (§N) |
| `doc.unit_count` | `DocumentRecord` (via `docsById`) | Présent si doc chargé dans filtres |
| Texte du hit | `hit.text` / `hit.text_norm` | Toujours présent |

**Ce qui manque :**
- Index ordinal de l'unité dans le document (1-based parmi les `unit_type = 'line'`)
- Texte de l'unité précédente et suivante (±1)

---

## 2. Structure de la table `units`

```sql
CREATE TABLE units (
  unit_id   INTEGER PRIMARY KEY,
  doc_id    INTEGER NOT NULL REFERENCES documents(doc_id),
  n         INTEGER NOT NULL,       -- ordre absolu dans le doc
  unit_type TEXT NOT NULL,          -- 'line', 'header', etc.
  text_norm TEXT,
  ...
);
```

L'endpoint `/documents/preview` retourne les premières unités par `n` — il ne permet pas d'accéder aux unités autour d'une unité donnée.

---

## 3. Décision retenue

**Ajout d'un GET `/unit/context?unit_id=N`** (read-only, sans token).

Réponse :
```json
{
  "doc_id": 12,
  "unit_id": 847,
  "unit_index": 54,
  "total_units": 1200,
  "prev": { "unit_id": 846, "text": "…" },
  "current": { "unit_id": 847, "text": "…" },
  "next": { "unit_id": 848, "text": "…" }
}
```

**Hors scope de ce sprint :**
- Fenêtre plus large (±2, ±3, ...)
- Lecteur documentaire complet
- Pagination dans le document
- Synchronisation scroll

---

## 4. Coût SQL

Quatre requêtes simples sur index primaire / index `(doc_id, unit_type, n)` :
1. Fetch de l'unité cible (`WHERE unit_id = ?`)
2. `COUNT(*)` pour `total_units`
3. `COUNT(*)` pour `unit_index` (1-based)
4. `SELECT` pour `prev` (`n < n_cur ORDER BY n DESC LIMIT 1`)
5. `SELECT` pour `next` (`n > n_cur ORDER BY n ASC LIMIT 1`)

Coût négligeable. Pas de scan complet de table.

---

## 5. Bénéfice utilisateur

- Comprendre le voisinage immédiat du hit sans quitter le meta panel
- Naviguer dans le document même si l'unité voisine n'est pas dans les résultats chargés
- Connaître la position exacte (§54 / 1200 unités) plutôt que l'`external_id` brut seul
