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
