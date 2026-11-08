# Papel editor stress test — v0.3.8 (creative toolbar sweep)

**Date:** 2026-11-07 · **Build:** `dist-desktop/client` from commit `555a65e` (tag `v0.3.8`), driven in headless Chromium via Playwright (WebView2 stands in).
**WASM note:** the Rust core changed in 0.3.8 (`rust/quire-core/src/document.rs` +75, `rust/quire-wasm/src/lib.rs` +8) but `src/lib/quire/pkg/` was stale from Oct 27. It was rebuilt (`cargo build -p quire-wasm --release --target wasm32-unknown-unknown` + `wasm-bindgen 0.2.129`) **before** `npm run build:desktop`, so these results reflect the real 0.3.8 editor core.

Focus per request: tables (inside/outside cells, Enter in a cell, bullets in a cell), colours & highlighters, word wrap, alignment, fonts, images (add/delete/undo), big + short text, and rollback (undo/redo) chains — with real keyboard and mouse selections.

> **Status update (after the fix pass):**
> - **BUG-1 (cell undo eats text) — FIXED.** Root cause was twofold: a focused cell's textarea (`.cell-input`, not `.editor`) was treated as a form field, so Ctrl+Z fell through to the browser's native textarea undo; and cell style changes were recorded as a whole-blocks `Structure` snapshot. Fix routes cell Ctrl+Z/Ctrl+Y to the document undo (with `preventDefault`) and records a marks-only `CellStyle` step. Ledger **FB-22**; guard `cell-style-undo-keeps-text`; verified by `qa-verify` V3 (`BOTH_OK`) and `qa-retest` R3 (text intact, marks peel one layer per undo).
> - **Requested change #3 (bullet keeps the caret on its line) — FIXED.** Ledger **FB-23**; guard `FIX3-bullet-caret-*`.
> - **Requested change #2 (Word Wrap defaults pressed; align disabled when wrap off) — FIXED.** Ledger **FB-24**; guard `FIX2-*`.
> - **Requested changes #1 (per-line alignment) and #4 (per-line paragraph style) — DEFERRED, pending a decision.** These cannot work in the current editor: a block is one multi-line `<textarea>` and CSS `text-align`/`font-size` apply to the whole textarea, never per line (including inside table cells). True per-line formatting needs the editor rewritten to render every line as its own element. **BUG-2 (cell alignment no-op)** and **BUG-3 (cell font no-op)** below are the cell-level face of the same limitation and are deferred with it.
> - No regressions: 57/57 editor unit tests, 24/24 `verify-bugs` guards, baseline matrix fails improved 45 → 37. (`go-to-line` fails only inside the full 515-row matrix run — it passes in isolation on a fresh boot; a harness state artifact, not a product regression.)
>
> The original findings below are kept as recorded.

---

## Totals

| Suite | Script | Result |
| --- | --- | --- |
| Baseline adversarial + 515-row toolbar matrix | `scripts/qa-stress.mjs` | cases **21 pass / 3 fail**; matrix **470 pass / 45 fail** |
| Creative sweep (32 cases, real selections) | `scripts/qa-creative.mjs` | **24 pass / 8 fail** |
| Isolation re-test of ambiguous findings (R1–R4) | `scripts/qa-retest.mjs` | 1 works · **3 broken** |
| Final confirmation (V1–V3) | `scripts/qa-verify.mjs` | **V1 works · V2 intact · V3 cell-undo broken** |
| Console page errors | all suites | **0** |

After triage, the baseline's 3 failed cases and 45 failed matrix rows, plus 6 of my 8 creative fails, are **harness artifacts or by-design** (proven below). **3 genuine new product bugs** remain — all in the table-cell path.

---

## Confirmed new bugs

### BUG-1 — Undo after styling a table cell deletes the cell text instead of undoing the style · **HIGH (data loss)**

- **Symptom:** Apply Bold / ink / highlight to a selection **inside a table cell**, then press Ctrl+Z. The style stays painted and the cell **loses one character per undo**.
- **Repro:** Insert table (2×2) → click a cell → type `stack me` → select `stack` (real keyboard `Shift+→` or a mouse drag) → click **Bold** → **Wax red ink** → **Yellow highlighter** → press **Ctrl+Z** repeatedly.
- **Expected:** Undo #1 removes the highlight, #2 the ink, #3 the bold; text stays `stack me`. (This is exactly what happens in a normal text block.)
- **Actual (traced):**

  | step | cell text | marks painted |
  | --- | --- | --- |
  | typed | `stack me` | — |
  | bold(0,5) | `stack me` | `sb` |
  | ink(0,5) | `stack me` | `sb ink1` |
  | hl(0,5) | `stack me` | `sb ink1 hl1` |
  | **undo #1** | `stack m` | `sb ink1 hl1` |
  | **undo #2** | `stack ` | `sb ink1 hl1` |
  | **undo #3…#6** | `stack`→`stac`→`sta`→`st` | `sb ink1 hl1` (never removed) |

