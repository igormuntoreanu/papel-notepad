# Visual QA 0.3.6

Captured by `node scripts/qa-visual.mjs` against `dist-desktop/client` (Chromium).
WebView2 portable builds should match these two fixes; add manual shots here if Edge differs.

## Fixes verified

### Alt column select

![Alt column select](./01-alt-select-wrap-stays.png)

Blue rect visible; Word Wrap stays on (no sheet-wide horizontal break).

### Toolbar after table

![Toolbar after table](./02-toolbar-after-table.png)

After focusing a table cell, text selection enables Bold and paints emphasis.

### Table at caret

![Table at caret](./03-table-at-caret.png)

After a long paste, Insert table splits at the caret — text above and below the table; viewport stays near the insert.


## Triage (evidence only)

### Triage: Ctrl+A

![Triage: Ctrl+A](./triage-ctrl-a.png)

Whole-sheet select overlay.

### Triage: wrap / align

![Triage: wrap / align](./triage-wrap-align.png)

Word wrap aria-pressed=true; alignment buttons visible in toolbar.

### Triage: header search (lupe)

![Triage: header search (lupe)](./triage-header-search.png)

Board/header search control opened from the toolbar/filters affordance.


## Harness

Also run `node scripts/verify-bugs.mjs` — includes `alt-drag-column`, `alt-drag-clears-without-wrap-off`, `toolbar-after-table-cell`.
