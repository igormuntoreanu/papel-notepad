# Per-line alignment migration (Word-style paragraph alignment)

Goal: align each line independently — the selected lines, or the caret line when nothing is
selected — like Word/`.docx`, including inside table cells. Replaces today's behaviour where
`text-align` is one CSS property on a whole multi-line `<textarea>` block, so every line moves
together.

## Design decision: alignment is a CORE paragraph property

Per-line align lives in the Rust core on `Block::Text` as `aligns: Vec<u8>` (one entry per line,
`0`=left `1`=centre `2`=right), maintained through every text mutation and captured in undo —
exactly like `marks`. It is **not** frontend line-index metadata.

Why: in Word, alignment survives edits and undo because it is part of the document model. Frontend
metadata keyed by line index desyncs the moment a line is inserted/removed or an edit is undone.
Core-backed means the existing `Replace`/`Structure` undo steps keep it correct for free.

Invariant: `aligns.len() == body.matches('\n').count() + 1`, enforced by `normalize_aligns`.

Line-edit rules (match Word):
- Enter splits a line → the new line **inherits** the caret line's align.
- Backspace across a newline merges two lines → the merged line keeps the **upper** line's align.
- Typing inside a line never shifts aligns.
- `align_lines(id, start, end, align)` aligns **every line touched** by `start..end`
  (collapsed selection → the caret's line). One undoable `Align` step; never touches text.

## Phase 1 — Core data model: DONE ✅

`rust/quire-core/src/document.rs`:
- `Block::Text` gains `aligns: Vec<u8>`; helpers `line_count`, `nl_before`, `normalize_aligns`.
- `splice_block` maintains `aligns` through the splice and returns before/after.
- `StepKind::Replace` carries `aligns_before/after`; new `StepKind::Align` for align commands;
  `invert`/`reapply` restore them (`set_aligns`).
- `insert_image` / `insert_table_at` split aligns at the split line; `delete_image` re-joins them.
- `format_all` resets aligns; `replace_all` clamps them.
- New API: `align_lines`, `line_aligns`, `restore_aligns`, `set_aligns`.

`rust/quire-wasm/src/lib.rs`: binds `align_lines`, `line_aligns` (→ `Uint8Array`), `restore_aligns`.
Web bindings regenerated into `src/lib/quire/pkg`.

### Verified
- 7 new Rust unit tests + full core suite: `45 passed; 0 failed; 1 ignored`.
- 26 assertions via Node-targeted wasm bindings (`align_lines`, Enter/Backspace inheritance,
  undo/redo, image split, restore clamp) — all green.

### How to run the native Rust tests on this machine
The default host toolchain (`stable-x86_64-pc-windows-gnu`) cannot link test/build-script
binaries (`lld: error: unable to find library -lgcc`). Use the MSVC toolchain instead:

```
cargo +stable-x86_64-pc-windows-msvc test -p quire-core
```

(The wasm release build is unaffected: `cargo build -p quire-wasm --release --target wasm32-unknown-unknown`.)

## Phase 2 + 2b — contenteditable renderer & persistence: DONE ✅ (behind a flag)

`src/components/quire/text-block-ce.tsx`: a per-line `contenteditable` renderer. Lines are drawn
from the core (text + per-line marks via `paint()` + per-line `data-align`); the browser handles
character typing natively; any line-count change (Enter, merge, multi-line paste) re-renders from
the core and restores the caret by offset (computed from the diff, so the messy intermediate DOM
never matters). A toolbar mark change repaints via a marks baseline; typing does not.

Wiring: `src/lib/quire/ce-renderer.ts` flag (`localStorage["papel-ce"]="1"` or `?ce=1`);
`sheet.tsx` swaps `TextBlock`→`TextBlockCE` and routes the align buttons through a new
`actions.align(blockId, alignId)`; `quire-app.tsx` implements it as `session.align_lines(...)`
(core, per-line) when the flag is on, else the old per-block `setBlockLook`. The align indicator
reflects the caret line's core align.

Persistence (Phase 2b): per-line aligns ride along in both the `.papel` format (`toPapel`/
`fromPapel`) and the IndexedDB snapshot (`snapshot`/`loadPersisted`), stored only when non-default
so old files stay byte-identical; `restore_aligns` reloads them.

### Verified (`scripts/qa-align.mjs`, CE flag on, real Chromium)
9/9: renderer active · caret-line-only align · every-touched-line · caret follows alignment
(`caretRight == lineRight` on a right line) · Enter inherits · undo reverts align with text intact ·
typing syncs to core · toolbar bold repaints · **aligns persist across a full reload**.
No regressions: `qa-fixes` 8/8 (textarea path), unit tests 123/123, `npm run typecheck` clean.

### Preview it
Default is OFF (the textarea renderer still ships). To try per-line alignment: devtools →
`localStorage.setItem("papel-ce","1")` → reload, or open with `?ce=1`. Phase 3 features (box
select, rich paste, lists, autocorrect, PageUp/Down, find live-highlight) are not yet ported, so
keep the flag off for normal use until Phase 6 flips the default.

## Phase 3 — interaction parity: IN PROGRESS

Ported to the CE renderer and verified (`scripts/qa-ce-parity.mjs`, 5/5 + `qa-align.mjs` 9/9 still
green, `qa-fixes` 8/8, unit 123/123, verify-bugs all pass):
- **Paste variants** — plain multi-line, Excel/TSV grid → table (`onPasteTable`), HTML with
  emphasis → text + marks, image files → image block.
- **PageUp/PageDown** — caret moves a viewport of lines; scroll stays on `.sheet`.
- **Find live-highlight** — navigating Find repaints the match (find-signature baseline).
- **Autocorrect** — single-char typing in plain text runs `correctionAt` (ported, typechecked).
- **List auto-continue on Enter** — localized insert (the new line inherits the caret line's
  align) + a same-line-count renumber (aligns preserved); verified `qa-ce-parity` P4. Toolbar
  bullets/lists work too (they edit the core directly).
- **Alt+drag box/column select** — `pointAtCE`/`boxPixelsCE` ported to the per-line div grid
  (the root's bounding rect absorbs sheet/block scroll); painted `.block-rect`, column Delete,
  copy. Verified `qa-ce-parity` P5 (a 2×2 column delete strips the first 2 chars of both rows).
- Core: `splice_block` now **preserves** per-line aligns when a splice keeps the same line count
  (list renumber, reformat) instead of flattening them — guarded by
  `same_line_count_replace_preserves_aligns` (core suite 46/46).

Still to port (the CE renderer stays flag-gated until these land):
- **Ctrl+A whole-sheet select** — key is wired; the painted selection + cross-block copy/delete
  need the CE visual.
- **10k-line performance** — one div per line; add windowing if needed.

## Remaining phases
- **Phase 4 (DONE ✅)** — per-line paragraph style, Word-style, end to end.
  - **Core:** `styles: Vec<u8>` on `Block::Text` mirrors `aligns` (shared `splice_para`
    maintenance, `StepKind::Style` undo, `style_lines`/`line_styles`/`restore_styles` + wasm
    bindings). Native suite **48 passed** (incl. `style_lines_targets_touched_lines_and_undos`,
    `enter_inherits_style_like_align`).
  - **Frontend:** CE renderer emits `data-style` per line; per-line CSS sizes (Title 32px …
    Body 16px); the style DropMenu routes to `style_lines` (caret line, or every touched line);
    `caretStyle` toolbar indicator; `syncPara` fast-path repaints align+style without a full
    re-render; persisted in the IndexedDB snapshot and `.papel` (`styles?: number[]`).
  - **Verified:** `qa-style` **5/5** (caret-line-only, every-touched-line, undo keeps text,
    reload-persist). Regression green: qa-align 9/9, qa-ce-parity 5/5, qa-fixes 8/8, unit 123/123,
    verify-bugs ALL PASS, typecheck clean.
- **Phase 5 (DONE ✅)** — Table cells: BUG-2 (per-cell alignment) + BUG-3 (the block face reaching cells).
  - **Core:** `Cell` gains `align: u8`; `table_align(id, r0, c0, r1, c1, align)` aligns one cell or a
    rectangular range in ONE undoable structure step (mirrors `table_fill`); `table_json` serialises `a`;
    `restore_table` reads it. Native suite **49 passed** (incl. `table_align_sets_cells_and_undos`).
  - **Frontend:** the cell div carries `data-align` (CSS centres/rights both the highlight overlay and the
    textarea together); the align toolbar is enabled for tables and routes through `liveCellTarget()`/`cellRange`
    (not `sel.blockId`, which still points at a text block when a cell is focused). The face reaches cells via
    `--editor-font` — the base cell rule outranked `.block[data-font] textarea`, so each `[data-font]` now sets
    that var — and the `look` action targets the focused cell's table. The table's font persists through the
    IndexedDB snapshot, `.papel` and the archive; toolbar font/align indicators reflect the focused cell.
  - **Verified:** `qa-cell` **5/5** (cell align, font reaches cell, undo, reload-persist). Regression green:
    qa-align 9/9, qa-style 5/5, qa-ce-parity 5/5, qa-fixes 8/8, unit 123/123, verify-bugs ALL PASS.
- **Phase 6** — Validate vs QA harness (verify-bugs guards + qa-stress matrix + unit tests),
  flip the default renderer, remove the old textarea path, `.papel` migration for existing
  block-level align, then commit + release.

Release is held until alignment is user-visible (end of Phase 3) so the version ships a real
feature, not an inert core change.

Prototype that validated the approach: `spikes/001-per-line-align/` (see its `README.md`).
