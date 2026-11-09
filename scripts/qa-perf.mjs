/**
 * Perf sanity for the now-default contenteditable renderer: open a large sheet and
 * confirm it renders and stays responsive (one div per line, no windowing yet).
 *   npm run build:desktop && node scripts/qa-perf.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const PORT = 8096;
const LINES = Number(process.argv[2] ?? 3000);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-perf] run npm run build:desktop first"); process.exit(2); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try { const body = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, ""))); res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404).end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.setDefaultTimeout(30000);
const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.addInitScript(() => {
  try { localStorage.setItem("papel-ce", "1"); } catch {}
  const dir = { id: "d", name: "d" }; const files = new Map(); window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.4.0"; }, async minimize() {}, async toggleMaximize() { return false; }, async isMaximized() { return false; }, async close() {}, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate((LINES) => {
  const text = Array.from({ length: LINES }, (_, i) => `line ${i + 1} of the big document`).join("\n");
  const note = { id: "big", title: "Big", wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] };
  const doc = { notes: [note], order: ["big"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  return new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
}, LINES);

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
const t0 = Date.now();
await page.getByRole("button", { name: "Big", exact: true }).first().click({ force: true, timeout: 8000 });
await page.waitForSelector(".page .ce-root .ce-line", { timeout: 30000 });
const openMs = Date.now() - t0;
const lineCount = await page.locator(".page .ce-root .ce-line").count();

// Typing latency at the end of a large doc.
await page.evaluate(() => {
  const root = document.querySelector(".page .ce-root");
  root.focus();
  const lines = root.querySelectorAll(".ce-line");
  const last = lines[lines.length - 1];
  const r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const t1 = Date.now();
await page.keyboard.type("hello");
const typeMs = Date.now() - t1;
await page.waitForTimeout(300);
const lastText = await page.evaluate(() => { const l = document.querySelectorAll(".page .ce-root .ce-line"); return l[l.length - 1].textContent; });

const ok = lineCount >= LINES && openMs < 6000 && typeMs < 1500 && lastText.endsWith("hello") && pageErrors.length === 0;
console.log(`${ok ? "PASS" : "FAIL"} perf-${LINES}-lines :: ${JSON.stringify({ lineCount, openMs, typeMs, lastText: lastText.slice(-20), pageErrors: pageErrors.slice(0, 2) })}`);
await browser.close().catch(() => {}); server.close();
process.exitCode = ok ? 0 : 1;
