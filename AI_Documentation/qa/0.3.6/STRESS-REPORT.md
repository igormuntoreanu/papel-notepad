# Papel editor stress test — v0.3.6

Testing only. No editor fixes and no release. The desktop UI was the static bundle in `dist-desktop/client` (built with `npm run build:desktop`), driven in Chromium via Playwright. WebView2 is not available on this Linux VM.

Evidence: `AI_Documentation/qa/0.3.6/` (visual harness) and `AI_Documentation/qa/0.3.6/stress/` (this run, including `results.json`).

## Totals

| Suite | Result |
| --- | --- |
| `npm test` script tests | **184 pass / 17 fail** (fails are template/host files, not the editor; listed below) |
| Editor and lib unit tests (the `src/lib/**` half of `npm test`, run on its own because `npm test` stops at the script failures) | **122 pass / 0 fail** |
| `node scripts/verify-bugs.mjs` | **14 pass / 4 fail**. The 14 existing checks pass. The 4 failures are new cases added for bugs found here. |
| `node scripts/qa-visual.mjs` | Completed. Shots under `AI_Documentation/qa/0.3.6/`. |
| Adversarial Playwright (`node scripts/qa-stress.mjs`) | **16 pass / 8 fail** as recorded. One of the eight is a too-strict assertion (bold did paint). **7 product failures** after that review. |
| Toolbar matrix | **514 cells**. Automated: 304 pass, 66 disabled-for-a-reason, 48 not in the product, 36 window-stub only, 23 absent, **37 fail**. Most of those 37 are harness or by-design, called out under the grid. |

## Top bugs

1. **High — tables disappear on reload.** Insert a table, type in a cell, wait for autosave, reload. The words and images come back; the table does not. `stress/07-after-reload.png` shows Short after that reload: the sentence is there, the table is gone (the speck above the sentence is the 1×1 image, which did survive). `snapshot()` in `src/components/quire/store.ts` (about lines 167–180) stores every non-image block as text, and `ensureLoaded` (about lines 111–120) only restores text and images. `toPapel` in the same file (about line 206) already knows how to write a table. Suggested fix: persist and restore table blocks the same way `.papel` save does.

2. **High — Ctrl+Shift+V on an Excel-shaped clipboard inserts the bitmap, not the text.** A paste that carries `text/plain` TSV, `text/html` table, and a PNG becomes an editable table (20/20). The same paste after Ctrl+Shift+V adds a picture and leaves the TSV out. `forcePlain` in `src/components/quire/text-block.tsx` (about lines 326–347) skips the table parsers, then the image branch (about lines 376–380) still runs and `preventDefault`s. Suggested fix: when plain paste is requested, ignore the image and insert `text/plain`.

3. **Medium — Ctrl+A looks selected but formatting stays disabled, and Escape will not close Find.** Ctrl+A paints the sheet (`find-hit` spans) and the Bold button reads `Bold (select text first)`. `onSelectAll` in `src/components/quire/text-block.tsx` (about lines 433–437) never expands a range, and `hasSelection` in `src/components/quire/quire-app.tsx` (about line 1285) only looks at `sel`. While that selection is up, the capture-phase Escape handler (about lines 266–273) swallows Escape, so Find stays open and replaces the toolbar (`src/components/quire/sheet.tsx` about lines 282–284). In the matrix, the `long-ctrl-a` column is **D** for Bold and **A** for almost every control after Find. Suggested fix: treat whole-sheet select as a selection and apply marks across text blocks; let Escape close Find before it clears the selection.

4. **Medium — picking a list style drops the caret.** Lists → Bullet applies `• `, then `document.activeElement` is `body`. The next keys never reach the sheet. Typing works again after a click in the editor, and Tab / Shift+Tab then indent correctly (`• item` / `◦ child` / outdent). `applyList` in `src/components/quire/quire-app.tsx` (about line 772) calls `bump()` with no caret, and menu buttons in `src/components/quire/drop-menu.tsx` do not keep the editor focused the way toolbar `Keep` does (`sheet.tsx` about line 168). Suggested fix: `bump` with the new caret, and `preventDefault` on mousedown for those menu items.

