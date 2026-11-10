/**
 * Task 6 — Tab inside a list indents the item (1. -> 1.1) instead of moving focus to the
 * sheet switcher. Shift+Tab outdents. The caret must stay in the editor either way.
 *   npm run build:desktop && node scripts/qa-tab.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const PORT = 8095;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-tab] run npm run build:desktop first"); process.exit(2); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try { const body = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, ""))); res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404).end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${JSON.stringify(detail)}`); }

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.setDefaultTimeout(12000);
const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.addInitScript(() => {
  try { localStorage.setItem("papel-ce", "1"); } catch {}
  const dir = { id: "d", name: "d" }; const files = new Map(); window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.4.1"; }, async minimize() {}, async toggleMaximize() { return false; }, async isMaximized() { return false; }, async close() {}, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = { id: "list", title: "List", wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text: "1. alpha\n2. beta" }] };
  const doc = { notes: [note], order: ["list"], activeId: null };
  const prefs = { skin: "sulphite", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "List", exact: true }).first().click();
await page.waitForTimeout(500);

const lines = () => page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].map((l) => l.textContent));
async function setSel(line, col) {
  await page.evaluate(({ line, col }) => {
    const root = document.querySelector(".page .ce-root"); root.focus();
    const el = [...root.querySelectorAll(".ce-line")][line];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, acc = 0, target = { node: el, off: 0 };
    while ((n = w.nextNode())) { const l = n.textContent.length; if (acc + l >= col) { target = { node: n, off: col - acc }; break; } acc += l; }
    const r = document.createRange(); r.setStart(target.node, target.off); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, { line, col });
  await page.waitForTimeout(120);
}
const focusedInEditor = () => page.evaluate(() => {
  const a = document.activeElement;
  return !!(a && a.classList && a.classList.contains("ce-root"));
});

const before = await lines();
check("T0-numbered-list-loaded", before[0] === "1. alpha" && before[1] === "2. beta", before);

// Caret on line 2 ("2. beta"), press Tab -> should indent to a sub-level (1.1) and keep focus.
await setSel(1, 4);
await page.keyboard.press("Tab");
await page.waitForTimeout(250);
let after = await lines();
const stillFocused = await focusedInEditor();
const indented = /^\s/.test(after[1] ?? "") || /1\.1/.test(after[1] ?? "");
check("T1-tab-indents-list-item", stillFocused && indented && after.length === 2,
  { before, after, stillFocused, line1: after[1] });

// Shift+Tab outdents back.
await setSel(1, Math.min(6, (after[1] ?? "").length));
await page.keyboard.press("Shift+Tab");
await page.waitForTimeout(250);
const outdented = await lines();
const stillFocused2 = await focusedInEditor();
check("T2-shift-tab-outdents", stillFocused2 && outdented[1] === "2. beta",
  { afterTab: after[1], afterShiftTab: outdented[1], stillFocused2 });

const fail = results.filter((r) => !r.ok).length;
console.log(`\n[qa-tab] ${results.length - fail} pass / ${fail} fail`);
if (pageErrors.length) console.log("[qa-tab] page errors:", pageErrors);
await browser.close().catch(() => {}); server.close();
process.exitCode = fail ? 1 : 0;