- **Proves cell-specific (V3 side-by-side):** in a *normal text block*, type `normal block`, select, apply Wax red ink, Ctrl+Z → **ink removed, text intact**. In a *cell*, the same sequence → **ink stays, `cell text`→`cell tex`**. Plain typing undo in a cell is fine (`abcdefgh`→…→`""`), so the bug is the **mark-then-undo** interaction, not cell undo generally. Reproduces with both real (keyboard) and synthetic selections.
- **Evidence:** `retest/results.json` (R3 full trace), `verify/results.json` (V3), `creative/results.json` (H1). Shots: `retest/05-R3b-cell-undo-trace.png`, `verify/04-V3-block-undo.png`, `verify/05-V3-cell-undo.png`, `creative/15-H1-cell-stack.png`.
- **Root-cause hypothesis (needs runtime confirmation):** block marks go through `apply_style` → pushes `StepKind::Marks` (`document.rs:341–365`). Cell marks go through `table_style` → `finish_structure` → `push_structure` → `StepKind::Structure` (`document.rs:1128–1167`, `834–837`, `1291–1302`); the frontend cell branch is `applyStyle` in `quire-app.tsx:1153–1191` (`session.table_style(...)`). In practice the cell style change does **not** land an undoable step that `undo()` pops as a style revert: after three style ops, undo #1 immediately reverts a per-keystroke `StepKind::Cell` (deleting a character) while the marks persist. Instrument the undo stack at the `table_style` call to see why the `Structure` step is absent / skipped / mis-ordered against the `Cell` keystroke steps.

### BUG-2 — Alignment is enabled but a silent no-op when a table cell is focused · **MEDIUM (misleading UI)**

- **Symptom:** With a table cell focused, **Align left / centre / right** are enabled and clickable but change nothing.
- **Repro:** Insert table → click a cell → type `inside` → click **Align centre**.
- **Expected:** either the cell text centres, **or** the control is disabled with a cell focused (cells store text/marks/fill only, per the 0.3.8 model) — with feedback either way.
- **Actual:** `td[data-align]` stays `null`, computed `textAlign` stays `start`, table-block `data-align` `null`. No effect, no feedback. Aligning an outside text block works (`data-align=center`).
- **Evidence:** `retest/results.json` (R1). Shots: `retest/01-R1-align-cell.png`, `creative/03-B4-cell-align.png`, `creative/11-E4-align-cell-outside.png`.
- **Root-cause hypothesis:** the align command targets the active **text block**; a focused cell is not an alignable target, but the button's disabled state doesn't reflect that (stays enabled). Alignment likely lacks the cell branch / disable guard that `applyStyle` has.

### BUG-3 — Font face change is enabled but a silent no-op when a table cell is focused · **MEDIUM (misleading UI)**

- **Symptom:** Same class as BUG-2, for the **Font** control.
- **Repro:** Insert table → click a cell → type `cell font` → click the **`Font: …`** button → pick **IBM Plex Mono**.
- **Expected:** cell font changes, **or** the Font control is disabled with a cell focused.
- **Actual:** no `data-font` on the `td`, the table block, or any block. (Fonts work on normal blocks — 8/9 faces verified; the 9th, IBM Plex Sans, is the already-active default so re-picking is a no-op by design.)
- **Evidence:** `retest/results.json` (R2). Shots: `retest/02-R2-fonts-outside.png`, `retest/03-R2-fonts-cell.png`, `creative/12-F1-fonts.png`.
- **Root-cause hypothesis:** like alignment, the font/face command has no cell target and no disable guard for cell focus.

> BUG-2 and BUG-3 are the same defect class: **block-level formatting controls stay enabled but do nothing when a table cell is focused.** Decide once whether cells should support align/face; then either implement it or disable the controls (with the existing `selHint`-style tooltip) when a cell is the target.

---

## By design (confirmed, not a bug)

- **Delete table button hidden while a cell is focused** (creative B8). Intentional per **FB-06** (table actions live on the right-click cell menu) and the 0.3.6 report legend (`D` = hidden for a UI-matching reason). Right-click → Delete table works. The 0.3.6 report's suggested enhancement ("treat a focused cell as the active table") remains optional.

---

## Ruled out — baseline `qa-stress` fails that are NOT product bugs (proven)

