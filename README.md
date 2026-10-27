# Papel

A light notepad on paper. Notes are torn-paper cards on a kraft desk; open one and it becomes the big sheet, with the other cards in a column beside it. Five paper skins (Sulphite by default, plus Paper, Ink, Carbon, Blueprint). Every sheet is plain text: no code languages, no syntax colouring.

- **Board**: every sheet is a card with a preview, word and line counts, last edit, and a dot when it is not saved to a file. Drag cards to reorder (in *My order*), or use the card's `…` menu.
- **Search**: the header's search field is typo-tolerant. It filters cards once you type 3 letters, or press **Go** for shorter words. Sort by my order, last edit or title.
- **Styles**: select text, then use the strip on the sheet: bold, italic, underline, strikethrough, ink colors, and highlighters (Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+Shift+X). A block also carries a face (nine of them), a paragraph style (Title to Body) and, with Word Wrap off, left/centre/right alignment.
- **Lists**: bullet, `1.`, `1)` and `a.` lists, nesting three levels deep with automatic numbering (`1.`, `1.1.`, `1.1.1.`); Enter continues the list, Tab and Shift+Tab nest and lift.
- **Box selection**: hold Alt and drag to select a rectangle of columns across lines; Ctrl+C copies just those columns and Delete removes them.
- **Word Wrap and zoom**: wrap long lines or scroll them sideways; tables keep their own horizontal scroller. Zoom from the toolbar or with Ctrl and the mouse wheel, 10-40 px.
- **Autocorrect**: fixes common English typos as you type on prose sheets (`teh` → `the`, `dont` → `don't`). Ctrl+Z undoes a fix. Turn it off under Settings.
- **Images**: paste screenshots straight onto the sheet.
- **Find**: Ctrl+F on an open sheet opens find, replace, and go to line.

Plain text saves as `.txt`. A sheet with pasted images, tables, styles or a block look saves as `.papel` (JSON; version 1 and `.quire` files still open). Pasting grid-shaped text from Excel, Sheets or a CSV creates a table.

## Desktop (Windows)

The Desktop build is **v1**: a Tauri 2 shell that wraps the web app in WebView2 and owns the
filesystem through a small bridge, shipped as a folder-portable zip. Build it with:

```bash
npm run build:desktop     # static bundle the shell embeds
npm run tauri:build       # the shell itself
npm run package:v1        # dist-portable/papel-<version>-portable-v1.zip
```

The Electron and Rust/egui experiments are retired for now and are not part of the build path;
their sources are not tracked in this repository.
## Run

```bash
npm install
npm run dev
```

The editor core is Rust (`rust/quire-core`), compiled to WebAssembly for the browser. Rebuild it with:

```bash
cd rust
cargo build -p quire-wasm --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir ../src/lib/quire/pkg target/wasm32-unknown-unknown/release/quire_wasm.wasm
```

`wasm-bindgen` must match the pinned crate version (0.2.129). Run the core tests with `cargo test -p quire-core`.
