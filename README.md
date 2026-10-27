# Papel

A light notepad on paper. Notes are torn-paper cards on a kraft desk; open one and it becomes the big sheet, with the other cards in a column beside it. Three paper skins (Paper, Ink, Carbon), syntax color, and Autoformat when the sheet is code.

- **Board**: every sheet is a card with a preview, language, word and line counts, last edit, and a dot when it is not saved to a file. Drag cards to reorder (in *My order*), or use the card's `…` menu.
- **Search**: the header's search field is typo-tolerant. It filters cards once you type 3 letters, or press **Go** for shorter words. Filter by language and sort by last edit or title.
- **Styles**: select text, then use the strip on the sheet: bold, italic, underline, strikethrough, ink colors, and highlighters (Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+Shift+X). They also work on code sheets, layered over the syntax color.
- **Autocorrect**: fixes common English typos as you type on prose sheets (`teh` → `the`, `dont` → `don't`). Ctrl+Z undoes a fix. Turn it off under Settings.
- **Images**: paste screenshots straight onto the sheet.
- **Find**: Ctrl+F on an open sheet opens find, replace, and go to line.

Plain text saves as `.txt`. A sheet with pasted images or text styles saves as `.papel` (JSON, version 2 adds style marks; version 1 and `.quire` files still open).

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
