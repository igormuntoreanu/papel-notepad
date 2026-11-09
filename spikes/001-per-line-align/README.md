# Spike 001 — Per-line alignment via contenteditable

**Question (Given/When/Then):** Given a text block rendered as per-line elements in a
`contenteditable`, when the user aligns a collapsed caret line or a multi-line selection,
then only the touched lines change alignment, the native caret stays glued to the aligned
text, and alignment persists/inherits across line edits.

**Why it matters:** Papel renders each text block as ONE multi-line `<textarea>` (transparent)
plus a `<pre>` overlay, with alignment as a single CSS `text-align` on the whole block. A
textarea cannot align lines independently and its native caret cannot be offset per line, so
per-line alignment (request #1) and per-line paragraph style (#4) are impossible without
replacing the renderer. This spike validates the replacement's riskiest unknown — caret
correctness under per-line alignment — before any migration work begins.

**Approach:** Standalone `prototype.html`. Each line is a `<div class="line" data-align=...>`
inside a `contenteditable`. Align buttons compute the touched lines from the live `Selection`
(collapsed → caret line; range → every line between anchor and focus) and set `data-align`.
CSS `text-align` is per-div. Enter splits a line and the new line inherits `data-align`.

## Tests run (browser-automated, not just eyeballed)

| # | Test | Result |
| --- | --- | --- |
| T1 | Caret collapsed on line 2 → Align centre | **PASS** — only line 2 became `center`; lines 1,3,4,5 stayed `left` |
| T2 | Selection mid-line-1 → mid-line-3 → Align right | **PASS** — lines 1,2,3 all `right` ("every touched line"); 4,5 untouched |
| T3 | Enter at end of a right-aligned line | **PASS** — new line inserted, inherited `right`; alignment travelled with the split |
| T4 | Caret rect on a right-aligned line | **PASS** — `caretX 723 == lineRight 723`, `caretNearRight: true`: the native caret sits at the right edge, following the aligned text (not stranded at the left) |

Status readout in the prototype shows the live per-line model (`[align] "text"` per line),
which is exactly the data shape the real editor would persist.

## Verdict: VALIDATED

### What worked
- Per-line `text-align` on `contenteditable` line-divs renders and behaves correctly.
- **The native caret follows the alignment** (T4) — this was the make-or-break unknown. No
  custom caret, no overlay desync, no `textarea` hack needed.
- "Every touched line" selection semantics and collapsed-caret → current-line are straightforward
  with the `Selection` API.
- Alignment is intrinsic to the line element, so it survives Enter/split/merge naturally — the
  flat-text + line-index model the current editor uses could never do this reliably.

### What didn't / open risks (migration work, not feasibility)
- This prototype validates rendering + interaction only. The real migration must additionally:
  - Sync `contenteditable` input back to the Rust core (flat text + mark runs) — the core stays,
    but the DOM↔core mapping (marks split across line divs, selection offsets) is new code.
  - Re-port every textarea behaviour: Alt+drag box select, find highlight, autocorrect, list
    auto-continue/renumber, paste variants (Excel→table, HTML emphasis, images), Ctrl+A,
    PageUp/Down, and 10k-line performance (one div per line vs one textarea).
  - Move `BlockLook.align`/`style` from per-block to per-line, with a migration for existing
    `.papel` files (a block-level align becomes "all lines in that block").
- `document.execCommand` (used here for paste/insertText) is deprecated; the real build should
  use `beforeinput`/`InputEvent` handling.

### Surprises
- None on feasibility: `contenteditable` per-line alignment + caret is solid, as the mainstream
  web editors (Docs, Notion) rely on. The cost is entirely in re-implementing Papel's rich
  textarea behaviours on the new renderer, not in the alignment itself.

### Recommendation for the real build
Proceed, but as a **phased migration of the text-block renderer**, each phase gated by the
existing QA harness (`verify-bugs.mjs` 24 guards + `qa-stress.mjs` 515-row matrix + unit tests):
1. Per-line align/style **data model** + `.papel` migration (block align → all lines).
2. `contenteditable` per-line renderer for text blocks: text + marks + caret/selection + core sync.
3. Port interactions (box select, find, autocorrect, lists, paste, shortcuts, large-note perf).
4. Per-line paragraph **style** (#4) on the same renderer.
5. Table **cells** (BUG-2/BUG-3) — same per-line model, or cell-level align as a smaller step.

Ship behind the harness; do not rush it into a patch release. Phases 2–3 are the bulk and the
risk. Alignment (#1) for normal text blocks is reachable at the end of phase 3.
