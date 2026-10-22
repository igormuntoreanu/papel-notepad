# Papel

A light notepad on paper. Vertical tabs, three skins, day and night, syntax color, and Autoformat when the sheet is code.

Plain text saves as `.txt`. A sheet with pasted images saves as `.papel`.

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
