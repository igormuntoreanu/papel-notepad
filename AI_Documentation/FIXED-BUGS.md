# Fixed bugs

Before shipping any change, re-run every guard listed in this file (`node scripts/verify-bugs.mjs`, and the unit tests named on each entry). Do not break an already-fixed issue. When a bug is fixed, add a new entry here in the same shape.

Guards live in `scripts/verify-bugs.mjs` unless a unit test is named. Build `dist-desktop/client` first (`npm run build:desktop`) before the Playwright script.

## FB-01 — Ctrl+A selects the whole sheet

- **Severity:** medium
- **Fixed in:** 0.3.2
- **Symptom:** Ctrl+A selected only the focused text block, so a table between blocks was left out.
- **Repro:** Put text, a table, and more text on one sheet. Click the first text. Press Ctrl+A.
- **Root cause:** The textarea's native select-all stopped at that block.
- **Fix:** Ctrl+A calls `onSelectAll` and paints every text block. `src/components/quire/text-block.tsx`.
- **Guards:** `ctrl-a-whole-sheet`

## FB-02 — Marks apply on the first mouse selection

- **Severity:** medium
- **Fixed in:** 0.3.2
- **Symptom:** Bold did nothing on a fresh mouse selection; it used the previous range.
- **Repro:** Drag across a word and click Bold, six times in a row, undoing between tries.
- **Root cause:** The toolbar read React selection state from the previous tick.
- **Fix:** `liveSelection()` reads the focused textarea. `src/components/quire/quire-app.tsx`.
- **Guards:** `marks-reliable`

## FB-03 — List caret after a level-3 marker

- **Severity:** medium
- **Fixed in:** 0.3.2
- **Symptom:** After Enter and Tab down to `1.1.2)`, the next character landed in the wrong place.
- **Repro:** Type `1) a`, then Enter, `b`, Tab, Enter, `c`, Tab, Enter, `X`.
- **Root cause:** Renumbering rewrote the marker after the caret had been placed.
- **Fix:** Place the caret from the new line after renumber. `src/components/quire/text-block.tsx`, `src/lib/quire/lists.ts`.
- **Guards:** `list-caret-level-3`

## FB-04 — Alt-drag keeps word wrap

- **Severity:** medium
- **Fixed in:** 0.3.3
- **Symptom:** Alt-drag column select turned word wrap off for the whole sheet. Escape left it off.
- **Repro:** Turn Word wrap on. Hold Alt and drag a rectangle across two wrapped lines. Press Escape.
- **Root cause:** Column layout was stored as the sheet's wrap flag.
- **Fix:** Column select unwraps only that block. Escape clears the rectangle and leaves wrap on. `src/components/quire/text-block.tsx`.
- **Guards:** `alt-drag-column`, `alt-drag-clears-without-wrap-off`

## FB-05 — Alignment stays available with wrap on

- **Severity:** low
- **Fixed in:** 0.3.2
- **Symptom:** Align left / centre / right disappeared while Word wrap was on.
- **Repro:** Open a sheet with Word wrap on and look at the toolbar.
- **Root cause:** The buttons were rendered only when wrap was off.
- **Fix:** Show them whenever a text block is active. `src/components/quire/sheet.tsx`.
- **Guards:** `alignment-with-wrap`

## FB-06 — Table actions live on the right-click menu

- **Severity:** low
- **Fixed in:** 0.3.2
- **Symptom:** A floating table toolbar covered the cell, or the row/column commands were missing.
- **Repro:** Focus a table cell. Right-click the table.
- **Root cause:** A separate `.table-tools` overlay duplicated the menu.
- **Fix:** Remove the overlay. The cell menu inserts and deletes rows, columns, and the table. `src/components/quire/table-block.tsx`.
- **Guards:** `table-right-click-only`

## FB-07 — Toolbar works after a table cell

- **Severity:** medium
- **Fixed in:** 0.3.3
- **Symptom:** After editing a table cell, selecting sheet text left Bold disabled.
- **Repro:** Click a table cell, then drag across a word in the sheet and click Bold.
- **Root cause:** A stale cell target still owned the style commands.
- **Fix:** A focused text editor wins over the last cell. `src/components/quire/quire-app.tsx`.
- **Guards:** `toolbar-after-table-cell`

## FB-08 — Find highlight and header search

