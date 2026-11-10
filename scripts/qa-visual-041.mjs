/** Quick visual check: Matrix skin + the new Delete-sheet dialog. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "visual-041");
const PORT = 8094;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("run npm run build:desktop first"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try { const b = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, ""))); res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" }); res.end(b); } catch { res.writeHead(404).end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
page.setDefaultTimeout(12000);
await page.addInitScript(() => {
  const dir = { id: "d", name: "d" }; const files = new Map(); window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.4.1"; }, async minimize() {}, async toggleMaximize() { return false; }, async isMaximized() { return false; }, async close() {}, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = { id: "v", title: "Matrix note", wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text: "Wake up, Neo...\nThe Matrix has you.\nFollow the white rabbit." }] };
  const doc = { notes: [note], order: ["v"], activeId: null };
  const prefs = { skin: "matrix", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "01-board-matrix.png") });
await page.getByRole("button", { name: "Matrix note", exact: true }).first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: join(OUT, "02-sheet-matrix.png") });
await page.getByRole("button", { name: "Delete sheet" }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "03-delete-dialog.png") });
console.log("shots in", OUT);
await browser.close().catch(() => {}); server.close();
