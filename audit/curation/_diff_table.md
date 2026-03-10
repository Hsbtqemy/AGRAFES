# Curation parity diff (mockup vs runtime)

- Total diffs: **278**
- P0: **122**, P1: **140**, P2: **16**

## Top 10 P0

| Component | Key | Property | Mockup | Runtime |
|---|---|---|---|---|
| center | `doc_scroll` | `css.minHeight` | `0px` | `400px` |
| center | `doc_scroll` | `rect.h` | `560` | `400` |
| center | `doc_scroll` | `rect.w` | `286` | `304.50` |
| center | `minimap` | `css.gridTemplateColumns` | `10px` | `14px` |
| center | `minimap` | `css.gridTemplateRows` | `12px 12px 12px 12px 12px 12px 12px 12px 12px 12px 12px 12px` | `12px 12px 12px` |
| center | `minimap` | `css.minHeight` | `auto` | `0px` |
| center | `minimap` | `css.overflow` | `visible` | `hidden` |
| center | `minimap` | `css.overflowY` | `visible` | `hidden` |
| center | `minimap` | `rect.h` | `593` | `430` |
| center | `minimap` | `rect.w` | `22` | `26` |

## Exhaustive table

| Severity | Component | Key | Property | Mockup | Runtime | Impact | Selector mockup | Selector runtime |
|---|---|---|---|---|---|---|---|---|
| P0 | center | `doc_scroll` | `css.minHeight` | `0px` | `400px` | layout/scroll | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P0 | center | `doc_scroll` | `rect.h` | `560` | `400` | layout/scroll | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P0 | center | `doc_scroll` | `rect.w` | `286` | `304.50` | layout/scroll | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P0 | center | `minimap` | `css.gridTemplateColumns` | `10px` | `14px` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap` | `css.gridTemplateRows` | `12px 12px 12px 12px 12px 12px 12px 12px 12px 12px 12px 12px` | `12px 12px 12px` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap` | `css.overflow` | `visible` | `hidden` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap` | `css.overflowY` | `visible` | `hidden` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap` | `rect.h` | `593` | `430` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap` | `rect.w` | `22` | `26` | layout/scroll | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P0 | center | `minimap_mark` | `rect.w` | `10` | `14` | layout/scroll | `.workspace .col.center .minimap .mm` | `#act-curate-minimap .mm` |
| P0 | center | `pane_cured` | `css.gridTemplateRows` | `none` | `auto 1fr` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P0 | center | `pane_cured` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P0 | center | `pane_cured` | `rect.h` | `593` | `430` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P0 | center | `pane_cured` | `rect.w` | `288` | `306.50` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P0 | center | `pane_head` | `rect.h` | `31` | `28` | layout/scroll | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` |
| P0 | center | `pane_head` | `rect.w` | `286` | `304.50` | layout/scroll | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` |
| P0 | center | `pane_raw` | `css.gridTemplateRows` | `none` | `auto 1fr` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P0 | center | `pane_raw` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P0 | center | `pane_raw` | `rect.h` | `593` | `430` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P0 | center | `pane_raw` | `rect.w` | `288` | `306.50` | layout/scroll | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P0 | center | `preview_card` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P0 | center | `preview_card` | `css.overflow` | `hidden` | `visible` | layout/scroll | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P0 | center | `preview_card` | `css.overflowY` | `hidden` | `visible` | layout/scroll | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P0 | center | `preview_card` | `rect.h` | `694` | `549` | layout/scroll | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P0 | center | `preview_card` | `rect.w` | `640` | `679` | layout/scroll | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P0 | center | `preview_controls` | `rect.h` | `42` | `38` | layout/scroll | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P0 | center | `preview_controls` | `rect.w` | `638` | `679` | layout/scroll | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P0 | center | `preview_grid` | `css.gridTemplateColumns` | `288px 288px 22px` | `306.5px 306.5px 26px` | layout/scroll | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P0 | center | `preview_grid` | `css.gridTemplateRows` | `593px` | `430px` | layout/scroll | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P0 | center | `preview_grid` | `rect.h` | `613` | `450` | layout/scroll | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P0 | center | `preview_grid` | `rect.w` | `638` | `679` | layout/scroll | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P0 | center | `preview_head` | `rect.w` | `638` | `679` | layout/scroll | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P0 | head | `head_card` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.head-card` | `.acts-seg-head-card` |
| P0 | head | `head_card` | `css.overflow` | `hidden` | `visible` | layout/scroll | `.head-card` | `.acts-seg-head-card` |
| P0 | head | `head_card` | `css.overflowY` | `hidden` | `visible` | layout/scroll | `.head-card` | `.acts-seg-head-card` |
| P0 | head | `head_card` | `rect.h` | `87` | `71.55` | layout/scroll | `.head-card` | `.acts-seg-head-card` |
| P0 | head | `head_card` | `rect.w` | `1294` | `1174.81` | layout/scroll | `.head-card` | `.acts-seg-head-card` |
| P0 | head | `head_cta_longtext` | `rect.w` | `163.17` | `160.22` | layout/scroll | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P0 | head | `head_pill` | `rect.w` | `123.80` | `90.42` | layout/scroll | `.head-tools .pill` | `#act-curate-mode-pill` |
| P0 | head | `head_subtitle` | `rect.h` | `30` | `18.55` | layout/scroll | `.head-card p` | `.acts-seg-head-card p` |
| P0 | head | `head_subtitle` | `rect.w` | `632.31` | `571.84` | layout/scroll | `.head-card p` | `.acts-seg-head-card p` |
| P0 | head | `head_title` | `rect.w` | `632.31` | `571.84` | layout/scroll | `.head-card h1` | `.acts-seg-head-card h1` |
| P0 | head | `head_tools` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.head-tools` | `.acts-hub-head-tools` |
| P0 | head | `head_tools` | `rect.h` | `61` | `0` | layout/scroll | `.head-tools` | `.acts-hub-head-tools` |
| P0 | head | `head_tools` | `rect.w` | `625.69` | `0` | layout/scroll | `.head-tools` | `.acts-hub-head-tools` |
| P0 | left | `actions_row` | `rect.h` | `74` | `68` | layout/scroll | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P0 | left | `actions_row` | `rect.w` | `284` | `289` | layout/scroll | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P0 | left | `advanced_panel` | `presence` | `missing` | `present` | layout/scroll | `.workspace .col.left > article:first-child + article details` | `#act-curate-advanced` |
| P0 | left | `btn_apply` | `rect.h` | `33` | `31` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P0 | left | `btn_apply` | `rect.w` | `137.56` | `133.62` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P0 | left | `btn_preview` | `rect.h` | `33` | `31` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P0 | left | `btn_preview` | `rect.w` | `175.91` | `172.92` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P0 | left | `btn_reset` | `rect.h` | `33` | `31` | layout/scroll | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P0 | left | `ctx_cell` | `rect.h` | `50` | `52` | layout/scroll | `.workspace .col.left > article:first-child .row .f` | `#act-curate-ctx .f` |
| P0 | left | `ctx_cell` | `rect.w` | `138` | `141.50` | layout/scroll | `.workspace .col.left > article:first-child .row .f` | `#act-curate-ctx .f` |
| P0 | left | `ctx_row` | `css.gridTemplateColumns` | `138px 138px` | `141.5px 141.5px` | layout/scroll | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P0 | left | `ctx_row` | `css.gridTemplateRows` | `50px 50px` | `52px 52px` | layout/scroll | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P0 | left | `ctx_row` | `rect.h` | `108` | `110` | layout/scroll | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P0 | left | `ctx_row` | `rect.w` | `284` | `289` | layout/scroll | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P0 | left | `doc_select` | `presence` | `missing` | `present` | layout/scroll | `.workspace .col.left > article:first-child select` | `#act-curate-doc` |
| P0 | left | `params_card` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P0 | left | `params_card` | `css.overflow` | `hidden` | `visible` | layout/scroll | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P0 | left | `params_card` | `css.overflowY` | `hidden` | `visible` | layout/scroll | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P0 | left | `params_card` | `rect.h` | `336` | `404` | layout/scroll | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P0 | left | `params_head` | `rect.h` | `37` | `34` | layout/scroll | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P0 | left | `quick_actions_card` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P0 | left | `quick_actions_card` | `css.overflow` | `hidden` | `visible` | layout/scroll | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P0 | left | `quick_actions_card` | `css.overflowY` | `hidden` | `visible` | layout/scroll | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P0 | left | `quick_actions_card` | `rect.h` | `283` | `139` | layout/scroll | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P0 | left | `rule_chip` | `rect.w` | `128.06` | `138.09` | layout/scroll | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P0 | left | `rules_row` | `css.position` | `static` | `relative` | layout/scroll | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P0 | left | `rules_row` | `rect.h` | `75` | `99` | layout/scroll | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P0 | left | `rules_row` | `rect.w` | `284` | `289` | layout/scroll | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P0 | right | `diag_card` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P0 | right | `diag_card` | `css.overflow` | `hidden` | `visible` | layout/scroll | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P0 | right | `diag_card` | `css.overflowY` | `hidden` | `visible` | layout/scroll | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P0 | right | `diag_card` | `rect.h` | `251` | `127` | layout/scroll | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P0 | right | `diag_item` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right .diag` | `#act-curate-diag .curate-diag` |
| P0 | right | `diag_list` | `css.gridTemplateColumns` | `294px` | `296px` | layout/scroll | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P0 | right | `diag_list` | `css.gridTemplateRows` | `48px 62px 62px` | `70px` | layout/scroll | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P0 | right | `diag_list` | `rect.h` | `212` | `70` | layout/scroll | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P0 | right | `diag_list` | `rect.w` | `318` | `296` | layout/scroll | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P0 | right | `review_card` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P0 | right | `review_card` | `css.overflow` | `hidden` | `visible` | layout/scroll | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P0 | right | `review_card` | `css.overflowY` | `hidden` | `visible` | layout/scroll | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P0 | right | `review_card` | `rect.h` | `247` | `95` | layout/scroll | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P0 | right | `review_item` | `presence` | `present` | `missing` | layout/scroll | `.workspace .col.right > article:nth-child(2) .qitem` | `#act-curate-review-log .curate-qitem, #act-curate-review-log .qitem` |
| P0 | right | `review_log` | `css.gridTemplateColumns` | `294px` | `320px` | layout/scroll | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P0 | right | `review_log` | `css.gridTemplateRows` | `30px 30px 30px` | `59px` | layout/scroll | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P0 | right | `review_log` | `rect.h` | `102` | `59` | layout/scroll | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P0 | right | `review_log` | `rect.w` | `294` | `320` | layout/scroll | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P0 | shell | `content` | `css.gridTemplateColumns` | `1294px` | `none` | layout/scroll | `main.content` | `#prep-main-content > .content` |
| P0 | shell | `content` | `css.gridTemplateRows` | `87px 694px` | `none` | layout/scroll | `main.content` | `#prep-main-content > .content` |
| P0 | shell | `content` | `css.minHeight` | `auto` | `0px` | layout/scroll | `main.content` | `#prep-main-content > .content` |
| P0 | shell | `content` | `rect.h` | `846` | `1088.69` | layout/scroll | `main.content` | `#prep-main-content > .content` |
| P0 | shell | `content` | `rect.w` | `1322` | `1210` | layout/scroll | `main.content` | `#prep-main-content > .content` |
| P0 | shell | `nav` | `css.overflow` | `visible` | `auto` | layout/scroll | `#sectionsNav` | `#prep-nav` |
| P0 | shell | `nav` | `css.overflowY` | `visible` | `auto` | layout/scroll | `#sectionsNav` | `#prep-nav` |
| P0 | shell | `nav` | `rect.h` | `846` | `1088.69` | layout/scroll | `#sectionsNav` | `#prep-nav` |
| P0 | shell | `shell` | `css.gridTemplateColumns` | `230px 1322px` | `230px 1210px` | layout/scroll | `#shellMain` | `#prep-shell-main` |
| P0 | shell | `shell` | `css.gridTemplateRows` | `846px` | `1088.69px` | layout/scroll | `#shellMain` | `#prep-shell-main` |
| P0 | shell | `shell` | `css.position` | `static` | `relative` | layout/scroll | `#shellMain` | `#prep-shell-main` |
| P0 | shell | `shell` | `rect.h` | `846` | `1088.69` | layout/scroll | `#shellMain` | `#prep-shell-main` |
| P0 | workspace | `col_center` | `css.gridTemplateColumns` | `640px` | `none` | layout/scroll | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P0 | workspace | `col_center` | `css.gridTemplateRows` | `694px` | `none` | layout/scroll | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P0 | workspace | `col_center` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P0 | workspace | `col_center` | `rect.h` | `694` | `549` | layout/scroll | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P0 | workspace | `col_center` | `rect.w` | `640` | `680` | layout/scroll | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P0 | workspace | `col_left` | `css.gridTemplateColumns` | `310px` | `none` | layout/scroll | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P0 | workspace | `col_left` | `css.gridTemplateRows` | `336px 283px` | `none` | layout/scroll | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P0 | workspace | `col_left` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P0 | workspace | `col_left` | `rect.h` | `629` | `598` | layout/scroll | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P0 | workspace | `col_right` | `css.gridTemplateColumns` | `320px` | `none` | layout/scroll | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P0 | workspace | `col_right` | `css.gridTemplateRows` | `251px 247px` | `none` | layout/scroll | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P0 | workspace | `col_right` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P0 | workspace | `col_right` | `rect.h` | `508` | `222` | layout/scroll | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P0 | workspace | `workspace` | `css.gridTemplateColumns` | `310px 640px 320px` | `310px 680px 320px` | layout/scroll | `.workspace` | `#act-curate-card .curate-workspace` |
| P0 | workspace | `workspace` | `css.gridTemplateRows` | `694px` | `598px` | layout/scroll | `.workspace` | `#act-curate-card .curate-workspace` |
| P0 | workspace | `workspace` | `css.minHeight` | `auto` | `0px` | layout/scroll | `.workspace` | `#act-curate-card .curate-workspace` |
| P0 | workspace | `workspace` | `rect.h` | `694` | `598` | layout/scroll | `.workspace` | `#act-curate-card .curate-workspace` |
| P0 | workspace | `workspace` | `rect.w` | `1294` | `1172.81` | layout/scroll | `.workspace` | `#act-curate-card .curate-workspace` |
| P1 | center | `doc_scroll` | `css.height` | `560px` | `400px` | densité/hiérarchie | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P1 | center | `doc_scroll` | `css.padding` | `10px` | `8px 10px` | densité/hiérarchie | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P1 | center | `doc_scroll` | `css.width` | `286px` | `304.5px` | densité/hiérarchie | `.workspace .col.center .doc-scroll` | `#act-preview-panel .doc-scroll` |
| P1 | center | `minimap` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P1 | center | `minimap` | `css.height` | `593px` | `430px` | densité/hiérarchie | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P1 | center | `minimap` | `css.width` | `22px` | `26px` | densité/hiérarchie | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P1 | center | `minimap_mark` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .minimap .mm` | `#act-curate-minimap .mm` |
| P1 | center | `minimap_mark` | `css.width` | `10px` | `14px` | densité/hiérarchie | `.workspace .col.center .minimap .mm` | `#act-curate-minimap .mm` |
| P1 | center | `pane_cured` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P1 | center | `pane_cured` | `css.height` | `593px` | `430px` | densité/hiérarchie | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P1 | center | `pane_cured` | `css.width` | `288px` | `306.5px` | densité/hiérarchie | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P1 | center | `pane_head` | `css.height` | `31px` | `28px` | densité/hiérarchie | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` |
| P1 | center | `pane_head` | `css.padding` | `8px 10px` | `6px 10px` | densité/hiérarchie | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` |
| P1 | center | `pane_head` | `css.width` | `286px` | `304.5px` | densité/hiérarchie | `.workspace .col.center .pane-head` | `#act-preview-panel .pane-head` |
| P1 | center | `pane_raw` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P1 | center | `pane_raw` | `css.height` | `593px` | `430px` | densité/hiérarchie | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P1 | center | `pane_raw` | `css.width` | `288px` | `306.5px` | densité/hiérarchie | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P1 | center | `preview_card` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P1 | center | `preview_card` | `css.height` | `694px` | `549px` | densité/hiérarchie | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P1 | center | `preview_card` | `css.width` | `640px` | `679px` | densité/hiérarchie | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P1 | center | `preview_controls` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P1 | center | `preview_controls` | `css.gap` | `8px` | `6px 10px` | densité/hiérarchie | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P1 | center | `preview_controls` | `css.height` | `42px` | `38px` | densité/hiérarchie | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P1 | center | `preview_controls` | `css.padding` | `10px 12px` | `8px 12px` | densité/hiérarchie | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P1 | center | `preview_controls` | `css.width` | `638px` | `679px` | densité/hiérarchie | `.workspace .col.center .preview-controls` | `#act-preview-panel .preview-controls` |
| P1 | center | `preview_grid` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P1 | center | `preview_grid` | `css.height` | `613px` | `450px` | densité/hiérarchie | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P1 | center | `preview_grid` | `css.width` | `638px` | `679px` | densité/hiérarchie | `.workspace .col.center .preview-grid` | `#act-preview-panel .preview-grid` |
| P1 | center | `preview_head` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P1 | center | `preview_head` | `css.gap` | `normal` | `8px` | densité/hiérarchie | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P1 | center | `preview_head` | `css.height` | `37px` | `36px` | densité/hiérarchie | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P1 | center | `preview_head` | `css.padding` | `10px 12px` | `9px 12px` | densité/hiérarchie | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P1 | center | `preview_head` | `css.width` | `638px` | `679px` | densité/hiérarchie | `.workspace .col.center .preview-card .card-head` | `#act-preview-panel .card-head` |
| P1 | head | `head_card` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.head-card` | `.acts-seg-head-card` |
| P1 | head | `head_card` | `css.gap` | `10px` | `20px` | densité/hiérarchie | `.head-card` | `.acts-seg-head-card` |
| P1 | head | `head_card` | `css.height` | `87px` | `71.5469px` | densité/hiérarchie | `.head-card` | `.acts-seg-head-card` |
| P1 | head | `head_card` | `css.margin` | `0px` | `0px 0px 14px` | densité/hiérarchie | `.head-card` | `.acts-seg-head-card` |
| P1 | head | `head_card` | `css.padding` | `12px` | `14px 18px` | densité/hiérarchie | `.head-card` | `.acts-seg-head-card` |
| P1 | head | `head_card` | `css.width` | `1294px` | `1174.81px` | densité/hiérarchie | `.head-card` | `.acts-seg-head-card` |
| P1 | head | `head_cta_longtext` | `css.fontSize` | `12px` | `12.48px` | densité/hiérarchie | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P1 | head | `head_cta_longtext` | `css.height` | `24px` | `25px` | densité/hiérarchie | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P1 | head | `head_cta_longtext` | `css.padding` | `4px 9px` | `4px 11px` | densité/hiérarchie | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P1 | head | `head_cta_longtext` | `css.width` | `163.172px` | `160.219px` | densité/hiérarchie | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P1 | head | `head_pill` | `css.padding` | `3px 8px` | `3px 10px` | densité/hiérarchie | `.head-tools .pill` | `#act-curate-mode-pill` |
| P1 | head | `head_pill` | `css.width` | `123.797px` | `90.4219px` | densité/hiérarchie | `.head-tools .pill` | `#act-curate-mode-pill` |
| P1 | head | `head_subtitle` | `css.fontSize` | `13px` | `12.8px` | densité/hiérarchie | `.head-card p` | `.acts-seg-head-card p` |
| P1 | head | `head_subtitle` | `css.height` | `30px` | `18.5469px` | densité/hiérarchie | `.head-card p` | `.acts-seg-head-card p` |
| P1 | head | `head_subtitle` | `css.lineHeight` | `normal` | `18.56px` | densité/hiérarchie | `.head-card p` | `.acts-seg-head-card p` |
| P1 | head | `head_subtitle` | `css.margin` | `5px 0px 0px` | `0px` | densité/hiérarchie | `.head-card p` | `.acts-seg-head-card p` |
| P1 | head | `head_subtitle` | `css.width` | `632.312px` | `571.844px` | densité/hiérarchie | `.head-card p` | `.acts-seg-head-card p` |
| P1 | head | `head_title` | `css.fontSize` | `18px` | `16.8px` | densité/hiérarchie | `.head-card h1` | `.acts-seg-head-card h1` |
| P1 | head | `head_title` | `css.height` | `21px` | `20px` | densité/hiérarchie | `.head-card h1` | `.acts-seg-head-card h1` |
| P1 | head | `head_title` | `css.margin` | `0px` | `0px 0px 3px` | densité/hiérarchie | `.head-card h1` | `.acts-seg-head-card h1` |
| P1 | head | `head_title` | `css.width` | `632.312px` | `571.844px` | densité/hiérarchie | `.head-card h1` | `.acts-seg-head-card h1` |
| P1 | head | `head_tools` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.head-tools` | `.acts-hub-head-tools` |
| P1 | head | `head_tools` | `css.gap` | `8px` | `6px` | densité/hiérarchie | `.head-tools` | `.acts-hub-head-tools` |
| P1 | head | `head_tools` | `css.height` | `61px` | `auto` | densité/hiérarchie | `.head-tools` | `.acts-hub-head-tools` |
| P1 | head | `head_tools` | `css.width` | `625.688px` | `auto` | densité/hiérarchie | `.head-tools` | `.acts-hub-head-tools` |
| P1 | left | `actions_row` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P1 | left | `actions_row` | `css.gap` | `8px` | `6px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P1 | left | `actions_row` | `css.height` | `74px` | `68px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P1 | left | `actions_row` | `css.width` | `284px` | `289px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns` | `#act-curate-card .curate-primary-actions` |
| P1 | left | `btn_apply` | `css.fontSize` | `13px` | `13.6px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P1 | left | `btn_apply` | `css.fontWeight` | `600` | `500` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P1 | left | `btn_apply` | `css.height` | `33px` | `31px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P1 | left | `btn_apply` | `css.padding` | `8px 10px` | `7px 11px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P1 | left | `btn_apply` | `css.width` | `137.562px` | `133.625px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.pri` | `#act-curate-btn` |
| P1 | left | `btn_preview` | `css.fontSize` | `13px` | `13.6px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P1 | left | `btn_preview` | `css.fontWeight` | `600` | `500` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P1 | left | `btn_preview` | `css.height` | `33px` | `31px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P1 | left | `btn_preview` | `css.padding` | `8px 10px` | `7px 11px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P1 | left | `btn_preview` | `css.width` | `175.906px` | `172.922px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn.alt` | `#act-preview-btn` |
| P1 | left | `btn_reset` | `css.fontSize` | `13px` | `13.6px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P1 | left | `btn_reset` | `css.fontWeight` | `600` | `500` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P1 | left | `btn_reset` | `css.height` | `33px` | `31px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P1 | left | `btn_reset` | `css.padding` | `8px 10px` | `7px 11px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P1 | left | `btn_reset` | `css.width` | `95.7031px` | `94.2969px` | densité/hiérarchie | `.workspace .col.left > article:first-child .btns .btn:not(.alt):not(.pri)` | `#act-curate-reset-btn` |
| P1 | left | `ctx_cell` | `css.height` | `50px` | `52px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row .f` | `#act-curate-ctx .f` |
| P1 | left | `ctx_cell` | `css.width` | `138px` | `141.5px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row .f` | `#act-curate-ctx .f` |
| P1 | left | `ctx_row` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P1 | left | `ctx_row` | `css.gap` | `8px` | `6px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P1 | left | `ctx_row` | `css.height` | `108px` | `110px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P1 | left | `ctx_row` | `css.margin` | `0px` | `6px 0px 10px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P1 | left | `ctx_row` | `css.width` | `284px` | `289px` | densité/hiérarchie | `.workspace .col.left > article:first-child .row` | `#act-curate-ctx` |
| P1 | left | `params_card` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P1 | left | `params_card` | `css.height` | `336px` | `404px` | densité/hiérarchie | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P1 | left | `params_card` | `css.width` | `310px` | `309px` | densité/hiérarchie | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P1 | left | `params_head` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P1 | left | `params_head` | `css.gap` | `normal` | `8px` | densité/hiérarchie | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P1 | left | `params_head` | `css.height` | `37px` | `34px` | densité/hiérarchie | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P1 | left | `params_head` | `css.padding` | `10px 12px` | `8px 10px` | densité/hiérarchie | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P1 | left | `params_head` | `css.width` | `308px` | `309px` | densité/hiérarchie | `.workspace .col.left > article:first-child .card-head` | `#act-curate-card .curate-col-left > article:first-child .card-head` |
| P1 | left | `quick_actions_card` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P1 | left | `quick_actions_card` | `css.height` | `283px` | `139px` | densité/hiérarchie | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P1 | left | `quick_actions_card` | `css.margin` | `0px` | `10px 0px 0px` | densité/hiérarchie | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P1 | left | `quick_actions_card` | `css.width` | `310px` | `309px` | densité/hiérarchie | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P1 | left | `rule_chip` | `css.fontSize` | `11px` | `11.5px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P1 | left | `rule_chip` | `css.fontWeight` | `700` | `600` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P1 | left | `rule_chip` | `css.gap` | `normal` | `3px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P1 | left | `rule_chip` | `css.margin` | `0px` | `0px 0px 8px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P1 | left | `rule_chip` | `css.width` | `128.062px` | `138.094px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P1 | left | `rules_row` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P1 | left | `rules_row` | `css.height` | `75px` | `99px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P1 | left | `rules_row` | `css.margin` | `8px 0px 0px` | `0px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P1 | left | `rules_row` | `css.width` | `284px` | `289px` | densité/hiérarchie | `.workspace .col.left > article:first-child .chip-row` | `#act-curate-card .curation-quick-rules` |
| P1 | right | `diag_card` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P1 | right | `diag_card` | `css.height` | `251px` | `127px` | densité/hiérarchie | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P1 | right | `diag_list` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P1 | right | `diag_list` | `css.height` | `212px` | `70px` | densité/hiérarchie | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P1 | right | `diag_list` | `css.padding` | `12px` | `0px` | densité/hiérarchie | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P1 | right | `diag_list` | `css.width` | `318px` | `296px` | densité/hiérarchie | `.workspace .col.right .diag-list` | `#act-curate-diag` |
| P1 | right | `review_card` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P1 | right | `review_card` | `css.height` | `247px` | `95px` | densité/hiérarchie | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P1 | right | `review_log` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P1 | right | `review_log` | `css.gap` | `6px` | `0px` | densité/hiérarchie | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P1 | right | `review_log` | `css.height` | `102px` | `59px` | densité/hiérarchie | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P1 | right | `review_log` | `css.width` | `294px` | `320px` | densité/hiérarchie | `.workspace .col.right > article:nth-child(2) .queue` | `#act-curate-review-log` |
| P1 | shell | `content` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `main.content` | `#prep-main-content > .content` |
| P1 | shell | `content` | `css.gap` | `12px` | `normal` | densité/hiérarchie | `main.content` | `#prep-main-content > .content` |
| P1 | shell | `content` | `css.height` | `846px` | `1088.69px` | densité/hiérarchie | `main.content` | `#prep-main-content > .content` |
| P1 | shell | `content` | `css.padding` | `14px` | `16px 17.6px 20px` | densité/hiérarchie | `main.content` | `#prep-main-content > .content` |
| P1 | shell | `content` | `css.width` | `1322px` | `1210px` | densité/hiérarchie | `main.content` | `#prep-main-content > .content` |
| P1 | shell | `nav` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `#sectionsNav` | `#prep-nav` |
| P1 | shell | `nav` | `css.height` | `846px` | `1088.69px` | densité/hiérarchie | `#sectionsNav` | `#prep-nav` |
| P1 | shell | `shell` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `#shellMain` | `#prep-shell-main` |
| P1 | shell | `shell` | `css.height` | `846px` | `1088.69px` | densité/hiérarchie | `#shellMain` | `#prep-shell-main` |
| P1 | workspace | `col_center` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P1 | workspace | `col_center` | `css.gap` | `10px` | `normal` | densité/hiérarchie | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P1 | workspace | `col_center` | `css.height` | `694px` | `549px` | densité/hiérarchie | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P1 | workspace | `col_center` | `css.width` | `640px` | `680px` | densité/hiérarchie | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P1 | workspace | `col_left` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P1 | workspace | `col_left` | `css.gap` | `10px` | `normal` | densité/hiérarchie | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P1 | workspace | `col_left` | `css.height` | `629px` | `598px` | densité/hiérarchie | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P1 | workspace | `col_right` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P1 | workspace | `col_right` | `css.gap` | `10px` | `normal` | densité/hiérarchie | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P1 | workspace | `col_right` | `css.height` | `508px` | `222px` | densité/hiérarchie | `.workspace .col.right` | `#act-curate-card .curate-col-right` |
| P1 | workspace | `workspace` | `css.fontSize` | `16px` | `14px` | densité/hiérarchie | `.workspace` | `#act-curate-card .curate-workspace` |
| P1 | workspace | `workspace` | `css.gap` | `12px` | `0px` | densité/hiérarchie | `.workspace` | `#act-curate-card .curate-workspace` |
| P1 | workspace | `workspace` | `css.height` | `694px` | `598px` | densité/hiérarchie | `.workspace` | `#act-curate-card .curate-workspace` |
| P1 | workspace | `workspace` | `css.width` | `1294px` | `1172.81px` | densité/hiérarchie | `.workspace` | `#act-curate-card .curate-workspace` |
| P2 | center | `minimap` | `css.borderRadius` | `10px` | `8px` | cosmétique | `.workspace .col.center .minimap` | `#act-curate-minimap` |
| P2 | center | `pane_cured` | `css.borderRadius` | `10px` | `8px` | cosmétique | `.workspace .col.center .preview-grid .pane:nth-child(2)` | `#act-preview-panel .preview-grid .pane:nth-child(2)` |
| P2 | center | `pane_raw` | `css.borderRadius` | `10px` | `8px` | cosmétique | `.workspace .col.center .preview-grid .pane:nth-child(1)` | `#act-preview-panel .preview-grid .pane:nth-child(1)` |
| P2 | center | `preview_card` | `css.borderRadius` | `12px` | `0px` | cosmétique | `.workspace .col.center .preview-card` | `#act-preview-panel` |
| P2 | head | `head_card` | `css.borderRadius` | `12px` | `8px` | cosmétique | `.head-card` | `.acts-seg-head-card` |
| P2 | head | `head_cta_longtext` | `css.borderRadius` | `999px` | `4px` | cosmétique | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P2 | head | `head_cta_longtext` | `css.display` | `block` | `flex` | cosmétique | `.head-tools a[href*='prep-actions-longtext-vnext.html']` | `#act-curate-lt-cta` |
| P2 | left | `params_card` | `css.borderRadius` | `12px` | `0px` | cosmétique | `.workspace .col.left > article:first-child` | `#act-curate-card .curate-col-left > article:first-child` |
| P2 | left | `quick_actions_card` | `css.borderRadius` | `12px` | `0px` | cosmétique | `.workspace .col.left > article:nth-child(2)` | `#act-curate-quick-actions` |
| P2 | left | `rule_chip` | `css.display` | `block` | `flex` | cosmétique | `.workspace .col.left > article:first-child .chip-row .chip` | `#act-curate-card .curation-quick-rules .curation-chip` |
| P2 | right | `diag_card` | `css.borderRadius` | `12px` | `0px` | cosmétique | `.workspace .col.right > article:first-child` | `#act-curate-card .curate-col-right > article:first-child` |
| P2 | right | `review_card` | `css.borderRadius` | `12px` | `0px` | cosmétique | `.workspace .col.right > article:nth-child(2)` | `#act-curate-card .curate-col-right > article:nth-child(2)` |
| P2 | shell | `content` | `css.display` | `grid` | `block` | cosmétique | `main.content` | `#prep-main-content > .content` |
| P2 | workspace | `col_center` | `css.display` | `grid` | `block` | cosmétique | `.workspace .col.center` | `#act-curate-card .curate-col-center` |
| P2 | workspace | `col_left` | `css.display` | `grid` | `block` | cosmétique | `.workspace .col.left` | `#act-curate-card .curate-col-left` |
| P2 | workspace | `col_right` | `css.display` | `grid` | `block` | cosmétique | `.workspace .col.right` | `#act-curate-card .curate-col-right` |