- **Severity:** low
- **Fixed in:** 0.3.2
- **Symptom:** Find matches were not the yellow mark, or the header search field did not open.
- **Repro:** Open Find, type a word that is on the sheet. Then open Search and filters in the header.
- **Root cause:** The hit colour and the header field were not wired to the controls the test drives.
- **Fix:** `.find-hit` is `rgb(240, 212, 74)`. The header button focuses the search input. `src/styles.css`, `src/components/quire/header-strip.tsx`.
- **Guards:** `search-yellow-and-open`

## FB-09 — Excel TSV paste becomes a table

- **Severity:** high
- **Fixed in:** 0.3.2 (bitmap preference tightened in 0.3.6)
- **Symptom:** Pasting several Excel cells dumped tab-separated text, or a picture of the cells, instead of a table.
- **Repro:** Copy two or more cells. Paste into a sheet with Ctrl+V.
- **Root cause:** The clipboard's plain text and HTML table were ignored, or the bitmap was taken first.
- **Fix:** Prefer a parsed grid from `text/plain` or `text/html` over an image file. `src/components/quire/text-block.tsx`, `src/lib/quire/blocks.ts`, `src/lib/quire/html-paste.ts`.
- **Guards:** `paste-tsv-table`

## FB-10 — HTML bold and italic paste

- **Severity:** medium
- **Fixed in:** 0.3.2
- **Symptom:** Pasting from a word processor dropped bold and italic.
- **Repro:** Paste HTML `<b>BoldWord</b>` into a sheet.
- **Root cause:** Paste always inserted `text/plain` and ignored emphasis tags.
- **Fix:** `parseHtmlClipboard` records bold and italic runs and the paste handler applies them. `src/lib/quire/html-paste.ts`, `src/components/quire/text-block.tsx`.
- **Guards:** `paste-html-bold`

## FB-11 — PageDown moves the caret

- **Severity:** medium
- **Fixed in:** 0.3.2
- **Symptom:** PageDown and PageUp did not move through a long note. The textarea does not scroll; the sheet does.
- **Repro:** Open a note of 100+ lines. Press PageDown.
- **Root cause:** The key was left to the textarea, which has `overflow: hidden`.
- **Fix:** Move by a viewport of lines and scroll `.sheet`. `src/components/quire/text-block.tsx`.
- **Guards:** `page-down-moves`

## FB-12 — Ctrl+Enter opens a URL

- **Severity:** low
- **Fixed in:** 0.3.2
- **Symptom:** Ctrl+Enter on a link did nothing.
- **Repro:** Put `https://example.com/app` on a sheet, put the caret in it, press Ctrl+Enter.
- **Root cause:** No key handler called `openUrl`.
- **Fix:** `urlAt` plus Ctrl+Enter (and Ctrl+click). `src/lib/quire/urls.ts`, `src/components/quire/text-block.tsx`.
- **Guards:** `ctrl-enter-opens-url`

## FB-13 — Insert table at the caret

- **Severity:** high
- **Fixed in:** 0.3.5
- **Symptom:** Insert table always appended at the end of the block, and a long note jumped to the top.
- **Repro:** Paste a long note, click in the middle, Insert table, 2×2.
- **Root cause:** The command used the block end, and measuring the textarea height reset scroll.
- **Fix:** Split the text block at the caret. Keep `.sheet` scrollTop across the reflow. `src/components/quire/quire-app.tsx` `splitInsertTable`, `src/components/quire/text-block.tsx` `fit`.
- **Guards:** `table-insert-at-caret`

## FB-14 — Tables survive reload

- **Severity:** high
- **Fixed in:** 0.3.7
- **Symptom:** After autosave and a reload, images were still there and tables were gone.
- **Repro:** Insert a table, type in a cell, wait for autosave, reload the app, open the sheet.
- **Root cause:** `snapshot()` stored every non-image block as text. Load only restored text and images.
- **Fix:** Store `kind: "table"` with columns and cells, and call `restore_table` on load. `src/components/quire/store.ts`, `src/lib/quire/persist.ts`.
- **Guards:** `table-survives-reload`

## FB-15 — Ctrl+Shift+V ignores Excel's bitmap

