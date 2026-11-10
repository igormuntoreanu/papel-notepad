/**
 * 0.5.2 — two-row sheet header. The sheet title sits on row 1 and the whole toolbar
 * (tools + save + delete) on row 2, so a variable-width Font/Style label can never
 * shove the title around or move the title row's wrap point.
 *   TB1 structure: title row holds the title (not the tools); tools row holds the toolbar
 *   TB2 stability: changing to a long font name leaves the title row's box unchanged
 *
 *   npm run build:desktop && node scripts/qa-toolbar.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "toolbar");
const PORT = 8094;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-toolbar] run npm run build:desktop first"); process.exit(2); }
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
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e)));
let shotN = 0;
async function snap(n) { shotN += 1; const f = `${String(shotN).padStart(2, "0")}-${n.replace(/[^a-z0-9-]+/gi, "-").slice(0, 50)}.png`; try { await page.screenshot({ path: join(OUT, f), timeout: 8000 }); return f; } catch { return null; } }

await page.addInitScript(() => {
  try { localStorage.setItem("papel-ce", "1"); } catch {}
  const dir = { id: "d", name: "d" }; const files = new Map(); let maximized = false; window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.5.2"; }, async minimize() {}, async toggleMaximize() { maximized = !maximized; }, async isMaximized() { return maximized; }, async close() {}, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = (id, title, text, wrap = true) => ({ id, title, wrap, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] });
  const doc = { notes: [note("tb", "Untitled", "alpha\nbeta\ngamma")], order: ["tb"], activeId: null };
  const prefs = { skin: "sulphite", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Untitled", exact: true }).first().click();
await page.waitForTimeout(500);

// Helpers ------------------------------------------------------------------
function struct() {
  return page.evaluate(() => {
    const titleRow = document.querySelector(".sheet-title-row");
    const toolsRow = document.querySelector(".sheet-tools-row");
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left) }; };
    return {
      titleRowHasTitle: !!titleRow?.querySelector(".sheet-title"),
      titleRowHasTools: !!titleRow?.querySelector(".sheet-tools"),
      toolsRowHasTools: !!toolsRow?.querySelector(".sheet-tools, .findbar"),
      toolsRowHasDelete: !!toolsRow?.querySelector('[aria-label^="Delete sheet"]'),
      toolsRowHasSave: !!toolsRow?.querySelector('[aria-label^="Save"]'),
      titleRect: rect(titleRow),
      toolsRect: rect(toolsRow),
    };
  });
}
async function setSel(line, col) {
  await page.evaluate(({ line, col }) => {
    const root = document.querySelector(".page .ce-root"); root.focus();
    const lines = [...root.querySelectorAll(".ce-line")];
    const w = document.createTreeWalker(lines[line], NodeFilter.SHOW_TEXT);
    let n, acc = 0, node = lines[line], off = 0;
    while ((n = w.nextNode())) { const l = n.textContent.length; if (acc + l >= col) { node = n; off = col - acc; break; } acc += l; }
    const r = document.createRange(); r.setStart(node, off); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, { line, col });
  await page.waitForTimeout(120);
}
async function applyFont(name) {
  await page.getByRole("button", { name: /^Font:/ }).first().click();
  await page.waitForTimeout(160);
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).first().click();
  await page.waitForTimeout(220);
}

// TB1 — two-row structure ---------------------------------------------------
let s = await struct();
check("TB1-two-row-structure",
  s.titleRowHasTitle && !s.titleRowHasTools && s.toolsRowHasTools && s.toolsRowHasDelete && s.toolsRowHasSave &&
  s.toolsRect.top > s.titleRect.top,
  s);
await snap("TB1-header-two-rows");

// TB2 — title row does not move when the font label grows -------------------
const before = s.titleRect;
await setSel(1, 2);
await applyFont("JetBrains Mono"); // a long face name
await snap("TB2-after-long-font");
s = await struct();
const after = s.titleRect;
const toolsGrewOrSame = s.toolsRect.height >= before.height; // tools may wrap, title must not
check("TB2-title-row-stable-on-font-change",
  Math.abs(after.top - before.top) <= 1 && Math.abs(after.height - before.height) <= 1 && toolsGrewOrSame,
  { titleBefore: before, titleAfter: after, toolsRow: s.toolsRect });

// TB3 — the Font menu button keeps a constant width across short/long face names, so the
// toolbar row cannot re-wrap when the selection changes (the fixed-width label slot).
async function fontBtnBox() {
  return page.evaluate(() => {
    const b = document.querySelector('button[aria-label^="Font:"]');
    const tools = document.querySelector(".sheet-tools-row");
    const br = b?.getBoundingClientRect();
    return { btnW: br ? Math.round(br.width) : null, toolsH: tools ? Math.round(tools.getBoundingClientRect().height) : null };
  });
}
await setSel(1, 2); await applyFont("Inter");          // short name
const wInter = await fontBtnBox();
await setSel(1, 2); await applyFont("JetBrains Mono"); // longest name
const wJet = await fontBtnBox();
await setSel(1, 2); await applyFont("Lato");           // short name
const wLato = await fontBtnBox();
await snap("TB3-font-menu-width");
check("TB3-font-menu-width-stable",
  wInter.btnW === wJet.btnW && wJet.btnW === wLato.btnW &&
  wInter.toolsH === wJet.toolsH && wJet.toolsH === wLato.toolsH,
  { inter: wInter, jetbrainsMono: wJet, lato: wLato });

const summary = { suite: "qa-toolbar (two-row header)", results, pageErrors, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-toolbar] ${summary.pass} pass / ${summary.fail} fail -> ${join(OUT, "results.json")}`);
if (pageErrors.length) console.log("[qa-toolbar] page errors:", pageErrors);
await browser.close().catch(() => {}); server.close();
process.exitCode = summary.fail ? 1 : 0;