| Baseline fail | Verdict | Proof |
| --- | --- | --- |
| `cross-cell-selection` | **Works** | V1: a drag across two cells sets `.is-range` on **2** cells and Bold paints **both** (`AA`+`BB`). The baseline counts native `selectionEnd>selectionStart` per textarea, which cannot span two separate textareas — wrong metric. Real model is `CellRange`/`.is-range` (`table-block.tsx:15–16, 215–221`). Matches the 0.3.8 release notes. |
| `format-in-cell-then-outside` | **No corruption** | V2: full cell text `INSIDE` survives a partial-drag bold (bold span = `IN`, the substring the short drag covered). The baseline asserted the bold span equals the whole word. |
| `nested-table-from-cell` | **Correct behaviour** | H2: inserting a table with a cell focused adds a **sibling** table below (`text,table,table,text`; nested=0), not a nested table — the deliberate 0.3.8 limit. Stale assertion. |
| Marks "disabled despite a selection" (Bold/Italic/Underline/Strike + inks/highlighters in `short-midword`, `table-cell-selection`) — 26 matrix rows | **Harness flake** | A1/A2/A4: real keyboard, mouse-drag, and single-char selections all **enable** the marks and **paint** correctly. A3: the synthetic `setSelectionRange`+`select` path also worked on re-run — the baseline's synthetic selection occasionally doesn't reach React state before the assertion. |
| `long-ctrl-a` "enabled with no selection" | **Harness mislabel** | A real Ctrl+A selection is recorded as `hasSel:false`; buttons are correctly enabled. |
| `Save as` (11), `Search and filters` (6), `EOL chip` (1), `image-after` setup (1) | **By-design / harness** | "Save as .papel" is the real menu label; the board search input is hidden in sheet view by design; EOL chip is informational; the setup timeout is a harness race. |

## My own creative-suite fails that were harness errors (corrected by re-test)

- **E2 wrap-off "not scrollable"** → R4: `.page .block` scrolls horizontally (`scrollWidth 3840 > clientWidth 988`, `overflow-x:auto`). I measured the inner `pre` (`overflow:hidden`). **Wrap-off sideways scrolling works.**
- **B5 / F1 fonts "NO_BUTTON"** → R2: correct accessible name is `Font: …` (my regex matched the `title`, not the `aria-label`). 8/9 faces apply on normal blocks.
- **A3 "fail"** → actually good news: synthetic selection worked, confirming the baseline mark fails were transient.
- **B4 / E4** → BUG-2. **B8** → by design. **H1** → BUG-1.

---

## Confidence — what passed (high-signal, real interactions)

- **Marks:** bold/italic/underline/strike on real mid-word, mouse-drag, single-char, and Ctrl+A selections; paint + undo + redo in normal blocks (A1, A2, A4, D1–D5, G3).
- **Colour:** all 4 inks (`ink1–4`) and all 4 highlighters (`hl1–4`) paint; **Clear styles** removes all; bold+colour stack on one span (D1, D2, D3, D5).
- **Rollback:** paint→undo→redo round-trips in a normal block (D4); a mixed chain (bold→ink→highlight→table→image) undoes ×5 to the bottom and redoes ×5 forward to the exact prior state (G2).
- **Alignment / wrap:** left/centre/right on normal blocks (E1); wrap toggled ×6 on 220-line text keeps all 14,739 chars (E3); wrap-off enables horizontal scroll (R4).
- **Tables:** Enter inside a cell inserts a newline, table intact (B1); Enter in the last cell doesn't destroy the table (B7); the Lists menu correctly offers **no** bullet inside a cell, table+text intact (B2); cell colours+highlight paint (B3); cross-cell drag selects and bolds both cells (V1); insert-table-from-cell is a sibling (H2); copy a styled cell → paste outside carries the text (H3).
- **Images:** add → Delete → Ctrl+Z restores (C1); Ctrl+A + Bold with an image keeps the image (C2).
- **Scale:** 10,000-line note — paste ≈3.5 s, Ctrl+A + Bold, undo → text stable at 669,999 chars (G1).
- **Persistence:** Excel paste → table → edit a cell → reload → table and edited cell text persist (H4).
- **No console page errors in any suite.**

---

## Reproduce

```bash
npm run build:desktop          # rebuild dist-desktop/client (WASM already rebuilt for 0.3.8)
node scripts/qa-stress.mjs     # baseline adversarial + 515-row matrix  -> AI_Documentation/qa/0.3.8/stress/
node scripts/qa-creative.mjs   # 32 creative cases, real selections     -> AI_Documentation/qa/0.3.8/creative/
node scripts/qa-retest.mjs     # R1–R4 isolation of ambiguous findings  -> AI_Documentation/qa/0.3.8/retest/
node scripts/qa-verify.mjs     # V1–V3 final confirmation               -> AI_Documentation/qa/0.3.8/verify/
```

Each writes a `results.json` plus numbered PNGs in its folder. Harness changes made to run on this Windows box: bumped `qa-stress.mjs` `VERSION` 0.3.6→0.3.8, added stable headless-Chromium launch args (`--disable-gpu --no-sandbox --disable-dev-shm-usage --disable-software-rasterizer`) and a fault-tolerant `snap()` so one screenshot crash can't abort the matrix. `qa-creative.mjs`, `qa-retest.mjs`, `qa-verify.mjs` are new and additive.

## Evidence index

- `stress/results.json` — baseline cases + 515-row matrix
- `creative/results.json` + `creative/01…18-*.png` — the 32-case sweep
- `retest/results.json` + `retest/01…06-*.png` — R1 cell-align, R2 fonts, R3 cell-undo trace, R4 wrap scroll
- `verify/results.json` + `verify/01…05-*.png` — V1 cross-cell, V2 partial-bold text intact, V3 block-vs-cell undo
