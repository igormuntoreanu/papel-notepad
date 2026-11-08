/**
 * Focused re-test of the ambiguous qa-creative findings — v0.3.8.
 *
 * Separates genuine product bugs from harness errors for:
 *   R1 cell alignment (B4/E4)   — is Align enabled with a cell focused, and where does it land?
 *   R2 fonts (B5/F1)            — correct `Font:` selector; cycle all 9 faces outside + inside a cell
 *   R3 undo-in-cell corruption (H1) — isolate exactly which step eats the text
 *   R4 wrap-off horizontal scroll (E2) — find the real scroll container
 *
 *   npm run build:desktop && node scripts/qa-retest.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const VERSION = "0.3.8";
const OUT = join(process.cwd(), "AI_Documentation", "qa", VERSION, "retest");
const PORT = 8096;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };

if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-retest] run npm run build:desktop first"); process.exit(2); }
await mkdir(OUT, { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "")));
    res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const findings = [];
function note(id, verdict, detail) {
  findings.push({ id, verdict, detail });
  console.log(`\n### ${id} :: ${verdict}`);
  console.log(JSON.stringify(detail, null, 1));
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

let shotN = 0;
async function snap(name) {
  shotN += 1;
  const file = `${String(shotN).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 50)}.png`;
  try { await page.screenshot({ path: join(OUT, file), timeout: 8000 }); return file; } catch { return null; }
}

await page.addInitScript(() => {
  const dir = { id: "d", name: "d" }; const files = new Map(); let maximized = false;
  window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = {
    version: 2,
    async appVersion() { return "0.3.8"; },
    async minimize() { window.__papelWin.push("minimize"); },
    async toggleMaximize() { maximized = !maximized; window.__papelWin.push(maximized ? "maximize" : "restore"); },
    async isMaximized() { return maximized; },
    async close() { window.__papelWin.push("close"); },
    async pickDirectory() { return dir; },
    async resolveDirectory() { return dir; },
    async readFile(_id, name) { return files.get(name) ?? null; },
    async writeFile(_id, name, bytes) { files.set(name, bytes); },
    async removeFile(_id, name) { files.delete(name); },
    async listFiles() { return [...files.keys()]; },
    async saveFile(name) { window.__papelWin.push(`save:${name}`); return true; },
  };
});

await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = (id, title, text) => ({ id, title, wrap: true, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] });
  const doc = { notes: [note("short", "Short", "The quick brown fox jumps over the lazy dog."), note("scratch", "Scratch", "")], order: ["short", "scratch"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: true, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((resolve, reject) => {
    const rq = indexedDB.open("papel", 1);
    rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); };
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); };
  });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);

const EDITOR = ".page textarea.editor";
const CELL = ".page .sheet-table td textarea";
async function goBoard() { if ((await page.locator(".page").count()) > 0) { const b = page.getByRole("button", { name: "Back to board" }); if (await b.count()) await b.click(); await page.waitForTimeout(250); } }
async function openNote(t) { await goBoard(); await page.getByRole("button", { name: t, exact: true }).first().click(); await page.locator(EDITOR).first().waitFor({ timeout: 8000 }); await page.waitForTimeout(200); }
async function insertTable() { await page.getByRole("button", { name: /^Insert table$/ }).click(); await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click(); await page.waitForTimeout(280); }
async function clearSheet() { await page.locator(EDITOR).first().click(); await page.keyboard.press("Control+a"); await page.waitForTimeout(80); await page.keyboard.press("Delete"); await page.waitForTimeout(200); }
async function realSelect(sel, start, end) { await page.locator(sel).first().click(); await page.keyboard.press("Control+Home"); await page.waitForTimeout(40); for (let i = 0; i < start; i++) await page.keyboard.press("ArrowRight"); for (let i = start; i < end; i++) await page.keyboard.press("Shift+ArrowRight"); await page.waitForTimeout(120); }
async function btnState(re) { return page.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll("button")].find((x) => r.test(x.getAttribute("aria-label") || x.title || "")); return b ? { present: true, disabled: b.hasAttribute("disabled"), label: b.getAttribute("aria-label") || b.title } : { present: false }; }, re.source); }

// ===================== R1 — cell alignment ground truth =====================
await (async () => {
  await openNote("Scratch"); await clearSheet();
  await page.locator(EDITOR).first().click(); await page.keyboard.type("outside text");
  await insertTable();
  await page.locator(CELL).first().click(); await page.keyboard.type("inside");
  const alignStateCell = await btnState(/^Align centre$/);
  // Click Align centre with the CELL focused, then dump every plausible target.
  await page.getByRole("button", { name: "Align centre", exact: true }).click().catch(() => {});
  await page.waitForTimeout(180);
  const afterCell = await page.evaluate(() => {
    const td = document.querySelector(".page .sheet-table td");
    const cellTa = document.querySelector(".page .sheet-table td textarea");
    const tblBlock = document.querySelector(".page .table-block");
    const firstBlock = document.querySelector(".page .block");
    return {
      td_data_align: td?.getAttribute("data-align"),
      td_computed_textAlign: td ? getComputedStyle(td).textAlign : null,
      cellTa_computed_textAlign: cellTa ? getComputedStyle(cellTa).textAlign : null,
      tableBlock_data_align: tblBlock?.getAttribute("data-align"),
      firstBlock_data_align: firstBlock?.getAttribute("data-align"),
      firstBlock_isTable: firstBlock?.classList.contains("table-block"),
    };
  });
  await snap("R1-align-cell");
  // Now focus the OUTSIDE text block and align centre — where does it land?
  await page.locator(EDITOR).first().click();
  await page.getByRole("button", { name: "Align centre", exact: true }).click().catch(() => {});
  await page.waitForTimeout(180);
  const afterOutside = await page.evaluate(() => {
    const td = document.querySelector(".page .sheet-table td");
    const blocks = [...document.querySelectorAll(".page .block")];
    const textBlock = blocks.find((b) => !b.classList.contains("table-block"));
    return { td_data_align: td?.getAttribute("data-align"), textBlock_data_align: textBlock?.getAttribute("data-align"), allBlockAligns: blocks.map((b) => b.getAttribute("data-align")) };
  });
  const cellAlignWorks = afterCell.td_data_align === "center" || afterCell.td_computed_textAlign === "center" || afterCell.tableBlock_data_align === "center";
  note("R1-cell-alignment", cellAlignWorks ? "CELL_ALIGN_WORKS" : "CELL_ALIGN_BROKEN", {
    alignButtonEnabledWithCellFocused: alignStateCell,
    afterAlignCentreOnCell: afterCell,
    afterAlignCentreOnOutsideBlock: afterOutside,
    interpretation: cellAlignWorks
      ? "Alignment reaches the cell/table — B4/E4 were harness measurement errors."
      : "Align centre with a cell focused changes NOTHING on the cell, the table block, or computed style. Alignment is a no-op inside table cells.",
  });
})();

// ===================== R2 — fonts (correct selector) =====================
await (async () => {
  const faces = ["IBM Plex Sans", "IBM Plex Mono", "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "JetBrains Mono"];
  await openNote("Short");
  await page.locator(EDITOR).first().click();
  const fontBtnState = await btnState(/^Font:/);
  const outside = [];
  for (const face of faces) {
    await page.locator(EDITOR).first().click();
    const fb = page.getByRole("button", { name: /^Font:/ }).first();
    if ((await fb.count()) === 0) { outside.push(`${face}:NO_BTN`); continue; }
    await fb.click(); await page.waitForTimeout(140);
    const item = page.getByRole("menuitemradio", { name: new RegExp(`^${face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
    if ((await item.count()) === 0) { outside.push(`${face}:NO_ITEM`); await page.keyboard.press("Escape"); continue; }
    const itemDisabled = await item.first().isDisabled().catch(() => true);
    if (itemDisabled) { outside.push(`${face}:DISABLED`); await page.keyboard.press("Escape"); continue; }
    await item.first().click(); await page.waitForTimeout(160);
    const got = await page.evaluate(() => document.querySelector(".page .block")?.getAttribute("data-font"));
    outside.push(`${face}->data-font=${got}`);
  }
  await snap("R2-fonts-outside");
  // Inside a cell.
  await openNote("Scratch"); await clearSheet(); await insertTable();
  await page.locator(CELL).first().click(); await page.keyboard.type("cell font");
  const fontBtnInCell = await btnState(/^Font:/);
  let cellFontResult = "NO_BTN";
  const fb2 = page.getByRole("button", { name: /^Font:/ }).first();
  if ((await fb2.count()) > 0) {
    await fb2.click(); await page.waitForTimeout(150);
    const mono = page.getByRole("menuitemradio", { name: /^IBM Plex Mono$/ });
    if ((await mono.count()) > 0 && !(await mono.first().isDisabled().catch(() => true))) {
      await mono.first().click(); await page.waitForTimeout(180);
      cellFontResult = await page.evaluate(() => {
        const td = document.querySelector(".page .sheet-table td");
        const tbl = document.querySelector(".page .table-block");
        const firstBlock = document.querySelector(".page .block");
        return { td_data_font: td?.getAttribute("data-font"), tableBlock_data_font: tbl?.getAttribute("data-font"), firstBlock_data_font: firstBlock?.getAttribute("data-font") };
      });
    } else cellFontResult = "MENU_ITEM_DISABLED_OR_MISSING";
  }
  await snap("R2-fonts-cell");
  const outsideOk = outside.every((o) => o.includes("data-font=") && !o.includes("null"));
  note("R2-fonts", outsideOk ? "FONTS_WORK_OUTSIDE" : "FONTS_ISSUE", {
    fontButtonState: fontBtnState, outsideCycle: outside, fontButtonInCell: fontBtnInCell, cellFontResult,
    interpretation: `Outside: ${outside.filter((o) => o.includes("null") || o.includes("NO_") || o.includes("DISABLED")).length}/${faces.length} problematic. Cell font control present=${fontBtnInCell.present}.`,
  });
})();

// ===================== R3 — undo-in-cell corruption, isolated =====================
await (async () => {
  // R3a: plain typing in a cell, then undo — does text corrupt without any styling?
  await openNote("Scratch"); await clearSheet(); await insertTable();
  await page.locator(CELL).first().click();
  await page.keyboard.type("abcdefgh");
  const typed = await page.evaluate(() => document.querySelector(".page .sheet-table td textarea")?.value);
  const steps = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Control+z"); await page.waitForTimeout(140);
    const v = await page.evaluate(() => document.querySelector(".page .sheet-table td textarea")?.value);
    steps.push(v);
    if (v === "") break;
  }
  const plainUndoOk = steps[steps.length - 1] === "" && typed === "abcdefgh";
  await snap("R3a-plain-undo");

  // R3b: the H1 sequence, snapshotting after EVERY step to find the corrupting one.
  await openNote("Scratch"); await clearSheet(); await insertTable();
  await page.locator(CELL).first().click();
  await page.keyboard.type("stack me");
  const trace = [];
  const cellVal = () => page.evaluate(() => document.querySelector(".page .sheet-table td textarea")?.value ?? null);
  const marks = () => page.evaluate(() => { const r = document.querySelector(".page .sheet-table"); const s = new Set(); r?.querySelectorAll("pre span").forEach((x) => x.classList.forEach((c) => { if (/^(sb|si|su|ss|ink\d|hl\d)$/.test(c)) s.add(c); })); return [...s]; });
  trace.push({ step: "typed", val: await cellVal(), marks: await marks() });
  await realSelect(CELL, 0, 5); await page.getByRole("button", { name: /^Bold/ }).first().click(); await page.waitForTimeout(150);
  trace.push({ step: "bold(0,5)", val: await cellVal(), marks: await marks() });
  await realSelect(CELL, 0, 5); await page.getByRole("button", { name: /^Wax red ink/ }).first().click(); await page.waitForTimeout(150);
  trace.push({ step: "ink(0,5)", val: await cellVal(), marks: await marks() });
  await realSelect(CELL, 0, 5); await page.getByRole("button", { name: /^Yellow highlighter/ }).first().click(); await page.waitForTimeout(150);
  trace.push({ step: "hl(0,5)", val: await cellVal(), marks: await marks() });
  // Now undo one step at a time, tracing.
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press("Control+z"); await page.waitForTimeout(160);
    trace.push({ step: `undo#${i}`, val: await cellVal(), marks: await marks() });
  }
  await snap("R3b-cell-undo-trace");
  const corrupted = trace.find((t) => t.val !== null && t.val !== "stack me" && t.val !== "" && !t.step.startsWith("typed"));
  const textLost = trace.some((t) => t.step.startsWith("undo") && typeof t.val === "string" && t.val.length > 0 && t.val.length < 8 && t.val !== "stack me");
  note("R3-undo-in-cell", textLost ? "UNDO_CORRUPTS_CELL_TEXT" : plainUndoOk ? "UNDO_OK" : "UNDO_PARTIAL", {
    plainTypingUndo: { typed, steps, plainUndoOk },
    styledTrace: trace,
    corruptingStep: corrupted?.step ?? null,
    interpretation: textLost
      ? `Confirmed: undo inside a table cell loses characters. Trace shows cell text degenerating away from "stack me". First anomaly at "${corrupted?.step}".`
      : "Undo round-trips the cell text cleanly; H1 corruption was a harness artifact of repeated realSelect.",
  });
})();

// ===================== R4 — wrap-off horizontal scroll container =====================
await (async () => {
  await openNote("Scratch"); await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("x".repeat(400));
  const wrapBtn = page.getByRole("button", { name: /^Word wrap$/ }).first();
  const wrapBefore = await page.evaluate(() => document.querySelector(".page")?.getAttribute("data-wrap"));
  if ((await wrapBtn.count()) > 0) { await wrapBtn.click(); await page.waitForTimeout(220); }
  const probe = await page.evaluate(() => {
    const cands = {
      ".sheet": document.querySelector(".sheet"),
      ".page": document.querySelector(".page"),
      ".page .block": document.querySelector(".page .block"),
      ".page .block pre": document.querySelector(".page .block pre"),
      ".page .block .editor": document.querySelector(".page .block .editor"),
    };
    const out = {};
    for (const [k, el] of Object.entries(cands)) {
      if (!el) { out[k] = "missing"; continue; }
      out[k] = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: getComputedStyle(el).overflowX, scrolls: el.scrollWidth > el.clientWidth + 1 };
    }
    return out;
  });
  await snap("R4-wrap-off");
  const anyScrolls = Object.values(probe).some((v) => v && v.scrolls === true);
  note("R4-wrap-off-scroll", anyScrolls ? "H_SCROLL_PRESENT" : "NO_H_SCROLL", {
    wrapBefore, wrapAfter: await page.evaluate(() => document.querySelector(".page")?.getAttribute("data-wrap")), probe,
    interpretation: anyScrolls ? "Some container scrolls horizontally with wrap off — E2 measured the wrong element." : "With wrap off and a 400-char line, NO container reports scrollWidth>clientWidth. Either the line is clipped or wrap-off does not enable sideways scrolling.",
  });
})();

const summary = { version: VERSION, suite: "qa-retest", findings, pageErrors };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-retest] wrote ${join(OUT, "results.json")}`);
console.log(`[qa-retest] verdicts: ${findings.map((f) => `${f.id}=${f.verdict}`).join("  ")}`);
await browser.close().catch(() => {});
server.close();
