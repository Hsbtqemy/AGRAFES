# CQL Interop Feasibility — NoSketchEngine / IMS CWB

Date: 2026-04-09

## Scope
- Evaluate import feasibility for corpora coming from NoSketchEngine or IMS CWB.
- Focus on practical interoperability for AGRAFES token model (`documents` + `units` + `tokens`).

## Findings
- Direct import of **compiled** CWB binary indexes is not realistic in a stable, low-risk MVP:
  - internal binary layouts are engine-specific and version-sensitive.
  - no robust Python-native reader in current stack.
- The reliable interop path is via **exported tabular/vertical text**:
  - CWB vertical-like streams (token-per-line + structural tags)
  - Sketch Engine / NoSketchEngine exports that preserve token columns.

## Decision
- Do **not** implement direct “compiled corpus” import in Sprint E.
- Keep Sprint E interop as:
  - AGRAFES export (`.ske` vertical profile) for outward compatibility.
  - future inbound import through textual interchange formats (vertical/CoNLL-U/CSV token streams), not binary CWB internals.

## Risks
- Metadata loss risk if third-party exports omit sentence/unit boundaries.
- POS/tagset drift across tools (`upos` vs tool-specific tags).

## Recommended next step
- Add a dedicated importer for vertical text profile (future Sprint):
  - parse `<doc>/<s>` tags + token columns,
  - map columns to `word/lemma/upos/xpos/feats`,
  - fallback to `_` for missing attributes.
