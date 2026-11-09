/**
 * Phase 4 — per-line paragraph style via the contenteditable renderer (CE flag on).
 * Verifies Word-style behaviour in the real app:
 *   S1 collapsed caret on a line  -> only that line is styled
 *   S2 multi-line selection       -> every touched line is styled
 *   S3 undo of a style change     -> reverts style, text untouched
 *   S4 styles persist across reload (IndexedDB snapshot -> restore_styles)
 *
 *   npm run build:desktop && node scripts/qa-style.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "style-ce");
const PORT = 8098;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-style] run npm run build:desktop first"); process.exit(2); }
await mkdir(OUT, { recursive: true });

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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e)));
let shotN = 0;
async function snap(n) { shotN += 1; const f = `${String(shotN).padStart(2, "0")}-${n.replace(/[^a-z0-9-]+/gi, "-").slice(0, 50)}.png`; try { await page.screenshot({ path: join(OUT, f), timeout: 8000 }); return f; } catch { return null; } }

await page.addInitScript(() => {
  try { localStorage.setItem("papel-ce", "1"); } catch {}
  const dir = { id: "d", name: "d" }; const files = new Map(); let maximized = false; window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.3.9"; }, async minimize() {}, async toggleMaximize() { maximized = !maximized; }, async isMaximized() { return maximized; }, async close() {}, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = (id, title, text, wrap = true) => ({ id, title, wrap, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] });
  const doc = { notes: [note("style", "Style", "alpha\nbeta\ngamma")], order: ["style"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);

// Open the note.
await page.getByRole("button", { name: "Style", exact: true }).first().click();
await page.waitForTimeout(500);

const CE = ".page .ce-root";
const ceActive = (await page.locator(CE).count()) > 0;
check("CE-renderer-active", ceActive, { ceRoot: await page.locator(CE).count() });
if (!ceActive) { console.log("[qa-style] CE renderer not active — aborting"); await browser.close(); server.close(); process.exit(1); }

// Helpers ------------------------------------------------------------------
async function styleInfo() {
  return page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].map((l) => ({
    style: l.getAttribute("data-style"),
    size: parseFloat(getComputedStyle(l).fontSize),
    text: l.textContent,
  })));
}
// Set a precise selection: line index + column (collapsed if endLine null).
async function setSel(line, col, endLine = null, endCol = 0) {
  await page.evaluate(({ line, col, endLine, endCol }) => {
    const root = document.querySelector(".page .ce-root");
    root.focus();
    const lines = [...root.querySelectorAll(".ce-line")];
    const pos = (el, c) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, acc = 0;
      while ((n = w.nextNode())) { const l = n.textContent.length; if (acc + l >= c) return { node: n, off: c - acc }; acc += l; }
      return { node: el, off: el.childNodes.length };
    };
    const a = pos(lines[line], col);
    const r = document.createRange();
    r.setStart(a.node, a.off);
    if (endLine == null) { r.collapse(true); } else { const b = pos(lines[endLine], endCol); r.setEnd(b.node, b.off); }
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, { line, col, endLine, endCol });
  await page.waitForTimeout(120);
}
// Open the paragraph-style DropMenu and pick an item by its visible name.
async function applyStyle(name) {
  await page.getByRole("button", { name: /Paragraph style/ }).first().click();
  await page.waitForTimeout(180);
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).first().click();
  await page.waitForTimeout(220);
}

// S1 — collapsed caret on line 2 -> only line 2 becomes Title ----------------
await setSel(1, 2);
await applyStyle("Title");
let si = await styleInfo();
check("S1-caret-line-only",
  si[0].style === "body" && si[1].style === "title" && si[2].style === "body" && si[1].size > si[0].size,
  si.map((x) => `${x.text}:${x.style}/${x.size}px`));
await snap("S1-caret-line-title");

// S2 — multi-line selection (mid line1 .. mid line3) -> every touched line ----
await setSel(0, 2, 2, 2);
await applyStyle("Heading");
si = await styleInfo();
check("S2-every-touched-line",
  si.every((x) => x.style === "heading") && si[0].size > 16,
  si.map((x) => `${x.text}:${x.style}/${x.size}px`));
await snap("S2-every-touched-heading");

// S3 — undo reverts the style change, text intact ----------------------------
const textBefore = await page.evaluate(() => document.querySelector(".page .ce-root").innerText.replace(/\n+$/, ""));
await page.keyboard.press("Control+z");
await page.waitForTimeout(220);
si = await styleInfo();
const textAfter = await page.evaluate(() => document.querySelector(".page .ce-root").innerText.replace(/\n+$/, ""));
check("S3-undo-reverts-style-keeps-text",
  si.length === 3 && si[0].style === "body" && si[1].style === "title" && si[2].style === "body" && textAfter === "alpha\nbeta\ngamma",
  { lines: si.map((x) => `${x.text}:${x.style}`), textBefore, textAfter });
await snap("S3-undo");

// S4 — styles persist across a reload ----------------------------------------
await setSel(2, 1); await applyStyle("Subtitle"); await page.waitForTimeout(700); // > 400ms autosave debounce
await page.reload();
await page.waitForTimeout(1400);
if ((await page.locator(CE).count()) === 0) {
  await page.getByRole("button", { name: "Style", exact: true }).first().click();
  await page.waitForTimeout(500);
}
const persisted = await styleInfo();
check("S4-styles-persist-across-reload",
  persisted.length >= 3 && persisted[1].style === "title" && persisted[2].style === "subtitle",
  persisted.slice(0, 3).map((x) => `${x.text}:${x.style}/${x.size}px`));
await snap("S4-after-reload");

const summary = { suite: "qa-style (CE renderer)", results, pageErrors, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-style] ${summary.pass} pass / ${summary.fail} fail -> ${join(OUT, "results.json")}`);
if (pageErrors.length) console.log("[qa-style] page errors:", pageErrors);
await browser.close().catch(() => {}); server.close();
process.exitCode = summary.fail ? 1 : 0;
