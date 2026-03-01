# TEI Compatibility Matrix — multicorpus_engine

| Feature | Analysis (`include_structure=False`) | Structural (`include_structure=True`) | With Alignment (`include_alignment=True`) | Package ZIP |
|---------|--------------------------------------|---------------------------------------|-------------------------------------------|-------------|
| `<teiHeader>` minimal | ✅ | ✅ | ✅ | ✅ per file |
| `<title>` | ✅ | ✅ | ✅ | ✅ |
| `<language>` | ✅ | ✅ | ✅ | ✅ |
| `<source_path>` in sourceDesc | ✅ | ✅ | ✅ | ✅ |
| `<p>` line units with `xml:id` + `@n` | ✅ | ✅ | ✅ | ✅ |
| `<head>` structure units | ❌ | ✅ | ❌/✅ | depends |
| `<linkGrp type="alignment">` | ❌ | ❌ | ✅ | ✅ if align |
| `<link>` per alignment link | ❌ | ❌ | ✅ | ✅ if align |
| Status filter (accepted/all) | ❌ | ❌ | ✅ | ✅ |
| `<listRelation>` doc relations | ❌ | ❌ | ❌ | Sprint 3+ |
| `<author>` / `<date>` in teiHeader | Sprint 3+ | Sprint 3+ | Sprint 3+ | Sprint 3+ |
| `<textClass>` doc_role / resource_type | Sprint 3+ | Sprint 3+ | Sprint 3+ | Sprint 3+ |
| `manifest.json` + `checksums.txt` | ❌ | ❌ | ❌ | ✅ |
| UTF-8 declaration | ✅ | ✅ | ✅ | ✅ |
| XML 1.0 character sanitisation | ✅ | ✅ | ✅ | ✅ |
| Pretty-printed output | ✅ | ✅ | ✅ | ✅ |

## Platform Compatibility

| Platform | Import TEI | Export TEI | Package ZIP |
|----------|-----------|-----------|-------------|
| Linux (Ubuntu 22+) | ✅ | ✅ | ✅ |
| macOS (12+) | ✅ | ✅ | ✅ |
| Windows (10/11) | ✅ | ✅ | ✅ |
| ParCoLab-like tools | import ✅ | compatible | compatible |

## TEI Guidelines Reference

Export targets TEI P5 (2023+).  
Primary constructs used: `<teiHeader>`, `<body>`, `<div>`, `<p>`, `<s>`, `<head>`,
`<linkGrp>`, `<link>`, `<listRelation>`, `<relation>`.

The profile is intentionally minimal: it does not use `<ab>`, `<lg>`, `<figure>`,
or any module beyond TEI Analysis.
