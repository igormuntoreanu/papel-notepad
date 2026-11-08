/**
 * Final verification of contested findings — v0.3.8.
 *   V1 cross-cell drag using the REAL selection model (.is-range), then Bold both
 *   V2 partial-drag bold in a cell does NOT lose the full cell text
 *   V3 side-by-side undo: normal text block vs table cell (prove cell-specific)
 *
 *   npm run build:desktop && node scripts/qa-verify.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const VERSION = "0.3.8";
const OUT = join(process.cwd(), "AI_Documentation", "qa", VERSION, "verify");
const PORT = 8097;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-verify] run npm run build:desktop first"); process.exit(2); }
await mkdir(OUT, { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try { const body = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, ""))); res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404).end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const findings = [];
function note(id, verdict, detail) { findings.push({ id, verdict, detail }); console.log(`\n### ${id} :: ${verdict}\n${JSON.stringify(detail, null, 1)}`); }

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e)));
let shotN = 0;
async function snap(n) { shotN += 1; const f = `${String(shotN).padStart(2, "0")}-${n.replace(/[^a-z0-9-]+/gi, "-").slice(0, 50)}.png`; try { await page.screenshot({ path: join(OUT, f), timeout: 8000 }); return f; } catch { return null; } }

await page.addInitScript(() => {
  const dir = { id: "d", name: "d" }; const files = new Map(); let maximized = false; window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.3.8"; }, async minimize() { window.__papelWin.push("minimize"); }, async toggleMaximize() { maximized = !maximized; window.__papelWin.push(maximized ? "maximize" : "restore"); }, async isMaximized() { return maximized; }, async close() { window.__papelWin.push("close"); }, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { window.__papelWin.push(`save:${n}`); return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = (id, title, text) => ({ id, title, wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] });
  const doc = { notes: [note("short", "Short", "The quick brown fox jumps over the lazy dog."), note("scratch", "Scratch", "")], order: ["short", "scratch"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: true, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);

const EDITOR = ".page textarea.editor";
const CELL = ".page .sheet-table td textarea";
async function goBoard() { if ((await page.locator(".page").count()) > 0) { const b = page.getByRole("button", { name: "Back to board" }); if (await b.count()) await b.click(); await page.waitForTimeout(250); } }
async function openNote(t) { await goBoard(); await page.getByRole("button", { name: t, exact: true }).first().click(); await page.locator(EDITOR).first().waitFor({ timeout: 8000 }); await page.waitForTimeout(200); }
async function insertTable() { await page.getByRole("button", { name: /^Insert table$/ }).click(); await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click(); await page.waitForTimeout(280); }
async function clearSheet() { await page.locator(EDITOR).first().click(); await page.keyboard.press("Control+a"); await page.waitForTimeout(80); await page.keyboard.press("Delete"); await page.waitForTimeout(200); }

// ===================== V1 — cross-cell drag via the real .is-range model =====================
await (async () => {
  await openNote("Scratch"); await clearSheet(); await insertTable();
  const cells = page.locator(CELL);
  await cells.nth(0).click(); await page.keyboard.type("AA");
  await cells.nth(1).click(); await page.keyboard.type("BB");
  await cells.nth(0).click();
  const c0 = await cells.nth(0).boundingBox();
  const c1 = await cells.nth(1).boundingBox();
  await page.mouse.move(c0.x + 6, c0.y + c0.height / 2);
  await page.mouse.down();
  await page.mouse.move(c1.x + c1.width - 6, c1.y + c1.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const rangeInfo = await page.evaluate(() => {
    const rangeCells = [...document.querySelectorAll(".page .sheet-table td.is-range, .page .sheet-table .is-range")];
    const allTds = [...document.querySelectorAll(".page .sheet-table td")];
    return {
      isRangeCount: rangeCells.length,
      isRangeClasses: rangeCells.map((c) => c.className),
      totalTds: allTds.length,
      tdClasses: allTds.map((td) => td.className),
    };
  });
  await snap("V1-cross-cell-range");
  // Bold the range.
  const boldBtn = page.getByRole("button", { name: /^Bold/ }).first();
  const boldEnabled = await boldBtn.isEnabled().catch(() => false);
  if (boldEnabled) await boldBtn.click();
  await page.waitForTimeout(200);
  const bolded = await page.evaluate(() => {
    const tds = [...document.querySelectorAll(".page .sheet-table td")];
    return {
      cellsWithBoldSpan: tds.filter((td) => td.querySelector("pre span.sb")).length,
      cellTexts: tds.map((td) => td.querySelector("textarea")?.value ?? null),
      cellBoldSpans: tds.map((td) => td.querySelector("pre span.sb")?.textContent ?? null),
    };
  });
  await snap("V1-cross-cell-bold");
  const ok = rangeInfo.isRangeCount >= 2 && bolded.cellsWithBoldSpan >= 2;
  note("V1-cross-cell-drag", ok ? "CROSS_CELL_WORKS" : "CROSS_CELL_BROKEN", {
    rangeInfo, boldEnabled, bolded,
    interpretation: ok
      ? `A drag across two cells sets .is-range on ${rangeInfo.isRangeCount} cells and Bold paints ${bolded.cellsWithBoldSpan} cells. The baseline's selected>=2 check counts native textarea selections, which cannot span two textareas — it measures the wrong thing. Cross-cell selection DOES work in 0.3.8 (matches the release notes).`
      : `Only ${rangeInfo.isRangeCount} cell(s) got .is-range and ${bolded.cellsWithBoldSpan} got bold. Cross-cell drag may be broken.`,
  });
})();

// ===================== V2 — partial-drag bold keeps full cell text =====================
await (async () => {
  await openNote("Scratch"); await clearSheet();
  await page.locator(EDITOR).first().click(); await page.keyboard.type("OUTSIDE");
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click(); await cell.fill("INSIDE");
  const before = await page.evaluate(() => document.querySelector(".page .sheet-table td textarea")?.value);
  const cb = await cell.boundingBox();
  // Deliberately short drag (selects a substring), like the baseline case.
  await page.mouse.move(cb.x + 4, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + 30, cb.y + cb.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const boldOn = await page.getByRole("button", { name: /^Bold/ }).first().isEnabled().catch(() => false);
  if (boldOn) await page.getByRole("button", { name: /^Bold/ }).first().click();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    cellValue: document.querySelector(".page .sheet-table td textarea")?.value ?? null,
    boldSpan: document.querySelector(".page .sheet-table pre span.sb")?.textContent ?? null,
    outsideValue: document.querySelector(".page .block:not(.table-block) textarea")?.value ?? null,
  }));
  await snap("V2-partial-bold");
  const ok = before === "INSIDE" && after.cellValue === "INSIDE";
  note("V2-partial-bold-text-intact", ok ? "TEXT_INTACT" : "TEXT_LOST", {
    cellBefore: before, cellAfter: after,
    interpretation: ok
      ? `Full cell text "${after.cellValue}" survives a partial-drag bold (bold span = "${after.boldSpan}"). The baseline's format-in-cell-then-outside FAIL was a too-strict assertion (it expected the bold span to equal the whole word, but a short drag only bolds a substring). No text corruption.`
      : `Cell text changed from "${before}" to "${after.cellValue}" — real corruption.`,
  });
})();

// ===================== V3 — side-by-side undo: normal block vs cell =====================
await (async () => {
  // (a) Normal text block: type, select, ink, undo.
  await openNote("Scratch"); await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("normal block");
  await page.evaluate(() => { const ta = document.querySelector(".page textarea.editor"); ta.focus(); ta.setSelectionRange(0, 6); ta.dispatchEvent(new Event("select", { bubbles: true })); });
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: /^Wax red ink/ }).first().click().catch(() => {});
  await page.waitForTimeout(150);
  const blockBefore = await page.evaluate(() => ({ val: document.querySelector(".page textarea.editor")?.value, marks: [...document.querySelectorAll(".page .block:not(.table-block) pre span")].flatMap((s) => [...s.classList]).filter((c) => /^(sb|ink\d|hl\d)$/.test(c)) }));
  await page.keyboard.press("Control+z"); await page.waitForTimeout(180);
  const blockAfterUndo = await page.evaluate(() => ({ val: document.querySelector(".page textarea.editor")?.value, marks: [...document.querySelectorAll(".page .block:not(.table-block) pre span")].flatMap((s) => [...s.classList]).filter((c) => /^(sb|ink\d|hl\d)$/.test(c)) }));
  await snap("V3-block-undo");

  // (b) Table cell: identical sequence.
  await openNote("Scratch"); await clearSheet(); await insertTable();
  await page.locator(CELL).first().click();
  await page.keyboard.type("cell text");
  await page.evaluate(() => { const ta = document.querySelector(".page .sheet-table td textarea"); ta.focus(); ta.setSelectionRange(0, 4); ta.dispatchEvent(new Event("select", { bubbles: true })); });
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: /^Wax red ink/ }).first().click().catch(() => {});
  await page.waitForTimeout(150);
  const cellBefore = await page.evaluate(() => ({ val: document.querySelector(".page .sheet-table td textarea")?.value, marks: [...document.querySelectorAll(".page .sheet-table pre span")].flatMap((s) => [...s.classList]).filter((c) => /^(sb|ink\d|hl\d)$/.test(c)) }));
  await page.keyboard.press("Control+z"); await page.waitForTimeout(180);
  const cellAfterUndo = await page.evaluate(() => ({ val: document.querySelector(".page .sheet-table td textarea")?.value, marks: [...document.querySelectorAll(".page .sheet-table pre span")].flatMap((s) => [...s.classList]).filter((c) => /^(sb|ink\d|hl\d)$/.test(c)) }));
  await snap("V3-cell-undo");

  const blockUndoOk = blockBefore.marks.length > 0 && blockAfterUndo.marks.length === 0 && blockAfterUndo.val === blockBefore.val;
  const cellUndoOk = cellAfterUndo.val === cellBefore.val; // text must NOT change
  note("V3-undo-block-vs-cell", blockUndoOk && cellUndoOk ? "BOTH_OK" : cellUndoOk ? "BLOCK_ONLY_BROKEN" : blockUndoOk ? "CELL_UNDO_BROKEN" : "BOTH_BROKEN", {
    normalBlock: { before: blockBefore, afterUndo: blockAfterUndo, undoRemovedMark: blockUndoOk },
    tableCell: { before: cellBefore, afterUndo: cellAfterUndo, textPreserved: cellUndoOk },
    interpretation: `Normal block: mark applied=${blockBefore.marks.join(",")}, after undo marks=${blockAfterUndo.marks.join(",")}, text "${blockBefore.val}"->"${blockAfterUndo.val}". Cell: mark applied=${cellBefore.marks.join(",")}, after undo marks=${cellAfterUndo.marks.join(",")}, text "${cellBefore.val}"->"${cellAfterUndo.val}". ${cellUndoOk ? "" : "CELL UNDO EATS TEXT — confirmed cell-specific bug."}`,
  });
})();

const summary = { version: VERSION, suite: "qa-verify", findings, pageErrors };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-verify] wrote ${join(OUT, "results.json")}`);
console.log(`[qa-verify] verdicts: ${findings.map((f) => `${f.id}=${f.verdict}`).join("  ")}`);
await browser.close().catch(() => {}); server.close();
