-- Migration 027: target_char_start / target_char_end on alignment_links
--
-- Source-anchored alignment (docs/DESIGN_source_anchored_alignment.md §7-D9): the
-- "couper" gesture cuts a translation sentence to match the source's segmentation
-- WITHOUT mutating the translation document (Ontology 1, non-destructive). Instead of
-- splitting the target unit (which /units/split does, destroying alignment + reindexing
-- FTS), the cut is recorded on the *link* as a character sub-span of the target unit's
-- verbatim text (text_raw).
--
-- NULL / NULL = the whole target unit (the default, every existing and auto-aligned
-- link). A set pair means this link points at target_unit's text_raw[char_start:char_end].
-- A 2-1 bead cut at offset X becomes two links on the same target unit carrying
-- complementary spans [0:X] and [X:len]. The target document keeps its own sentences;
-- only the aligned-form projection slices the text. Offsets index text_raw (verbatim,
-- immutable → stable). We never cut the hub, so no pivot-side offsets are needed.

ALTER TABLE alignment_links ADD COLUMN target_char_start INTEGER;
ALTER TABLE alignment_links ADD COLUMN target_char_end   INTEGER;