- **Severity:** high
- **Fixed in:** 0.3.7
- **Symptom:** Ctrl+Shift+V on an Excel copy inserted the picture of the cells and dropped the words. Ctrl+V correctly made a table.
- **Repro:** Paste a clipboard that has TSV, an HTML table, and a PNG, using Ctrl+Shift+V.
- **Root cause:** Plain-paste skipped the table parsers, then still took the first image file.
- **Fix:** A plain-paste request inserts `text/plain` and returns before the image branch. `src/components/quire/text-block.tsx`.
- **Guards:** `ctrl-shift-v-skips-excel-bitmap`

## FB-16 — Ctrl+A enables formatting, and Escape closes Find

- **Severity:** medium
- **Fixed in:** 0.3.8
- **Symptom:** Ctrl+A painted a selection but Bold stayed disabled ("select text first"). Escape while that selection was up did not close Find, so the find bar replaced the toolbar.
- **Repro:** Press Ctrl+A. Look at Bold. Open Find. Press Escape.
- **Root cause:** Whole-sheet select never set a range, so `hasSelection` was false. The capture-phase Escape handler swallowed the key before Find could close.
- **Fix:** Whole-sheet select counts as a selection and applies the mark to every text span. Escape closes Find first and leaves the selection up. `src/components/quire/quire-app.tsx`.
- **Guards:** `ctrl-a-enables-bold`, `escape-closes-find-during-select-all`

## FB-17 — List menu keeps editor focus

- **Severity:** medium
- **Fixed in:** 0.3.8
- **Symptom:** Lists → Bullet applied the marker, then focus sat on `document.body`, so the next keys never reached the sheet.
- **Repro:** Click in the sheet. Open Lists. Click Bullet.
- **Root cause:** The menu button took focus, and `applyList` called `bump()` with no caret to put back.
- **Fix:** `preventDefault` on the menu item's mousedown, and `bump` with the new caret so the editor focuses. `src/components/quire/sheet.tsx`, `src/components/quire/quire-app.tsx`.
- **Guards:** `list-menu-keeps-editor-focus`

## FB-18 — HTML underline and strike paste

- **Severity:** low
- **Fixed in:** 0.3.8
- **Symptom:** `<b>` and `<i>` pasted as marks. `<u>UnderWord</u>` pasted as plain text.
- **Repro:** Paste HTML `<u>UnderWord</u>` into a sheet.
- **Root cause:** `StyleRun` only carried bold and italic.
- **Fix:** The parser also records underline (`u`, `ins`) and strike (`s`, `del`, `strike`), and the paste handler applies those marks. `src/lib/quire/html-paste.ts`, `src/components/quire/text-block.tsx`.
- **Guards:** `paste-html-underline`, `src/lib/quire/html-paste.test.ts` ("keeps underline and strike from u and s tags")

## FB-19 — Insert table from a cell

- **Severity:** low
- **Fixed in:** 0.3.8
- **Symptom:** Insert table while a cell was focused dropped a table at a stale text caret. Nothing was nested inside the cell.
- **Repro:** Focus a table cell that contains text. Insert table, 2×2.
- **Root cause:** A cell is `{ text, marks, fill }` (`rust/quire-core/src/document.rs`), not a list of blocks, so a table cannot live inside it. The command ignored the cell and used the last text caret.
- **Fix:** This is a document-model limit, not a missing widget. The new table is inserted directly under the current one, the cell text stays, and the status line says why. `src/components/quire/quire-app.tsx` `insertTable`.
- **Guards:** `table-insert-from-cell-places-below`

## FB-20 — Drag across two table cells

- **Severity:** low
- **Fixed in:** 0.3.8
- **Symptom:** Dragging from one cell into the next selected only the first cell. Bold could not cover both.
- **Repro:** Type in two neighbouring cells. Drag from the first into the second. Click Bold.
- **Root cause:** Each cell is its own textarea, so the browser selection cannot cross the border.
- **Fix:** A pointer drag that enters another cell selects that rectangle (`.is-range`). Bold and the other marks apply to the full text of every cell in it. `src/components/quire/table-block.tsx`, `src/components/quire/quire-app.tsx`, `src/styles.css`.
- **Guards:** `cross-cell-drag-bold`

## FB-21 — Close asks even when the sheet is clean