5. **Low — HTML underline (and strikethrough) paste as plain text.** `<b>` and `<i>` paint (`html-bold-italic-paste` pass). `<u>UnderWord</u>` is in the text and is not underlined. `StyleRun` in `src/lib/quire/html-paste.ts` (line 8) only carries bold and italic. Suggested fix: map `u`/`ins` to underline and `s`/`del`/`strike` to strikethrough.

6. **Low — no nested table, and Insert table from a cell adds a sibling.** A cell is a `<textarea>`. Insert table while that cell is focused appends another sheet-level table (`text, table, text, table, text`) and leaves `CELL` in the original cell. There is no `.sheet-table` inside a `.sheet-table`. `insertTable` uses `liveCaret()` (`quire-app.tsx` about lines 929 and 1054), which ignores a focused cell and falls back to the last text caret. Suggested fix: when a cell is focused, say so and do not insert at a stale text caret. Real nesting needs a different block model.

7. **Low — a drag cannot select two table cells.** Cells are separate textareas. A drag from column 1 to column 2 leaves one cell selected. Same structural limit as (6).

8. **Low — Close on a clean sheet deletes it with no dialog.** `closeNote` (`quire-app.tsx` about lines 509–519) asks only when the sheet is dirty. Save marks the sheet clean, so the next Close removes it from the board. The first matrix pass hit this on Empty, Short, and Long and lost those notes. The second pass did not click Close, so the rest of the grid could run. Suggested fix: always confirm a close that deletes the note.

**Toolbar Delete table stays hidden while a cell is focused.** The button is gated on `activeKind === "table"` (`sheet.tsx` about lines 451–458), and `activeKind` follows `sel.blockId`, which stays a text block. Delete is on the right-click menu (that menu passed in `verify-bugs.mjs`). Suggested fix: treat a focused cell as the active table.

## Adversarial cases

| Case | Result | Notes |
| --- | --- | --- |
| Boot with desktop bridge v2 | PASS | Bridge v1 is rejected and the folder gate covers the board. The harness now injects v2. |
| Huge plain paste, then Insert table at mid-caret, ×20 | PASS | 220 wrapped lines, real clipboard + Ctrl+V, caret in the middle. Split is `text, table, text` and the prefix+suffix is the original text. Scroll did not jump to 0. `stress/01-huge-paste-table-ok.png`. |
| Excel TSV + HTML table + PNG, ×20 | PASS | Editable cells `alpha` / `beta`. Image count stayed 0. `stress/02-excel-table.png`. |
| Ctrl+Shift+V on that same clipboard | **FAIL** | Bug 2. |
| Alt-drag column select with wrap on, then Escape, ×10 | PASS | Wrap stays on, the rect clears. |
| Toolbar Bold after leaving a table cell, ×10 | PASS | |
| Ctrl+A then Bold | **FAIL** | Bug 3. |
| List menu restores focus | **FAIL** | Bug 4. |
| Lists, Tab indent, Shift+Tab outdent (after clicking the editor) | PASS | |
| PageDown then PageUp on an 80-line note | PASS | |
| Ctrl+click a URL | PASS with a caveat | A coordinate Ctrl+click did not open. A click event with `ctrlKey` while the caret sat on `https://example.com/app` did. Ctrl+Enter is covered by `verify-bugs` and passes. |
| HTML bold + italic paste | PASS | |
| HTML underline paste | **FAIL** | Bug 5. |
| Rapid undo/redo (burst and 8 slow steps) | PASS | Text round-trips. |
| 12 images, Delete, Undo | PASS | `stress/04-many-images.png`. |
| Nested table from a cell | **FAIL** | Bug 6. `stress/05-nested-table.png`. |
| 10,000-line note | PASS | Paste ~1s, PageUp moved the caret, a typed `Z` landed in 173ms, scroll stayed at the bottom (~270k px). `stress/06-ten-k-lines.png`. |
| Table and image survive reload | **FAIL** | Bug 1. Image survived, table did not. |
| Bold, switch sheet, switch back | PASS | Bold range `he qui` was still there. |
| Bold in a cell, then bold outside | PASS on review | Recorded fail. The drag did not cover the whole word; the painted spans were `INSI` and `UTSI`, so both marks applied. |
| Drag across two cells | **FAIL** | Bug 7. |
| Bold+italic+underline+strike in one burst | PASS | One span with classes `sb si su ss`. |
| Escape closes the Lists menu and stays in the sheet | PASS | |
| Go to line 40 | PASS | Caret landed on line 40. |

