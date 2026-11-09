/**
 * Phase 2 — per-line alignment via the contenteditable renderer (CE flag on).
 * Verifies Word-style behaviour in the real app:
 *   A1 collapsed caret on a line  -> only that line aligns
 *   A2 multi-line selection       -> every touched line aligns
 *   A3 caret follows the alignment (native caret sits at the aligned edge)
 *   A4 Enter on an aligned line   -> the new line inherits the alignment
 *   A5 undo of an align change    -> reverts align, text untouched
 *
 *   npm run build:desktop && node scripts/qa-align.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "align-ce");
const PORT = 8099;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-align] run npm run build:desktop first"); process.exit(2); }
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
  const doc = { notes: [note("align", "Align", "alpha\nbeta\ngamma")], order: ["align"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);

// Open the note.
await page.getByRole("button", { name: "Align", exact: true }).first().click();
await page.waitForTimeout(500);

const CE = ".page .ce-root";
const ceActive = (await page.locator(CE).count()) > 0;
check("CE-renderer-active", ceActive, { ceRoot: await page.locator(CE).count(), textarea: await page.locator(".page textarea.editor").count() });
if (!ceActive) { console.log("[qa-align] CE renderer not active — aborting"); await browser.close(); server.close(); process.exit(1); }

// Helpers ------------------------------------------------------------------
async function lineInfo() {
  return page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].map((l) => ({
    align: l.getAttribute("data-align"),
    computed: getComputedStyle(l).textAlign,
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
const alignBtn = (name) => page.getByRole("button", { name, exact: true }).first();

// A1 — collapsed caret on line 2 -> only line 2 centres ---------------------
await setSel(1, 2);
await alignBtn("Align centre").click();
await page.waitForTimeout(200);
let li = await lineInfo();
check("A1-caret-line-only", li[0].align === "left" && li[1].align === "center" && li[1].computed === "center" && li[2].align === "left",
  li.map((x) => `${x.text}:${x.align}/${x.computed}`));
await snap("A1-caret-line-centre");

// A2 — multi-line selection (mid line1 .. mid line3) -> every touched line ---
await setSel(0, 2, 2, 2);
await alignBtn("Align right").click();
await page.waitForTimeout(200);
li = await lineInfo();
check("A2-every-touched-line", li.every((x) => x.align === "right" && x.computed === "right"),
  li.map((x) => `${x.text}:${x.align}`));
await snap("A2-every-touched-right");

// A3 — caret follows the alignment (right-aligned line: caret near right edge)
const caret = await page.evaluate(() => {
  const root = document.querySelector(".page .ce-root");
  const lines = [...root.querySelectorAll(".ce-line")];
  const l = lines[1];
  const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
  let n, last = null; while ((n = w.nextNode())) last = n;
  const r = document.createRange();
  r.setStart(last, last.textContent.length); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const cr = r.getBoundingClientRect(); const lr = l.getBoundingClientRect();
  return { caretRight: Math.round(cr.right), lineRight: Math.round(lr.right), lineLeft: Math.round(lr.left), align: l.getAttribute("data-align") };
});
check("A3-caret-follows-align", caret.align === "right" && caret.caretRight >= caret.lineRight - 4 && caret.caretRight > caret.lineLeft + 20, caret);

// A4 — Enter on an aligned line -> new line inherits ------------------------
await setSel(1, 4); // end of "beta" (line 2, right-aligned)
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
li = await lineInfo();
check("A4-enter-inherits-align", li.length === 4 && li[1].align === "right" && li[2].align === "right" && li[2].text === "",
  li.map((x) => `${JSON.stringify(x.text)}:${x.align}`));
await snap("A4-enter-inherits");

// A5 — undo reverts the align change, text intact ---------------------------
const textBeforeUndo = await page.evaluate(() => document.querySelector(".page .ce-root").innerText.replace(/\n+$/, ""));
await page.keyboard.press("Control+z"); // undo the Enter
await page.waitForTimeout(200);
await page.keyboard.press("Control+z"); // undo the right-align
await page.waitForTimeout(200);
li = await lineInfo();
const textAfter = await page.evaluate(() => document.querySelector(".page .ce-root").innerText.replace(/\n+$/, ""));
check("A5-undo-reverts-align-keeps-text", li.length === 3 && li[1].align === "center" && textAfter === "alpha\nbeta\ngamma",
  { lines: li.map((x) => `${x.text}:${x.align}`), textAfter });
await snap("A5-undo");

// A6 — typing syncs to the core (survives a re-render that reads from the core)
await setSel(0, 5); // end of "alpha"
await page.keyboard.type(" XYZ");
await page.waitForTimeout(150);
const domAfterType = await page.evaluate(() => document.querySelectorAll(".page .ce-root .ce-line")[0].textContent);
// Force a re-render (centre line 1): renderLines reads text_of, so this proves core sync.
await setSel(0, 2);
await alignBtn("Align centre").click();
await page.waitForTimeout(200);
const afterRerender = await page.evaluate(() => {
  const l = document.querySelectorAll(".page .ce-root .ce-line")[0];
  return { text: l.textContent, align: l.getAttribute("data-align") };
});
check("A6-typing-syncs-to-core", domAfterType === "alpha XYZ" && afterRerender.text === "alpha XYZ" && afterRerender.align === "center",
  { domAfterType, afterRerender });

// A7 — a toolbar mark (bold) repaints in the CE renderer (marks-change re-render path)
await setSel(2, 0, 2, 5); // select "gamma"
const boldBtn = page.getByRole("button", { name: /Bold/ }).first();
const boldPresent = (await boldBtn.count()) > 0;
if (boldPresent) { await boldBtn.click(); await page.waitForTimeout(250); }
const boldHtml = await page.evaluate(() => document.querySelectorAll(".page .ce-root .ce-line")[2].innerHTML);
check("A7-bold-mark-renders", boldPresent && /class="[^"]*\bsb\b/.test(boldHtml), { boldPresent, html: boldHtml.slice(0, 140) });
await snap("A7-bold");

// A8 — aligns persist across a reload (IndexedDB snapshot -> loadPersisted -> restore_aligns)
await setSel(0, 1); await alignBtn("Align centre").click(); await page.waitForTimeout(120);
await setSel(2, 1); await alignBtn("Align right").click(); await page.waitForTimeout(700); // > 400ms autosave debounce
await page.reload();
await page.waitForTimeout(1400);
if ((await page.locator(CE).count()) === 0) {
  await page.getByRole("button", { name: "Align", exact: true }).first().click();
  await page.waitForTimeout(500);
}
const persisted = await lineInfo();
check("A8-aligns-persist-across-reload",
  persisted.length >= 3 && persisted[0].align === "center" && persisted[2].align === "right",
  persisted.slice(0, 3).map((x) => `${x.text}:${x.align}`));
await snap("A8-after-reload");

const summary = { suite: "qa-align (CE renderer)", results, pageErrors, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-align] ${summary.pass} pass / ${summary.fail} fail -> ${join(OUT, "results.json")}`);
if (pageErrors.length) console.log("[qa-align] page errors:", pageErrors);
await browser.close().catch(() => {}); server.close();
process.exitCode = summary.fail ? 1 : 0;