- **Severity:** low
- **Fixed in:** 0.3.8
- **Symptom:** Close on a clean sheet deleted it from the board with no dialog. A dirty sheet asked first. Save marks a sheet clean, so the next Close was silent.
- **Repro:** Save the sheet. Click Close.
- **Root cause:** `closeNote` called the delete path immediately when `is_dirty()` was false. Close always removes the note.
- **Fix:** Always show the confirm dialog. Keep editing leaves the sheet in place. `src/components/quire/quire-app.tsx`.
- **Guards:** `close-clean-confirms`

## FB-22 — Undo after styling a table cell ate the cell text

- **Severity:** high (data loss)
- **Fixed in:** 0.3.9
- **Symptom:** Bold/ink/highlight a selection inside a table cell, then Ctrl+Z. The style stayed painted and the cell lost one character per undo (`stack me` → `stack m` → `stack ` → …). In a normal text block the same undo correctly removed the style and kept the text.
- **Repro:** Insert a table, click a cell, type `stack me`, select `stack`, click Bold, then Wax red ink, then Yellow highlighter, then press Ctrl+Z repeatedly.
- **Root cause:** Two parts. (1) A cell's textarea is `.cell-input`, not `.editor`, so the global key handler classified it as a form `field` and bailed before the Ctrl+Z branch *without* `preventDefault()` — the browser's native textarea undo fired, reverting only the cell's DOM text (re-synced to the model) while the app's marks, living in the overlay, stayed. (2) Cell style changes were recorded as a whole-blocks `Structure` snapshot, which on undo could also revert text. `src/components/quire/quire-app.tsx` (`onKey`), `rust/quire-core/src/document.rs` (`table_style`).
- **Fix:** Route Ctrl+Z / Ctrl+Y from a focused cell to the document undo and `preventDefault` the native undo. Record a cell style change as a marks-only `CellStyle` step whose undo restores exactly the prior runs via `set_cell_marks` and never touches `cell.text`. `src/components/quire/quire-app.tsx`, `rust/quire-core/src/document.rs` (`StepKind::CellStyle`, `set_cell_marks`, `push_cell_style`, `table_style`, `table_set_marks`).
- **Guards:** `cell-style-undo-keeps-text` (verify-bugs.mjs); `V3-undo-block-vs-cell`, `R3-undo-in-cell` (qa-verify.mjs / qa-retest.mjs)

## FB-23 — Adding a list marker threw the caret to the end of the block

- **Severity:** medium
- **Fixed in:** 0.3.9
- **Symptom:** Click Bullet (or any list format) with the caret on a line other than the last and the cursor jumped to the end of the whole block, so you could not keep typing on the line you had just turned into a list item.
- **Repro:** Type three lines, put the caret on line 2, open Lists → Bullet •.
- **Root cause:** `applyListStyle` rewrites the entire block (`start:0, end:text.length`) and `applyList` set the caret to `change.insert.length` — the end of the block — instead of the end of the line the caret was on. `src/components/quire/quire-app.tsx` (`applyList`).
- **Fix:** Compute the caret's line index before the edit (line count is preserved by the rewrite) and place the caret at the end of that same line in the new text, ready to type. `src/components/quire/quire-app.tsx`.
- **Guards:** `FIX3-bullet-caret-*` (qa-fixes.mjs)

## FB-24 — Alignment was offered with Word Wrap off; wrap is now the gated default

- **Severity:** low
- **Fixed in:** 0.3.9
- **Symptom:** Align left/centre/right stayed enabled with Word Wrap off, where the textarea scrolls sideways and centring has no stable meaning. Word Wrap should default on and gate alignment.
- **Repro:** Open a sheet, toggle Word Wrap off, click Align centre.
- **Root cause:** The align buttons were gated only on `activeBlockId === null || activeKind === "table"`, never on wrap. `src/components/quire/sheet.tsx`.
- **Fix:** Word Wrap defaults pressed (a new note is `wrap: true`); the align buttons are disabled while wrap is off, with a tooltip saying to turn Word Wrap on first, and re-enable when wrap returns. `src/components/quire/sheet.tsx`, `src/lib/quire/typefaces.ts`.
- **Guards:** `FIX2-wrap-default-pressed`, `FIX2-align-disabled-when-wrap-off`, `FIX2-align-reenabled-when-wrap-back-on` (qa-fixes.mjs)

## FB-25 — Alignment was a no-op inside table cells

