# Papel — Technical Documentation

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Component & Data Flow](#3-component--data-flow)
4. [Folder / Project Structure](#4-folder--project-structure)
5. [Setup & Installation](#5-setup--installation)
6. [APIs / Interfaces](#6-apis--interfaces)
7. [Key Design Decisions & Trade-offs](#7-key-design-decisions--trade-offs)
8. [Development, Testing, and Deployment Notes](#8-development-testing-and-deployment-notes)
9. [Assumptions, Gaps, and Areas Needing Clarification](#9-assumptions-gaps-and-areas-needing-clarification)
10. [Summary of Gaps / Questions](#10-summary-of-gaps--questions)

---

## 1. Architecture Overview

Papel is a **client-side single-page app** with a **Rust document core compiled to WebAssembly**.

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React UI (TanStack Start route "/")                            │
│   ├─ HeaderStrip   search · filters · sheet switcher · settings │
│   ├─ Board         torn-paper cards (board + side column)       │
│   ├─ Sheet         style strip · find bar · page of blocks      │
│   │    └─ TextBlock  <textarea> + <pre> overlay (color/styles)  │
│   └─ StatusBar     caret, language, encoding, EOL, zoom         │
│                    │                                            │
│        store.ts ───┼── sessions: Map<noteId, Session (WASM)>    │
│                    │                                            │
│  quire-wasm  ──────┘  wasm-bindgen wrapper (Session)            │
│  quire-core           document model, undo, styles, highlight,  │
│                       format, detect, encoding                  │
│                                                                 │
│  IndexedDB "papel" ── autosave snapshot + preferences           │
└─────────────────────────────────────────────────────────────────┘
```

- **Style**: layered client app. UI (React) → state/store (TypeScript) → engine (Rust/WASM) → persistence (IndexedDB).
- **No backend for the notepad.** The server side (Nitro/TanStack Start) only serves the app. Workspace scaffolding for auth and data exists but is not used by the notepad (§9).
- **Native later**: `quire-core` has no WASM or DOM dependencies, so a future native shell could link it directly (stated intent in `rust/quire-core/src/lib.rs`).

### Main components

| Component | File | Responsibility |
| --- | --- | --- |
| `QuireApp` | `src/components/quire/quire-app.tsx` | App state, view switching (board/focus), commands, keyboard shortcuts, autosave, search/filter/sort, styles, find/replace. |
| `store` | `src/components/quire/store.ts` | Session registry, load/snapshot to IndexedDB, `.papel` read/write, card data cache, image object URLs. |
| `HeaderStrip` | `src/components/quire/header-strip.tsx` | Torn header: brand, sheet switcher, search, language filter, sort, Go, new/open, settings (skin, autocorrect). |
| `Board` / `NoteCard` | `src/components/quire/board.tsx` | Card grid (measured columns) and compact side column; drag reorder; card menu. |
| `Sheet` / `FindBar` | `src/components/quire/sheet.tsx` | Focused page: title/rename, style strip, edit tools, find/replace/go-to-line, image and text blocks. |
| `TextBlock` | `src/components/quire/text-block.tsx` | One editable text block: native textarea, diffing into the core, autocorrect, image paste, overlay painting. |
| `StatusBar` | `src/components/quire/status-bar.tsx` | Board totals or caret/line/encoding/EOL/language/zoom. |
| `DropMenu` | `src/components/quire/drop-menu.tsx` | Small popover menu. |
| `quire-core` | `rust/quire-core` | Document, undo/redo, style runs, syntax spans, formatters, language detection, encodings. |
| `quire-wasm` | `rust/quire-wasm` | `Session` class exported to JS via wasm-bindgen. |

## 2. Technology Stack

| Layer | Technology |
| --- | --- |
| Language (UI) | TypeScript 5, React 19 |
| App framework | TanStack Start + TanStack Router (file routes), Vite 8, Nitro (server build, Vercel preset) |
| Styling | Hand-written CSS in `src/styles.css`; Tailwind CSS 4 imported for base layer; IBM Plex Sans (UI) and IBM Plex Mono (editor) via `@fontsource` |
| Icons | `lucide-react` |
| Editor core | Rust (edition 2021), crates `quire-core` and `quire-wasm`; `wasm-bindgen` **0.2.129** (pinned); `serde_json` |
| Persistence | Browser IndexedDB (database `papel`, store `kv`) |
| Tests | Rust `cargo test`; Node built-in test runner with `--experimental-strip-types` |
| Lint / format | ESLint 9, Prettier |
| Hosting (assumed) | Vercel (`vercel.json`, Nitro Vercel preset output in `.vercel/output`) |

Also present in `package.json` but **not used by the notepad**: better-auth, kysely, pg, PGLite, Radix UI, react-query, recharts, zod, zustand and others (workspace scaffolding).

## 3. Component & Data Flow

### 3.1 Startup

1. Route `/` (`src/routes/index.tsx`) shows a boot sheet and lazy-loads `QuireApp` on the client.
2. `QuireApp` calls `installTextures()` (rasterizes SVG paper textures to PNG data URLs) and `ensureLoaded()`.
3. `ensureLoaded()` boots the WASM module, reads `doc` and `prefs` from IndexedDB, and rebuilds one `Session` per note (text blocks, image blocks, style marks).
4. The board view renders.

### 3.2 Typing (hot path)

1. The user types into a `<textarea>` (text is transparent; caret and selection are native).
2. `TextBlock.sync()` diffs the old and new value (`diffText`) and calls `session.edit(block, start, end, inserted, coalesce)`. Fast consecutive small edits coalesce into one undo step.
3. If autocorrect is on, the block is prose, and the user just typed a delimiter, `correctionAt()` may return a fix, applied as a separate `session.edit` (so Ctrl+Z reverts only the fix).
4. The overlay `<pre>` is repainted with `paint(text, session.highlight(id), readMarks(session.marks(id)))`.
5. `QuireApp` bumps `tick`. Autosave runs about 400 ms after the last change. Cards refresh about 500 ms after typing pauses.

### 3.3 Styling text

1. Selection changes are reported from the textarea (`select`, `keyup`, `click`, and native `selectionchange`).
2. A style button (or Ctrl+B/I/U, Ctrl+Shift+X) calls `session.apply_style(block, start, end, kind, value)`.
3. The core rewrites the block's style runs and records an undo step. The overlay repaints.

### 3.4 Saving and opening

- **Save**: no images and no styles → `export_bytes()` in the chosen encoding/EOL → `.txt` download. Otherwise → `toPapel()` JSON → `.papel` download. "Save text only" drops images and styles after a confirmation.
- **Open**: `.papel` / `.quire` → `fromPapel()`; anything else → `open_bytes()` (encoding and EOL detection) plus a language hint from the file extension.

### 3.5 Search

`searchNotes(query, docs)` scores each note per query word: title substring > body substring > close spelling (bounded Levenshtein, 1 edit for short words, 2 for 6+ letters) > title subsequence. Every word must match. Results are ranked and include a body snippet.

## 4. Folder / Project Structure

```
AI_Documentation/            This documentation.
public/                      favicon.svg, og.jpg
rust/
  quire-core/src/
    document.rs              Document model, edits, undo/redo, images, find/replace, styles
    marks.rs                 Style runs: shift on edit, restyle, split/join, (un)flatten
    highlight.rs             Syntax spans per language
    format.rs                Autoformat (pretty-printers)
    detect.rs                Conservative language detection
    lang.rs                  Language ids and modes (auto/fixed)
    encoding.rs              Decode/encode, BOM, EOL
    textutil.rs              UTF-16 helpers, line/column
  quire-wasm/src/lib.rs      wasm-bindgen Session wrapper
src/
  routes/__root.tsx          HTML head (title "Papel", favicon, meta), providers
  routes/index.tsx           "/" route, lazy-loads the app
  components/quire/          The notepad UI (see §1)
  lib/quire/
    engine.ts                Boots WASM, creates Session
    persist.ts               IndexedDB load/save, types (Persisted, Prefs)
    text.ts                  Skins, language list, file name helpers, download, base64
    marks.ts                 Ink/highlighter palette, overlay painter, mark helpers
    fuzzy.ts                 Typo-tolerant note search
    autocorrect.ts           English typo table and correction logic
    torn.ts                  Stable torn-edge clip-path polygons and card tilt
    textures.ts              Rasterizes SVG textures once for fast painting
    quire.test.ts            Unit tests for the TS modules above
    pkg/                     Generated WASM bindings (do not edit by hand)
  styles.css                 All visual design: tokens, skins, desk, strip, cards, sheet, phone
  lib/auth, lib/app-data     Workspace scaffolding (not used by the notepad)
scripts/                     Workspace tooling (env wrapper, migrations, preview, PWA, brand checks)
migrations/                  SQL for the auth scaffolding (not used by the notepad)
server/                      Nitro middleware for the workspace PWA (not used by the notepad)
```

## 5. Setup & Installation

### Prerequisites

- Node.js (tested with v24) and npm.
- To rebuild the core: Rust stable, target `wasm32-unknown-unknown`, and `wasm-bindgen-cli` **0.2.129** (must match the crate version).

### Run the web app

```bash
npm install
npm run dev            # vite dev on 0.0.0.0:8080 via scripts/with-app-env.mjs
```

If `npm run dev` fails on Windows with `spawn vite ENOENT`, or port 8080 is taken, run Vite directly:

```bash
npx vite dev --host 127.0.0.1 --port 5180
```

### Rebuild the WASM core (only after changing Rust)

```bash
cd rust
cargo test -p quire-core
cargo build -p quire-wasm --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir ../src/lib/quire/pkg target/wasm32-unknown-unknown/release/quire_wasm.wasm
```

Commit the regenerated files in `src/lib/quire/pkg/`.

### Environment variables

The notepad needs none. Workspace scaffolding reads variables such as `DATABASE_URL` (migrations) and `GROK_PROJECT_ID` (preview vs deployed detection); they do not affect the notepad.

## 6. APIs / Interfaces

There is **no network API** for the notepad. The interfaces are the WASM API, the browser storage schema, and the file formats.

### 6.1 WASM `Session` (from `quire-wasm`)

Offsets are **UTF-16 code units**, so they match JavaScript string indexes.

| Group | Methods |
| --- | --- |
| Load | `open_bytes(bytes)`, `restore_begin()`, `restore_text(text) → id`, `restore_image(mime, bytes) → id`, `restore_end(lang, eol, encoding)`, `restore_marks(id, flat)` |
| Edit | `edit(id, start, end, text, coalesce)`, `insert_image_caret(id, at, mime, bytes) → Caret?`, `delete_image(id) → Caret?`, `format_all() → "ok:…" / "err:…"` |
| Styles | `apply_style(id, start, end, kind, value) → bool` (`kind`: `bold`, `italic`, `underline`, `strike` with 0/1; `ink`, `hl` with palette index; `clear`), `marks(id) → Uint32Array`, `has_marks()` |
| History | `undo()`, `redo() → Caret?`, `can_undo()`, `can_redo()`, `is_dirty()`, `mark_clean()` |
| Read | `outline() → JSON [{id, kind, mime}]`, `text_of(id)`, `image_of(id)`, `mime_of(id)`, `highlight(id) → [start, end, kind]*`, `metrics(id, pos) → [line, col, lines, chars]`, `first_text_id()`, `export_text()`, `export_bytes()` |
| Find | `find(query, case, fromId, fromPos, back) → Caret?`, `find_count()`, `replace_all() → count`, `line_to_caret(line)` |
| Settings | `set_language`, `force_language`, `language`, `effective_language(id)`, `set_eol`, `eol`, `eol_label`, `set_encoding → "ok" / "err:…"`, `encoding`, `encoding_label` |

### 6.2 Style marks

Flat array, 5 numbers per run: `[start, end, flags, ink, hl]`.

- `flags` bits: 1 bold, 2 italic, 4 underline, 8 strikethrough.
- `ink`: 0 default, 1 wax red, 2 blue, 3 green, 4 pencil.
- `hl`: 0 none, 1 yellow, 2 pink, 3 green, 4 blue.
- Runs are sorted, non-overlapping, merged when adjacent and equal.

### 6.3 IndexedDB (`papel` → store `kv`)

| Key | Shape |
| --- | --- |
| `doc` | `{ notes: StoredNote[], order: string[], activeId: string \| null }` |
| `prefs` | `{ skin: "paper" \| "ink" \| "carbon", zoom: 12–28, autocorrect: boolean, sort: "manual" \| "recent" \| "title" }` |

`StoredNote`: `{ id, title, wrap, edited?, language, eol, encoding, blocks }`, where a block is `{ kind: "text", text, marks? }` or `{ kind: "image", mime, bytes: ArrayBuffer }`. Older prefs containing `mode: "night"` are ignored.

### 6.4 `.papel` file (JSON)

```json
{
  "format": "papel",
  "version": 2,
  "language": "auto",
  "eol": "lf",
  "encoding": "utf-8",
  "blocks": [
    { "type": "text", "text": "Dear Ana,", "marks": [0, 4, 1, 1, 0] },
    { "type": "image", "mime": "image/png", "data": "<base64>" }
  ]
}
```

Version 1 (no `marks`) and `.quire` files load with the same reader.

### 6.5 Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+N / Ctrl+O | New sheet / open file |
| Ctrl+S | Save (focus view) |
| Ctrl+F | Find in sheet (focus) or focus the search field (board) |
| Ctrl+H, Ctrl+G | Open find / go to line |
| Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z | Undo / redo |
| Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X | Bold, italic, underline, strikethrough |
| F5 | Insert date and time |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Esc | Close dialog or find bar; otherwise back to board |

## 7. Key Design Decisions & Trade-offs

| Decision | Why | Trade-off |
| --- | --- | --- |
| Rust core in WASM | One document engine for web now and native later; fast find/format/highlight. | Build needs Rust + exact wasm-bindgen version; generated bindings committed. |
| Textarea + `<pre>` overlay | Native caret, selection, IME, mobile keyboards, and speed. | Styles must not change character width, so the editor stays monospace; inline styles only. |
| UTF-16 offsets in the core | Match JS string indexes; emoji keep caret positions correct. | Conversions inside Rust. |
| Style runs in the core (not in TS) | Undo/redo, image split/merge, replace-all stay consistent. | Format bump to `.papel` v2. Autoformat clears styles in blocks it rewrites. |
| Board home + focus with side cards | Matches the redesign mockup; overview plus quick switching. | Side column must be isolated for typing speed (see below). |
| Torn edges as generated `clip-path` polygons, seeded by note id | Stable unique edges, no image assets, sharp at any size. | Clip-path clips children, so torn shapes sit on separate background layers to keep menus visible. |
| Textures as SVG turbulence, rasterized once at startup | Code-generated look without image files. | A small canvas step at boot; SVG kept as fallback. |
| Performance containment | `contain: strict` on the side column, `will-change` on the sheet, cards memoized and refreshed after typing pauses, single paint per keystroke. | Card previews lag about 0.5 s behind typing. |
| Round-robin card columns | Stable left-to-right reading order; uses all columns. | Columns can end at different heights. |
| Autosave writes a full snapshot | Simple and robust recovery. | Cost grows with total notes and image size. |
| Conservative language detection | A letter is never mistaken for code. | Some short code snippets stay plain until the language is set. |

## 8. Development, Testing, and Deployment Notes

### Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Node tests (scripts + `src/**`), incl. `src/lib/quire/quire.test.ts` |
| `cargo test -p quire-core` | Core tests (editing, undo, emoji offsets, images, format, encodings, detection, styles) |
| `npx vite build` | Production build to `.vercel/output` |

### Performance check (recommended after UI changes)

In a production build, open a sheet and time 20 synthetic `input` events, waiting for the next frame after each. The median per-keystroke time should stay close to one frame (about 17 ms). It measured about 18 ms after the redesign; the first redesign pass was about 95 ms.

### Deployment

- `vercel.json` sets the install command. `npm run build` runs `vite build` then `db:migrate`; the migrator skips when `DATABASE_URL` is not set.
- **Gap**: the live deployment target, URL, and pipeline are not documented.

### Known issues

- `npm run dev` fails on Windows (`with-app-env.mjs` spawns `vite` without a shell).
- Dev port 8080 is hard-coded in `package.json`.
- ESLint reports a `no-empty` error in `src/lib/app-data/client.server.ts` (scaffolding, pre-existing).
- `vite preview` serves `.wasm` without `application/wasm`; the browser falls back to slower instantiation (warning only).
- Component and crate names still say "Quire"; `package.json` name is `app-builder-workspace`.

## 9. Assumptions, Gaps, and Areas Needing Clarification

- **Hosting**: Vercel is assumed from config files; not confirmed.
- **Workspace scaffolding**: `__root.tsx` wraps the app in `AuthProvider` and `PreviewHostBridge`, and links a PWA manifest under `/__grok/`. Whether these should stay, be removed, or become features is undecided.
- **Offline use**: not verified. The WASM and assets are fetched from the server; no service worker for the notepad was reviewed.
- **Browser support**: tested in Chromium only. Safari/Firefox behavior (for example `selectionchange` on textareas, `clip-path` with `calc()`) is not verified.
- **Storage limits**: large images in IndexedDB may hit browser quotas; no handling beyond the autosave error message.
- **Native shell**: technology and API boundary not chosen; `quire-core` is the intended reuse point.
- **Automated UI tests**: none. UI was checked manually in a browser.

## 10. Summary of Gaps / Questions

1. Where and how is Papel deployed (URL, Vercel project, CI)?
2. Keep, remove, or adopt the auth/app-data/PWA scaffolding?
3. Which browsers must be supported?
4. Should the app work offline (service worker / PWA for the notepad)?
5. Native shell: which platform and framework will host `quire-core`?
6. Should code identifiers be renamed from Quire to Papel (breaking for imports, not for files)?
7. Is an automated UI test suite (for example Playwright) wanted?
8. Is a storage quota strategy needed for image-heavy notes?
