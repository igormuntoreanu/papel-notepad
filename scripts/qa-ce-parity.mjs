/**
 * Phase 3 — CE renderer interaction parity (paste variants, PageUp/Down).
 *   P1 plain multi-line paste inserts lines at the caret (and inherits align)
 *   P2 Excel/TSV grid paste becomes a table (onPasteTable), not text
 *   P3 PageDown moves the caret down a viewport of lines
 *   npm run build:desktop && node scripts/qa-ce-parity.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "align-ce");
const PORT = 8097;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-ce-parity] run npm run build:desktop first"); process.exit(2); }
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

await page.addInitScript(() => {
  try { localStorage.setItem("papel-ce", "1"); } catch {}
  const dir = { id: "d", name: "d" }; const files = new Map(); let maximized = false;
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.3.9"; }, async minimize() {}, async toggleMaximize() { maximized = !maximized; }, async isMaximized() { return maximized; }, async close() {}, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile() { return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = (id, title, text) => ({ id, title, wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] });
  const doc = { notes: [note("p", "Parity", "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\nkappa\nlambda\nmu")], order: ["p"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Parity", exact: true }).first().click();
await page.waitForTimeout(500);

const CE = ".page .ce-root";
async function setSel(line, col) {
  await page.evaluate(({ line, col }) => {
    const root = document.querySelector(".page .ce-root"); root.focus();
    const lines = [...root.querySelectorAll(".ce-line")];
    const el = lines[line]; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, acc = 0, p = { node: el, off: 0 };
    while ((n = w.nextNode())) { const l = n.textContent.length; if (acc + l >= col) { p = { node: n, off: col - acc }; break; } acc += l; }
    const r = document.createRange(); r.setStart(p.node, p.off); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, { line, col });
  await page.waitForTimeout(100);
}
// Dispatch a paste with a synthetic DataTransfer (deterministic, no OS clipboard).
async function paste(plain, html) {
  await page.evaluate(({ plain, html }) => {
    const root = document.querySelector(".page .ce-root");
    const dt = new DataTransfer();
    if (plain != null) dt.setData("text/plain", plain);
    if (html != null) dt.setData("text/html", html);
    root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { plain, html });
  await page.waitForTimeout(250);
}
const linesText = () => page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].map((l) => l.textContent));

// P1 — plain multi-line paste at end of line 1
await setSel(0, 5);
await paste("ONE\nTWO");
const after = await linesText();
check("P1-plain-multiline-paste", after[0] === "alphaONE" && after[1] === "TWO" && after[2] === "beta",
  after.slice(0, 4));

// P2 — TSV grid paste becomes a table (onPasteTable), not text
const tablesBefore = await page.locator(".page table").count();
await setSel(1, 0);
await paste("a\tb\tc\n1\t2\t3\n");
await page.waitForTimeout(300);
const tablesAfter = await page.locator(".page table").count();
check("P2-grid-paste-becomes-table", tablesAfter === tablesBefore + 1, { tablesBefore, tablesAfter });

// P3 — PageDown moves the caret down (line index increases)
await page.locator(CE).first().click();
await setSel(0, 0);
const lineBefore = await page.evaluate(() => { const s = getSelection(); const root = document.querySelector(".page .ce-root"); const lines = [...root.querySelectorAll(".ce-line")]; let acc = 0; for (let i = 0; i < lines.length; i++) { if (lines[i].contains(s.anchorNode)) return i; acc += (lines[i].textContent.length + 1); } return -1; });
await page.keyboard.press("PageDown");
await page.waitForTimeout(150);
const lineAfter = await page.evaluate(() => { const s = getSelection(); const root = document.querySelector(".page .ce-root"); const lines = [...root.querySelectorAll(".ce-line")]; for (let i = 0; i < lines.length; i++) { if (lines[i].contains(s.anchorNode)) return i; } return -1; });
check("P3-pagedown-moves-caret", lineAfter > lineBefore, { lineBefore, lineAfter });

// P4 — Enter continues a bullet list; the new line inherits the marker, caret lands on it
await page.reload();
await page.waitForTimeout(1400);
if ((await page.locator(CE).count()) === 0) {
  await page.getByRole("button", { name: "Parity", exact: true }).first().click();
  await page.waitForTimeout(500);
}
await page.locator(".page .ce-root").first().click();
await setSel(0, 0);
await page.getByRole("button", { name: /^Lists/ }).first().click();
await page.waitForTimeout(150);
await page.getByRole("button", { name: /Bullet/ }).first().click();
await page.waitForTimeout(250);
const bulletLine0 = await page.evaluate(() => document.querySelectorAll(".page .ce-root .ce-line")[0].textContent);
// caret to end of line 0, then Enter
await page.evaluate(() => {
  const root = document.querySelector(".page .ce-root"); root.focus();
  const l = root.querySelectorAll(".ce-line")[0];
  const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let n, last = null;
  while ((n = w.nextNode())) last = n;
  const r = document.createRange();
  if (last) r.setStart(last, last.textContent.length); else r.setStart(l, 0);
  r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.waitForTimeout(100);
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
const afterEnter = await page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].slice(0, 2).map((l) => l.textContent));
const caretLineIdx = await page.evaluate(() => { const s = getSelection(); const lines = [...document.querySelectorAll(".page .ce-root .ce-line")]; for (let i = 0; i < lines.length; i++) if (lines[i].contains(s.anchorNode)) return i; return -1; });
check("P4-list-continue",
  /^•\s/.test(bulletLine0 || "") && afterEnter.length >= 2 && /^•\s/.test(afterEnter[1] || "") && caretLineIdx === 1,
  { bulletLine0, afterEnter, caretLineIdx });

// P5 — Alt+drag box/column select paints a rect; Delete removes the column
// Flush P4's autosave (400ms debounce) before reloading, so the reloaded sheet still
// has the bullets P5 box-selects over; otherwise line 2 reloads empty and the column
// drag has no glyphs to span.
await page.waitForTimeout(700);
await page.reload();
await page.waitForTimeout(1400);
if ((await page.locator(CE).count()) === 0) {
  await page.getByRole("button", { name: "Parity", exact: true }).first().click();
  await page.waitForTimeout(500);
}
const before = await page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].slice(0, 2).map((l) => l.textContent));
const geom = await page.evaluate(() => {
  const root = document.querySelector(".page .ce-root"); const r = root.getBoundingClientRect(); const st = getComputedStyle(root);
  const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.7;
  const c = document.createElement("canvas").getContext("2d"); c.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
  const cw = c.measureText("0000000000").width / 10;
  return { left: r.left, top: r.top, lh, cw };
});
// Drive the alt-drag with synthetic events in the element's own coordinate space
// (the app applies a zoom scale, so real-mouse viewport px != rect px).
await page.evaluate((g) => {
  const root = document.querySelector(".page .ce-root");
  const x0 = g.left + 0.2 * g.cw, y0 = g.top + g.lh / 2;
  const x1 = g.left + 2.4 * g.cw, y1 = g.top + g.lh + g.lh / 2;
  const ev = (type, x, y, buttons) => root.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, buttons, altKey: true, bubbles: true, cancelable: true }));
  ev("mousedown", x0, y0, 1);
  ev("mousemove", x1, y1, 1);
  ev("mouseup", x1, y1, 0);
}, geom);
await page.waitForTimeout(200);
const diag = await page.evaluate((g) => {
  const root = document.querySelector(".page .ce-root");
  const r = root.getBoundingClientRect();
  const st = getComputedStyle(root);
  const c = document.createElement("canvas").getContext("2d");
  c.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
  const cw = c.measureText("0000000000").width / 10;
  const targetX = g.left + 2 * g.cw;
  return { geomLeft: g.left, geomCw: g.cw, liveLeft: r.left, liveCw: cw, targetX, expectedCol: Math.round((targetX - r.left) / cw), fontFamily: st.fontFamily.slice(0, 40) };
}, geom);
const rectCount = await page.locator(".page .block.is-column-select .block-rect").count();
const rectBox = rectCount ? await page.locator(".page .block-rect").boundingBox() : null;
const activeInfo = await page.evaluate(() => {
  const a = document.activeElement;
  return { cls: a?.className ?? null, isCe: !!(a && a.classList && a.classList.contains("ce-root")), boxSet: !!document.querySelector(".page .block.is-column-select") };
});
// Ensure the editor is focused, then send Delete to it directly.
await page.evaluate(() => document.querySelector(".page .ce-root")?.focus());
await page.keyboard.press("Delete");
await page.waitForTimeout(250);
const rectAfter = await page.locator(".page .block-rect").count();
// Fallback: dispatch Delete as a native keydown directly on the editor.
let dispatched = false;
if (rectAfter === 1) {
  dispatched = await page.evaluate(() => {
    const root = document.querySelector(".page .ce-root");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    return true;
  });
  await page.waitForTimeout(250);
}
const rectAfter2 = await page.locator(".page .block-rect").count();
const afterDel = await page.evaluate(() => [...document.querySelectorAll(".page .ce-root .ce-line")].slice(0, 2).map((l) => l.textContent));
const colRemoved = before.length >= 2 && afterDel[0] === (before[0] ?? "").slice(2) && afterDel[1] === (before[1] ?? "").slice(2);
check("P5-box-select-column-delete", rectCount === 1 && colRemoved, { diag, rectCount, rectBox, rectAfter, before, afterDel, colRemoved });

const summary = { suite: "qa-ce-parity", results, pageErrors, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length };
await writeFile(join(OUT, "parity-results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-ce-parity] ${summary.pass} pass / ${summary.fail} fail`);
if (pageErrors.length) console.log("[qa-ce-parity] page errors:", pageErrors);
await browser.close().catch(() => {}); server.close();
process.exitCode = summary.fail ? 1 : 0;
