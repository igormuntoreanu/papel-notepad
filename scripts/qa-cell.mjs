/**
 * Phase 5 — table cells: per-cell alignment (BUG-2) + the block face reaching cells (BUG-3).
 *   C1 focus a cell, Align centre -> only that cell centres (data-align + computed text-align)
 *   C2 pick a font -> the table block gets data-font and the cell textarea uses that family
 *   C3 undo -> the cell alignment reverts, text intact
 *   C4 alignment + font persist across a reload
 *
 *   npm run build:desktop && node scripts/qa-cell.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "cell-ce");
const PORT = 8097;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-cell] run npm run build:desktop first"); process.exit(2); }
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
  const cells = [{ t: "a", f: 0 }, { t: "b", f: 0 }, { t: "c", f: 0 }, { t: "d", f: 0 }];
  const note = { id: "cell", title: "Cell", wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "table", cols: 2, cells }] };
  const doc = { notes: [note], order: ["cell"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: false, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Cell", exact: true }).first().click();
await page.waitForTimeout(600);

// Helpers ------------------------------------------------------------------
const cellInfo = () => page.evaluate(() => [...document.querySelectorAll(".table-block .cell")].map((c) => {
  const ta = c.querySelector("textarea.cell-input");
  return { align: c.getAttribute("data-align"), textAlign: ta ? getComputedStyle(ta).textAlign : null, text: ta?.value ?? "" };
}));
async function focusCell(row, col) {
  await page.getByLabel(`Row ${row + 1}, column ${col + 1}`).click();
  await page.waitForTimeout(150);
}
const alignBtn = (name) => page.getByRole("button", { name, exact: true }).first();

const hasTable = (await page.locator(".table-block").count()) > 0;
check("table-present", hasTable, { tables: await page.locator(".table-block").count() });
if (!hasTable) { await browser.close(); server.close(); process.exit(1); }

// C1 — focus cell (0,0), Align centre -> only that cell centres --------------
await focusCell(0, 0);
const centreEnabled = await alignBtn("Align centre").isEnabled();
await alignBtn("Align centre").click();
await page.waitForTimeout(250);
let ci = await cellInfo();
check("C1-cell-align-centre",
  centreEnabled && ci[0].align === "center" && ci[0].textAlign === "center" && ci[1].align === "left" && ci[2].align === "left",
  { centreEnabled, cells: ci.map((x) => `${x.text}:${x.align}/${x.textAlign}`) });
await snap("C1-cell-centre");

// C2 — pick a font -> the table block carries data-font and the cell uses it --
await focusCell(0, 0);
await page.getByRole("button", { name: /^Font:/ }).first().click();
await page.waitForTimeout(180);
await page.getByRole("menuitemradio", { name: /Inter/ }).first().click();
await page.waitForTimeout(250);
const fontInfo = await page.evaluate(() => {
  const block = document.querySelector(".table-block");
  const ta = document.querySelector(".table-block textarea.cell-input");
  const trigger = document.querySelector('button[aria-label^="Font:"]');
  const anyDataFont = [...document.querySelectorAll("[data-font]")].map((e) => `${e.className}=${e.getAttribute("data-font")}`);
  return { dataFont: block?.getAttribute("data-font") ?? null, family: ta ? getComputedStyle(ta).fontFamily : null, trigger: trigger?.getAttribute("aria-label") ?? null, anyDataFont };
});
check("C2-font-reaches-cell",
  fontInfo.dataFont === "inter" && /Inter/i.test(fontInfo.family ?? ""),
  fontInfo);
await snap("C2-font-inter");

// C3 — undo reverts the cell alignment, text intact --------------------------
await focusCell(0, 0);
const textBefore = (await cellInfo())[0].text;
await page.keyboard.press("Control+z"); // undo the font? (look is not core-undo) then align
await page.waitForTimeout(150);
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
ci = await cellInfo();
check("C3-undo-reverts-cell-align",
  ci[0].align === "left" && ci[0].text === textBefore,
  { cells: ci.map((x) => `${x.text}:${x.align}`), textBefore });
await snap("C3-undo");

// C4 — alignment + font persist across a reload ------------------------------
await focusCell(1, 1);
await alignBtn("Align right").click();
await page.waitForTimeout(700); // > 400ms autosave debounce
await page.reload();
await page.waitForTimeout(1400);
if ((await page.locator(".table-block").count()) === 0) {
  await page.getByRole("button", { name: "Cell", exact: true }).first().click();
  await page.waitForTimeout(600);
}
const persisted = await cellInfo();
const persistedFont = await page.evaluate(() => document.querySelector(".table-block")?.getAttribute("data-font") ?? null);
check("C4-cell-align-font-persist",
  persisted.length >= 4 && persisted[3].align === "right" && persistedFont === "inter",
  { cells: persisted.map((x) => `${x.text}:${x.align}`), persistedFont });
await snap("C4-after-reload");

const summary = { suite: "qa-cell (table cells)", results, pageErrors, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-cell] ${summary.pass} pass / ${summary.fail} fail -> ${join(OUT, "results.json")}`);
if (pageErrors.length) console.log("[qa-cell] page errors:", pageErrors);
await browser.close().catch(() => {}); server.close();
process.exitCode = summary.fail ? 1 : 0;
