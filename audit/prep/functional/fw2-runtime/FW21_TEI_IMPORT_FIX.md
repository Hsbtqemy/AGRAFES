# FW-2.1 — TEI Import Sidecar Job Fix

**Date:** 2026-03-10
**Bug closed:** BUG-FW2-01

---

## A. Cause exacte

Le job runner `kind='import'` dans `sidecar.py` (~ligne 3010) appelait `import_tei()` avec le mot-clé `tei_unit=` :

```python
# BEFORE (broken)
report = import_tei(
    conn, path=file_path, language=...,
    title=title, tei_unit=tei_unit,        # ← mauvais mot-clé
    doc_role=doc_role, resource_type=resource_type,
)
```

La signature réelle de `import_tei()` (fichier `importers/tei_importer.py` ligne 127) est :

```python
def import_tei(
    conn, path, language=None, title=None,
    doc_role="standalone", resource_type=None,
    unit_element: str = "p",               # ← paramètre correct
    run_id=None, run_logger=None,
) -> ImportReport:
```

Le handler HTTP inline (route `POST /import`, ligne 1132) utilisait déjà correctement `unit_element=tei_unit`. Seul le job runner asynchrone avait la faute de frappe.

Résultat : tout appel à `POST /jobs/enqueue` avec `kind="import"` et `mode="tei"` levait :
```
TypeError: import_tei() got an unexpected keyword argument 'tei_unit'
```

---

## B. Correction appliquée

**Fichier :** `src/multicorpus_engine/sidecar.py` ligne 3010

```python
# AFTER (fixed)
report = import_tei(
    conn, path=file_path, language=...,
    title=title, unit_element=tei_unit,    # ← corrigé
    doc_role=doc_role, resource_type=resource_type,
)
```

Changement minimal : un seul mot-clé renommé. Aucune logique modifiée.

---

## C. Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `src/multicorpus_engine/sidecar.py` | `tei_unit=tei_unit` → `unit_element=tei_unit` (ligne 3010) |

---

## D. Build

```
npm --prefix tauri-prep run build
✓ built in 267ms  (27 modules, 0 errors)
```

Sidecar PyInstaller rebuild : ✅ (26 MB, `tauri-prep/src-tauri/binaries/multicorpus-aarch64-apple-darwin`)

---

## E. git diff --name-only

```
src/multicorpus_engine/sidecar.py
```

Un seul fichier applicatif modifié dans l'ensemble du sprint FW-2.1.

---

## F. Résultat du smoke test TEI import

Script : `audit/prep/functional/fw2-runtime/fw21_tei_import_smoke.py`
Fixture : `tests/fixtures/tei/tei_simple_div_p_s.xml` (FR, 3 paragraphes)
Sidecar : Python source 1.4.6 (fix appliqué), port 19901

```
sidecar up  api_version=1.4.6

Enqueuing TEI import job for tei_simple_div_p_s.xml ...
enqueue ok=True  error=None
job_id=e4f7ec8b-86f1-4e22-8010-a0aa3ef7b758
final status: done
error:        None
result:       {
  'doc_id': 1, 'units_total': 3, 'units_line': 3,
  'units_structure': 0, 'duplicates': [], 'holes': [],
  'non_monotonic': [], 'warnings': []
}

documents in DB: 1
  doc_id=1  title='FW21 TEI test (FR)'  language=fr

tei_unit kwarg error absent: True
job succeeded:               True
document imported:           True

=== RESULT: BUG-FW2-01 FIXED — TEI import job succeeds ===
```

Résultat machine : `audit/prep/functional/fw2-runtime/fw21_tei_import_result.json`

---

## G. Conclusion

**Bug corrigé et validé.**

- `TypeError: import_tei() got an unexpected keyword argument 'tei_unit'` : disparu
- Job `kind='import'` / `mode='tei'` : statut `done`, 3 unités importées
- Aucune régression build (0 erreur TypeScript)
- Second bug détecté pendant FW-2 : aucun — le job runner pour les autres modes (docx, txt) utilise des importateurs distincts, non affectés par ce renommage
