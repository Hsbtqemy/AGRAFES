# TEI Compatibility Matrix

## Element support by profile

| TEI Element | Generic | ParCoLab-like | Source |
|------------|---------|--------------|--------|
| `TEI/@xmlns` | ✓ | ✓ | Hardcoded (TEI P5) |
| `teiHeader/fileDesc/titleStmt/title` | ✓ | ✓ | `documents.title` |
| `teiHeader/fileDesc/titleStmt/title[@type='sub']` | ✗ | ○ | `meta_json.subtitle` |
| `teiHeader/fileDesc/titleStmt/author` | ✗ | ○ | `meta_json.author` |
| `teiHeader/fileDesc/titleStmt/respStmt` (translator) | ✗ | ○ | `meta_json.translator` |
| `teiHeader/fileDesc/publicationStmt/p` | ✓ | — | Generated timestamp |
| `teiHeader/fileDesc/publicationStmt/publisher` | ✗ | ○ | `meta_json.publisher` |
| `teiHeader/fileDesc/publicationStmt/pubPlace` | ✗ | ○ | `meta_json.pubPlace` |
| `teiHeader/fileDesc/publicationStmt/date` | ✗ | ○ | `meta_json.date` |
| `teiHeader/fileDesc/sourceDesc/p` | ✓ | ✓ | `documents.source_path` |
| `teiHeader/profileDesc/langUsage/language` | ✓ | ✓ | `documents.language` |
| `teiHeader/profileDesc/langUsage/language` (original) | ✗ | ○ | `meta_json.language_ori` |
| `teiHeader/profileDesc/textClass/keywords/term[@type='doc_role']` | ○ | ✗ | `documents.doc_role` (enrich_header) |
| `teiHeader/profileDesc/textClass/keywords/term[@type='resource_type']` | ○ | ✗ | `documents.resource_type` (enrich_header) |
| `teiHeader/profileDesc/textClass/keywords/term[@type='domain']` | ✗ | ○ | `meta_json.domain` |
| `teiHeader/profileDesc/textClass/keywords/term[@type='genre']` | ✗ | ○ | `meta_json.genre` |
| `teiHeader/profileDesc/textClass/keywords/term[@type='derivation']` | ✗ | ○ | `meta_json.derivation` / `doc_role` |
| `teiHeader/profileDesc/listRelation` | ✓ | ✓ | `doc_relations` table |
| `text/body/div/p[@xml:id]` | ✓ | ✓ | `units` (unit_type='line') |
| `text/body/div/head[@xml:id]` | ○ | ○ | `units` (unit_type='structure'), `include_structure=True` |
| `text/linkGrp[@type='alignment']` | ○ | ○ | `alignment_links`, `include_alignment=True` |
| `text/linkGrp/link[@target]` | ○ | ○ | TEI P5 cross-doc URI format |

**Legend:**
- ✓ Always emitted
- ○ Conditionally emitted (requires option or data present)
- ✗ Not emitted by this profile
- — Replaced by richer element(s)

## Feature flags

| Flag | Default | Effect |
|------|---------|--------|
| `include_structure` | `False` | Emit `<head>` for structure units |
| `include_alignment` | `False` | Emit `<linkGrp>` with alignment links |
| `enrich_header` | `False` | Add `textClass` + `listRelation` (Generic profile only) |
| `tei_profile` | `"generic"` | Select metadata profile |
| `status_filter` | `["accepted"]` | Filter alignment link statuses |

## Import validation policy (B3)

- **Blocking**: XML parse failures (`parse_error`) stop TEI import.
- **Warning-only**: referential issues reported by `validate_tei_ids` do **not** block import:
  - `broken_link_target`
  - `duplicate_xml_id`
- Import report (`warnings`) now includes a compact validation summary + actionable issue hints.

This keeps import robust on heterogeneous corpora while preserving operator visibility.

## Alignment link format (TEI P5)

```xml
<linkGrp type="alignment" corresp="doc_2.tei.xml">
  <link target="#u123 doc_2.tei.xml#u456"/>
</linkGrp>
```

- Pivot unit: internal reference `#u{unit_id}` (within same file)
- Target unit: cross-document URI `doc_{target_doc_id}.tei.xml#u{unit_id}`

## Platform compatibility

| Platform | Compatible profiles | Notes |
|----------|-------------------|-------|
| ParCoLab | `parcolab_like` | Requires `publisher`, `pubPlace`, `date`, `author` in meta_json |
| Generic TEI P5 | `generic` | Any TEI-aware reader |
| TEI Lite | `generic` | Subset compatibility |

## Compatibility fixtures (validation coverage)

| Fixture | Namespace style | Focus |
|---|---|---|
| `tests/fixtures/tei/tei_simple_div_p_s.xml` | TEI namespace | Baseline numbered `<p>` import/export |
| `tests/fixtures/tei/tei_with_head_and_xmlid.xml` | TEI namespace | `<head>` + `xml:id` preservation |
| `tests/fixtures/tei/tei_non_namespaced.xml` | no namespace | Parser/validator fallback path |
| `tests/fixtures/tei/tei_mixed_content.xml` | TEI namespace | Mixed inline content + internal refs |

## V1.6.2 additions

| Element | parcolab_strict |
|---|---|
| `<encodingDesc><appInfo>` | ✓ (agrafes/parcolab_strict) |
| `<teiHeader>` (all parcolab_like fields) | ✓ |
| Severity escalation (title/lang/date) | ✓ → error |
| `language_ori` for translations | required → error |
| `manifest.validation_summary` | ✓ (all profiles via export_tei_package) |