- **Severity:** medium
- **Fixed in:** 0.4.0
- **Symptom:** With a table cell focused, Align left/centre/right did nothing — the buttons were disabled for tables, and cells had no alignment of their own.
- **Repro:** Insert a table, click a cell, type, click Align centre.
- **Root cause:** `Cell` had no align field and the align toolbar was gated off whenever `activeKind === "table"`.
- **Fix:** `Cell` gains `align: u8`; `table_align(id, r0, c0, r1, c1, align)` aligns one cell or a whole drag rectangle in a single undoable structure step (mirrors `table_fill`); the cell renders `data-align` and CSS aligns the highlight overlay and the textarea together; the align toolbar is enabled for tables and routes through `liveCellTarget()`/`cellRange` rather than `sel.blockId` (which still points at a text block when a cell is focused). Align survives save/reload via `table_json`'s `a` field. `rust/quire-core/src/document.rs`, `rust/quire-wasm/src/lib.rs`, `src/components/quire/{table-block,sheet,quire-app}.tsx`, `src/styles.css`.
- **Guards:** `C1-cell-align-centre`, `C3-undo-reverts-cell-align`, `C4-cell-align-font-persist` (qa-cell.mjs); `table_align_sets_cells_and_undos` (`cargo +stable-x86_64-pc-windows-msvc test -p quire-core`)

## FB-26 — Font change was a no-op inside table cells

- **Severity:** medium
- **Fixed in:** 0.4.0
- **Symptom:** With a table cell focused, picking a face did nothing; cells stayed IBM Plex Mono.
- **Repro:** Insert a table, click a cell, open Font → Inter.
- **Root cause:** Three parts. (1) The font menu was disabled for tables. (2) The cell rule `.block .cell .cell-input { font-family: var(--font-mono) }` (specificity 0,3,0) outranked `.block[data-font] textarea` (0,2,1), so even a set face lost. (3) The `look` action targeted `sel.blockId` — a text block — not the focused cell's table.
- **Fix:** Each `[data-font]` now also sets `--editor-font`, which the cell rule consumes (`var(--editor-font, var(--font-mono))`); the font menu is enabled for tables; the `look` action retargets to `liveCellTarget().tableId`; the toolbar font indicator reflects the focused cell; and the table's font persists through the IndexedDB snapshot, `.papel` and the archive. `src/styles.css`, `src/components/quire/{sheet,quire-app,table-block,store}.tsx/ts`, `src/lib/quire/{persist,backup}.ts`.
- **Guards:** `C2-font-reaches-cell`, `C4-cell-align-font-persist` (qa-cell.mjs)

## FB-27 — Tab walked focus out of a list item instead of indenting it

- **Severity:** medium
- **Fixed in:** 0.5.0
- **Symptom:** In a numbered/bulleted list, pressing Tab to indent an item (`1.` → `1.1`) moved focus to the sheet switcher instead; the item never nested.
- **Repro:** Type `1. a`, press Enter (`2.` appears), press Tab.
- **Root cause:** The contenteditable renderer (default since 0.4.0) had no Tab handler, so the browser's default focus navigation ran. The legacy textarea renderer handled Tab via `indentList`.
- **Fix:** The CE renderer handles Tab/Shift+Tab through `indentList` (same path as the textarea), always `preventDefault` so focus stays in the editor; outside a list, Tab inserts a literal tab. `src/components/quire/text-block-ce.tsx`.
- **Guards:** `T1-tab-indents-list-item`, `T2-shift-tab-outdents` (qa-tab.mjs)

## FB-28 — Closing a sheet deleted it behind an easy-to-miss confirmation

- **Severity:** high (data loss)
- **Fixed in:** 0.5.0
- **Symptom:** The "Close sheet" action permanently deletes the sheet and its file on disk, but the dialog read "Close" and a single click confirmed it, so sheets were lost by accident.
- **Repro:** Click the X (Close sheet), then click the confirm button.
- **Root cause:** A destructive delete was labelled "Close" with a one-click danger confirm and no acknowledgement step.
- **Fix:** The toolbar action and dialog are relabelled "Delete sheet" / "⚠ Delete this sheet?"; the body states the deletion is permanent and cannot be undone; and a hard-confirm checkbox ("Yes, permanently delete this sheet and its file") must be ticked before the Delete button arms (it renders disabled until then). `src/components/quire/quire-app.tsx`, `src/components/quire/sheet.tsx`, `src/styles.css`.
- **Guards:** `close-clean-confirms` (verify-bugs.mjs)