## Toolbar matrix

Legend: **P** did the action or the control was present and behaved. **D** disabled or hidden for a reason that matches the UI (no selection, nothing to undo, Delete table hidden). **·** not in the product. **W** the desktop stub recorded the call; the OS window was not resized. **A** not in the DOM in that moment. **F** automated fail — read the notes. **—** that cell was not exercised.

Notes on **F** and **A**, so they are not silent:

- **Save as** is **F** only because the check looked for `Save as .txt`. New sheets offer `.papel` only (`src/lib/quire/save-type.ts` lines 55–57). The menu did open and listed `Save as .papel`. By design, not a bug. Open of a `.txt` via the file chooser did create a sheet (`opened from disk`).
- **Search and filters** alternates **P**/**F** because the header button toggles. A second click closes the field, and the check then says the input is missing. On the board, with the field opened, search ran. Encoding chips show **A** on the same rows: those header steps ran while the board was showing, so the focus-only chips were not mounted.
- **Bold and the other marks** are **F** on `short-midword` and `table-cell-selection` because the scripted range landed on an empty first block or a cell whose selection never reached React. A real mouse drag enables Bold (the ×10 blur test, the four-mark burst, and the cell drag that painted `INSI`). **D** on `long-ctrl-a` is bug 3, not a valid disable.
- **EOL** **F** once (`CRLF -> CRLF`) after an earlier context had already switched endings. Other contexts changed LF/CRLF and restored LF.
- **`long-ctrl-a` A** after Find is bug 3: Escape cleared the sheet selection and left the find bar in place of the toolbar.
- **image-after** is **—** / setup **F**. The click on the editor after the image timed out (`stress/18-ctx-image-after-fail.png`). Caret-before-image and caret-on-image did run.
- **Delete table** is **D** in every column, including both table-cell columns. See the note above.
- **Close sheet** is **P** in this grid because a clean sheet is removed with no dialog (bug 8) and the run stopped clicking it. Dirty sheets do show Keep editing.
- **Window** controls are **W** in every context that reached them. Minimize, Maximize/Restore, and Close call the injected bridge. The real window was not minimized or closed.
- **History panel**, **Align justify**, and an **indent toolbar button** are **·**. History in this UI is Undo and Redo. Indent is Tab / Shift+Tab on list lines (that path passed). Alignment is left, centre, right, and it stays available with word wrap on.
- **Zoom %** is a label, not a button. Zoom in moved it from 100% to 106%; zoom out put it back.

| Control | board | empty-note | short-caret | short-midword | short-mid-paragraph | long-multiline | long-ctrl-a | table-cell-caret | table-cell-selection | image-before | image-after | image-on | mixed-after-excel-html |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Board | P | P | P | P | P | P | P | P | P | P | — | P | P |
| Search and filters | P | F | P | F | P | F | P | F | P | F | — | P | F |
| Switch sheet | P | P | P | P | P | P | P | P | P | P | — | P | P |
| Encoding chip | · | A | P | A | P | A | P | A | P | A | — | P | A |
| EOL chip | · | A | P | A | F | A | P | A | P | A | — | P | A |
| Zoom % | · | P | P | P | P | P | P | P | P | P | — | P | P |
| Settings/skins | P | P | P | P | P | P | P | P | P | P | — | P | P |
| Window Minimize | W | W | W | W | W | W | W | W | W | W | — | W | W |
| Window Maximize | W | W | W | W | W | W | W | W | W | W | — | W | W |
| Window Close | W | W | W | W | W | W | W | W | W | W | — | W | W |
| History panel | · | · | · | · | · | · | · | · | · | · | — | · | · |
| Bold | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Italic | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Underline | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Strikethrough | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Black ink | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Wax red ink | — | D | D | F | P | P | D | D | F | D | — | D | P |
| No highlight | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Yellow highlighter | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Clear styles | — | D | D | F | P | P | D | D | F | D | — | D | P |
| Undo | — | P | P | P | P | P | P | P | P | P | — | P | P |
| Redo | — | P | P | P | P | P | P | P | P | P | — | P | P |
| Undo-click | — | D | P | P | P | P | P | P | P | P | — | P | P |
| Find | — | P | P | P | P | P | P | P | P | P | — | P | P |
| Find-replace-fields | — | P | — | P | — | P | — | P | P | — | — | — | — |
| Insert date | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Lists | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Insert table | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Insert image | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Delete table | — | D | D | D | D | D | D | D | D | D | — | D | D |
| Word wrap | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Align left | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Align centre | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Align right | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Align justify | — | · | · | · | · | · | · | · | · | · | — | · | · |
| Zoom in | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Zoom out | — | P | P | P | P | P | — | P | P | P | — | P | P |
| Paragraph style | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Font | — | P | P | P | P | P | A | P | P | P | — | P | P |
| Indent toolbar | — | · | · | · | · | · | · | · | · | · | — | · | · |
| Save | — | P | P | P | P | P | P | P | P | P | — | P | P |
| Save as | — | F | F | F | F | F | F | F | F | F | — | F | F |
| Back to board | — | P | P | P | P | P | P | P | P | P | — | P | P |
| Rename sheet | — | P | P | P | P | P | P | P | P | P | — | P | P |
| Close sheet | — | P | P | P | P | P | P | P | P | P | — | P | P |
| (setup) | — | — | — | — | — | — | — | — | — | — | F | — | — |
| New | P | — | — | — | — | — | — | — | — | — | — | — | — |
| Open | P | — | — | — | — | — | — | — | — | — | — | — | — |
| New-count | P | — | — | — | — | — | — | — | — | — | — | — | — |


## Unit tests that failed (`npm test`)

These 17 fail before the editor tests run. They look for template files this repo does not ship (`.grok/skills/og/SKILL.md`, a populated `app-env.json`, grok.me/og plugin fixtures, nitro middleware). They are not editor regressions. Names:

- SKILL.md and AGENTS.md name the marker path and bound this script uses
- the sections that own the brand-task prohibition never affirm a wait
- SKILL.md tells the pass to self-check with the flag this CLI accepts
- the build side resolves the template's shipped app-env
- platform chrome overwrites share-card metas and always sets og:title
- published grok.me slug is still a title fallback
- emits og:image for a public host and prefers a custom card
- placeholder og:image appends site.color when it is 6-digit hex
- document title entities are not double-escaped on og:title
- injects into documents with no head element
- streaming injector matches `</HEAD>` case-insensitively
- uses the app name in the injected title tag
- nitro middleware and its bundled assets exist
- the template ships auth off
- the wrapped command runs with the app env applied
- the CLI still runs when invoked through a symlinked path
- every hand-over the og skill prints is one this script accepts

## What this VM could not reproduce

- **WebView2 and the portable `.exe`.** No Windows shell. The bundle is the same `dist-desktop/client` the Tauri shell loads. `npm run tauri:build` was not used; `npm run build:desktop` was.
- **A real Excel process clipboard** (CF_HTML plus the Windows bitmap). The handler was given the same trio Excel writes: `text/plain` TSV, `text/html` table, and a PNG file on `clipboardData`. That path is what bug 2 hits.
- **Native window chrome.** Minimize, maximize, and close only reached the stub.
- **OS file dialogs beyond the Playwright chooser.** Insert image and Open file did go through `filechooser` and both succeeded.

## Harness

- `scripts/verify-bugs.mjs` — bridge stub is v2, plus four new failing checks: `ctrl-shift-v-skips-excel-bitmap`, `ctrl-a-enables-bold`, `list-menu-keeps-editor-focus`, `table-survives-reload`.
- `scripts/qa-visual.mjs` — same bridge fix; shots now go to `0.3.6`.
- `scripts/qa-stress.mjs` — adversarial cases and the matrix. `node scripts/qa-stress.mjs` writes `AI_Documentation/qa/0.3.6/stress/results.json`.
