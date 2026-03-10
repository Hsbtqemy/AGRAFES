# Curation parity diff (mockup vs runtime)

- Total diffs: **40**
- P0: **40**, P1: **0**, P2: **0**

## Top 10 P0

| Component | Key | Property | Mockup | Runtime |
|---|---|---|---|---|
| center | `doc_scroll` | `presence` | `present` | `missing` |
| center | `minimap` | `presence` | `present` | `missing` |
| center | `minimap_mark` | `presence` | `present` | `missing` |
| center | `pane_cured` | `presence` | `present` | `missing` |
| center | `pane_head` | `presence` | `present` | `missing` |
| center | `pane_raw` | `presence` | `present` | `missing` |
| center | `preview_card` | `presence` | `present` | `missing` |
| center | `preview_controls` | `presence` | `present` | `missing` |
| center | `preview_grid` | `presence` | `present` | `missing` |
| center | `preview_head` | `presence` | `present` | `missing` |

## Exhaustive table

| Severity | Component | Key | Property | Mockup | Runtime | Impact | Selector mockup | Selector runtime |
|---|---|---|---|---|---|---|---|---|
| P0 | center | `doc_scroll` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P0 | center | `minimap` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap_mark` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .minimap .mm` | `#act-curate-minimap .mm` |
| P0 | center | `pane_cured` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P0 | center | `pane_head` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` |
| P0 | center | `pane_raw` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P0 | center | `preview_card` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P0 | center | `preview_controls` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P0 | center | `preview_grid` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P0 | center | `preview_head` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P0 | head | `head_card` | `presence` | `present` | `missing` | layout/scroll | `.head-card` | `.acts-seg-head-card` |
| P0 | head | `head_cta_longtext` | `presence` | `present` | `missing` | layout/scroll | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P0 | head | `head_pill` | `presence` | `present` | `missing` | layout/scroll | `.head-tools .pill` | `#act-curate-mode-pill` |
| P0 | head | `head_subtitle` | `presence` | `present` | `missing` | layout/scroll | `.head-card p` | `.acts-seg-head-card p` |
| P0 | head | `head_title` | `presence` | `present` | `missing` | layout/scroll | `.head-card h1` | `.acts-seg-head-card h1` |
| P0 | head | `head_tools` | `presence` | `present` | `missing` | layout/scroll | `.head-tools` | `.acts-hub-head-tools` |
| P0 | left | `actions_row` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P0 | left | `btn_apply` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P0 | left | `btn_preview` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P0 | left | `btn_reset` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P0 | left | `ctx_cell` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .row .f` | `#act-curate-ctx .f` |
| P0 | left | `ctx_row` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P0 | left | `params_card` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P0 | left | `params_head` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P0 | left | `quick_actions_card` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P0 | left | `rule_chip` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P0 | left | `rules_row` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P0 | right | `diag_card` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P0 | right | `diag_item` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right .diag` | `#act-curate-diag .curate-diag` |
| P0 | right | `diag_list` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P0 | right | `review_card` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P0 | right | `review_item` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right > article:nth-child(2) .qitem` | `#act-curate-review-log .curate-qitem, #act-curate-review-log .qitem` |
| P0 | right | `review_log` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P0 | shell | `content` | `presence` | `present` | `missing` | layout/scroll | `main.content` | `#prep-main-content > .content` |
| P0 | shell | `nav` | `presence` | `present` | `missing` | layout/scroll | `#sectionsNav` | `#prep-nav` |
| P0 | shell | `shell` | `presence` | `present` | `missing` | layout/scroll | `#shellMain` | `#prep-shell-main` |
| P0 | workspace | `col_center` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P0 | workspace | `col_left` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P0 | workspace | `col_right` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P0 | workspace | `workspace` | `presence` | `present` | `missing` | layout/scroll | `.workspace` | `#act-curate-card .curate-workspace` |

