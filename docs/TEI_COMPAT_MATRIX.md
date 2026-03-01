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
