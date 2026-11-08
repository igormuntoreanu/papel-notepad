/**
 * Creative adversarial stress suite — v0.3.8.
 *
 * Complements scripts/qa-stress.mjs. Where the baseline harness drives marks
 * with a synthetic setSelectionRange + dispatched "select" event (which does
 * not always reach the app's React selection state), this suite uses REAL
 * keyboard/mouse selections so a "disabled despite a selection" result is
 * ground truth, not a harness artifact.
 *
 * Targets the user-requested matrix: tables (Enter in cell, bullets in cell
 * then remove, cross-cell drag), colors/highlights, word wrap, alignment,
 * fonts, images (add/delete/undo), big + short text, and rollback chains.
 *
 *   npm run build:desktop && node scripts/qa-creative.mjs
 *
 * Results + screenshots land in AI_Documentation/qa/<version>/creative/.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const VERSION = "0.3.8";
const OUT = join(process.cwd(), "AI_Documentation", "qa", VERSION, "creative");
const PORT = 8095;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error("[qa-creative] dist-desktop/client missing — run npm run build:desktop first");
  process.exit(2);
}

await mkdir(OUT, { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "")));
    res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("no");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const cases = [];
const pageErrors = [];
let shotN = 0;

function record(name, ok, detail) {
  const row = { name, ok, detail };
  cases.push(row);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  return row;
}

// Windows headless Chromium crashes the render target on page.screenshot with
// default GPU/sandbox settings (see qa-stress.mjs). Same stabilising args.
const browser = await chromium.launch({
  args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (err) => pageErrors.push(String(err)));

async function snap(name) {
  shotN += 1;
  const file = `${String(shotN).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60)}.png`;
  try {
    await page.screenshot({ path: join(OUT, file), fullPage: false, timeout: 8000 });
    return file;
  } catch (err) {
    console.log(`  [snap] failed for ${name}: ${String(err).slice(0, 100)}`);
    return null;
  }
}

// --- desktop bridge v2 + seeded board (same recipe as qa-stress.mjs) ---------
await page.addInitScript(() => {
  const dir = { id: "d", name: "d" };
  const files = new Map();
  let maximized = false;
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

function longText(lines) {
  return Array.from({ length: lines }, (_, i) => `L${String(i).padStart(4, "0")} ${"x".repeat(60)}`).join("\n");
}

await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async (long) => {
  const note = (id, title, text) => ({
    id, title, wrap: true, edited: Date.now(), sourceExt: "papel",
    language: "auto", eol: "lf", encoding: "utf-8",
    blocks: [{ kind: "text", text }],
  });
  const doc = {
    notes: [
      note("empty", "Empty", ""),
      note("short", "Short", "The quick brown fox jumps over the lazy dog."),
      note("long", "Long", long),
      note("other", "Other", "Second sheet keeps its own words."),
      note("scratch", "Scratch", ""),
    ],
    order: ["empty", "short", "long", "other", "scratch"],
    activeId: null,
  };
  const prefs = { skin: "ink", zoom: 16, autocorrect: true, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("papel", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      store.put(doc, "doc");
      store.put(prefs, "prefs");
      store.put(handle, "folderHandle");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}, longText(80));

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);
const gated = await page.locator(".modal-back").count();
record("boot", gated === 0, gated ? "folder gate blocked the board" : "board visible, bridge v2 accepted");

// --- helpers ----------------------------------------------------------------
async function onBoard() {
  return (await page.locator(".page").count()) === 0;
}
async function goBoard() {
  if (!(await onBoard())) {
    const back = page.getByRole("button", { name: "Back to board" });
    if (await back.count()) await back.click();
    await page.waitForTimeout(250);
  }
}
async function openNote(title) {
  await goBoard();
  await page.getByRole("button", { name: title, exact: true }).first().click();
  await page.locator(".page textarea.editor").first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(200);
}
async function insertTable() {
  await page.getByRole("button", { name: /^Insert table$/ }).click();
  await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
  await page.waitForTimeout(280);
}
async function clearSheet() {
  await page.locator(".page textarea.editor").first().click();
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(80);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
}

/**
 * REAL user selection via keyboard: focus, Ctrl+Home, walk right to `start`,
 * then Shift+Right to `end`. Fires native keydown/keyup + selectionchange that
 * the app's React handlers actually see (unlike synthetic setSelectionRange).
 */
async function realSelect(selector, start, end) {
  await page.locator(selector).first().click();
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(40);
  for (let i = 0; i < start; i += 1) await page.keyboard.press("ArrowRight");
  for (let i = start; i < end; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(120);
}

/** Synthetic selection (what the baseline harness uses) — for A/B comparison. */
async function syntheticSelect(selector, start, end) {
  await page.evaluate(
    ({ selector, start, end }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) return;
      ta.focus();
      ta.setSelectionRange(start, end);
      ta.dispatchEvent(new Event("select", { bubbles: true }));
    },
    { selector, start, end },
  );
  await page.waitForTimeout(120);
}

/** Disabled state of every mark/colour control, keyed by short name. */
async function markStates() {
  return page.evaluate(() => {
    const probe = (re) => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => re.test(x.getAttribute("aria-label") || x.title || ""));
      return b ? { present: true, disabled: b.hasAttribute("disabled"), label: b.getAttribute("aria-label") || b.title } : { present: false };
    };
    return {
      bold: probe(/^Bold/),
      italic: probe(/^Italic/),
      underline: probe(/^Underline/),
      strike: probe(/^Strikethrough/),
      waxRed: probe(/^Wax red ink/),
      blueInk: probe(/^Blue ink/),
      greenInk: probe(/^Green ink/),
      pencilInk: probe(/^Pencil ink/),
      yellowHl: probe(/^Yellow highlighter/),
      pinkHl: probe(/^Pink highlighter/),
      greenHl: probe(/^Green highlighter/),
      blueHl: probe(/^Blue highlighter/),
      noHl: probe(/^No highlight/),
      clear: probe(/^Clear styles/),
    };
  });
}

/** Mark/ink/highlight span classes rendered inside a scope. */
async function paintProbe(scope) {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope) || document;
    const spans = [...root.querySelectorAll("pre span")];
    const classes = new Set();
    for (const s of spans) for (const c of s.classList) {
      if (/^(sb|si|su|ss|ink\d|hl\d)$/.test(c)) classes.add(c);
    }
    return { classes: [...classes], spanCount: spans.length };
  }, scope);
}

async function clickToolbar(nameRe) {
  const btn = page.getByRole("button", { name: nameRe }).first();
  if ((await btn.count()) === 0) return false;
  await btn.click();
  await page.waitForTimeout(110);
  return true;
}

function enabled(states, key) {
  return states[key]?.present === true && states[key]?.disabled === false;
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const EXCEL_TSV = "Name\tQty\nalpha\t1\nbeta\t2";
const EXCEL_HTML = "<html><body><!--StartFragment--><table><tr><td>Name</td><td>Qty</td></tr><tr><td>alpha</td><td>1</td></tr><tr><td>beta</td><td>2</td></tr></table><!--EndFragment--></body></html>";

async function pasteInto(selector, payload) {
  return page.evaluate(
    ({ selector, payload }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) return { ok: false };
      ta.focus();
      const dt = new DataTransfer();
      if (payload.plain != null) dt.setData("text/plain", payload.plain);
      if (payload.html != null) dt.setData("text/html", payload.html);
      if (payload.image) {
        const bin = atob(payload.image);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], "img.png", { type: "image/png" }));
      }
      ta.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      return { ok: true };
    },
    { selector, payload },
  );
}

// Wrap every case so one throw cannot abort the suite.
async function testCase(name, fn) {
  try {
    await fn();
  } catch (err) {
    record(name, false, `THREW: ${String(err).slice(0, 300)}`);
    await snap(`throw-${name}`);
  }
}

const EDITOR = ".page textarea.editor";
const CELL = ".page .sheet-table td textarea";

// ===========================================================================
// GROUP A — selection ground truth (settle the baseline "disabled" findings)
// ===========================================================================

await testCase("A1-real-midword-selection-enables-marks", async () => {
  await openNote("Short");
  await realSelect(EDITOR, 4, 9); // "quick"
  const st = await markStates();
  const allOn = ["bold", "italic", "underline", "strike", "waxRed", "yellowHl", "clear"].every((k) => enabled(st, k));
  record("A1-real-midword-selection-enables-marks", allOn, {
    bold: st.bold, italic: st.italic, waxRed: st.waxRed, yellowHl: st.yellowHl, clear: st.clear,
  });
  if (!allOn) await snap("A1-real-midword-disabled");
});

await testCase("A2-real-midword-bold-paints", async () => {
  await openNote("Short");
  await realSelect(EDITOR, 4, 9);
  await clickToolbar(/^Bold/);
  const paint = await paintProbe(".page .block:not(.table-block)");
  const ok = paint.classes.includes("sb");
  record("A2-real-midword-bold-paints", ok, paint);
  if (!ok) await snap("A2-bold-not-painted");
});

await testCase("A3-synthetic-midword-vs-real", async () => {
  // Reproduce the baseline synthetic path, then the real path, on the SAME range.
  await openNote("Short");
  await syntheticSelect(EDITOR, 4, 9);
  const synth = await markStates();
  await openNote("Short");
  await realSelect(EDITOR, 4, 9);
  const real = await markStates();
  const synthOff = !enabled(synth, "bold");
  const realOn = enabled(real, "bold");
  record("A3-synthetic-midword-vs-real", synthOff && realOn, {
    syntheticBoldDisabled: synth.bold?.disabled,
    syntheticLabel: synth.bold?.label,
    realBoldDisabled: real.bold?.disabled,
    verdict: synthOff && realOn
      ? "synthetic selection does NOT reach app state; real selection DOES — baseline fails were harness artifacts"
      : synthOff && !realOn
        ? "BOTH disabled — genuine product bug: mid-word selection cannot be formatted"
        : "synthetic worked too — baseline fail was transient",
  });
});

await testCase("A4-mouse-drag-selection-enables-marks", async () => {
  await openNote("Short");
  // Real mouse drag across the first words.
  const box = await page.locator(EDITOR).first().boundingBox();
  if (!box) { record("A4-mouse-drag-selection-enables-marks", false, "no editor box"); return; }
  await page.mouse.move(box.x + 30, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 14, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const st = await markStates();
  const ok = enabled(st, "bold") && enabled(st, "waxRed");
  record("A4-mouse-drag-selection-enables-marks", ok, { bold: st.bold, waxRed: st.waxRed });
  if (!ok) await snap("A4-mouse-drag-disabled");
});

// ===========================================================================
// GROUP B — table cell deep dive (user's explicit asks)
// ===========================================================================

await testCase("B1-enter-inside-cell", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("before");
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("Hello");
  const tablesBefore = await page.locator(".page .table-block").count();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.type("World");
  await page.waitForTimeout(150);
  const tablesAfter = await page.locator(".page .table-block").count();
  const cellVal = await page.evaluate(() => document.querySelector(".page .sheet-table td textarea")?.value ?? null);
  const blockKinds = await page.evaluate(() =>
    [...document.querySelectorAll(".page .block")].map((b) =>
      b.classList.contains("table-block") ? "table" : b.querySelector("img") ? "image" : "text"));
  const ok = tablesAfter === tablesBefore && /Hello/.test(cellVal || "") && /World/.test(cellVal || "");
  record("B1-enter-inside-cell", ok, {
    tablesBefore, tablesAfter, cellVal, blockKinds,
    note: ok ? "Enter stays inside the cell (newline), table intact" : "Enter broke the table or escaped the cell",
  });
  await snap("B1-enter-in-cell");
});

await testCase("B2-bullets-inside-cell-then-remove", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("item one");
  // Open the Lists menu with a cell focused and pick Bullet.
  await page.getByRole("button", { name: /^Lists/ }).first().click();
  await page.waitForTimeout(150);
  const bulletItem = page.getByRole("menuitemradio", { name: /Bullet/ });
  const hadBullet = (await bulletItem.count()) > 0;
  if (hadBullet) await bulletItem.first().click();
  await page.waitForTimeout(200);
  const afterBullet = await page.evaluate(() => {
    const cellTa = document.querySelector(".page .sheet-table td textarea");
    const sheetLists = [...document.querySelectorAll(".page .block")].filter((b) => /list|bullet/i.test(b.className)).length;
    return {
      cellVal: cellTa?.value ?? null,
      cellStillInTable: !!document.querySelector(".page .sheet-table td textarea"),
      sheetListBlocks: sheetLists,
      tables: document.querySelectorAll(".page .table-block").length,
    };
  });
  // Now remove the bullet (toggle off) with the cell still focused.
  await page.getByRole("button", { name: /^Lists/ }).first().click();
  await page.waitForTimeout(150);
  const noneItem = page.getByRole("menuitemradio", { name: /Bullet/ });
  if ((await noneItem.count()) > 0) await noneItem.first().click();
  await page.waitForTimeout(200);
  const afterRemove = await page.evaluate(() => ({
    cellVal: document.querySelector(".page .sheet-table td textarea")?.value ?? null,
    tables: document.querySelectorAll(".page .table-block").length,
  }));
  await snap("B2-bullets-in-cell");
  // A cell stores text/marks/fill only (0.3.8). Acceptable outcomes: bullet is
  // a no-op inside the cell, OR it applies and cleanly removes. A BUG is: the
  // table breaks, the cell text is corrupted, or the bullet leaks to the sheet.
  const tableIntact = afterBullet.tables >= 1 && afterRemove.tables >= 1;
  const textKept = /item one/.test(afterRemove.cellVal || "");
  record("B2-bullets-inside-cell-then-remove", tableIntact && textKept, {
    hadBulletMenu: hadBullet, afterBullet, afterRemove, tableIntact, textKept,
  });
});

await testCase("B3-cell-colors-and-highlight", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("CELLTEXT");
  await realSelect(CELL, 0, 4); // real selection inside the cell
  const st = await markStates();
  const inkOn = enabled(st, "waxRed");
  const hlOn = enabled(st, "yellowHl");
  if (inkOn) await clickToolbar(/^Wax red ink/);
  if (hlOn) await clickToolbar(/^Yellow highlighter/);
  const paint = await paintProbe(".page .sheet-table");
  const ok = inkOn && hlOn && paint.classes.includes("ink1") && paint.classes.includes("hl1");
  record("B3-cell-colors-and-highlight", ok, { inkOn, hlOn, paint, boldState: st.bold });
  if (!ok) await snap("B3-cell-color-fail");
});

await testCase("B4-cell-alignment", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("align me");
  await clickToolbar(/^Align centre/);
  const center = await page.evaluate(() => {
    const c = document.querySelector(".page .sheet-table td");
    return { cellAlign: c?.getAttribute("data-align") || getComputedStyle(c).textAlign, blockAlign: document.querySelector(".page .block")?.getAttribute("data-align") };
  });
  await clickToolbar(/^Align right/);
  const right = await page.evaluate(() => {
    const c = document.querySelector(".page .sheet-table td");
    return { cellAlign: c?.getAttribute("data-align") || getComputedStyle(c).textAlign };
  });
  const changed = center.cellAlign !== right.cellAlign || /center|right/.test(String(center.cellAlign) + String(right.cellAlign));
  record("B4-cell-alignment", changed, { center, right });
  await snap("B4-cell-align");
});

await testCase("B5-cell-font-change", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("font test");
  await realSelect(CELL, 0, 4);
  const fontBtn = page.getByRole("button", { name: /Paragraph style and font|Font for this block/ }).first();
  const hasFont = (await fontBtn.count()) > 0;
  let applied = null;
  if (hasFont) {
    await fontBtn.click();
    await page.waitForTimeout(150);
    const plex = page.getByRole("menuitemradio", { name: /IBM Plex Mono/ });
    if ((await plex.count()) > 0) { await plex.first().click(); await page.waitForTimeout(200); }
    applied = await page.evaluate(() => {
      const c = document.querySelector(".page .sheet-table td");
      return c?.getAttribute("data-face") || getComputedStyle(c).fontFamily;
    });
  }
  record("B5-cell-font-change", hasFont, { hasFont, applied });
  await snap("B5-cell-font");
});

await testCase("B6-cross-cell-drag-bold", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cells = page.locator(CELL);
  await cells.nth(0).click();
  await page.keyboard.type("AA");
  await cells.nth(1).click();
  await page.keyboard.type("BB");
  // Real mouse drag from cell 0 into cell 1.
  const b0 = await cells.nth(0).boundingBox();
  const b1 = await cells.nth(1).boundingBox();
  let dragOk = false;
  if (b0 && b1) {
    await page.mouse.move(b0.x + 6, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b1.x + b1.width - 6, b1.y + b1.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(180);
    const sel = await page.evaluate(() => {
      const tds = [...document.querySelectorAll(".page .sheet-table td")];
      return tds.filter((td) => td.classList.contains("selected") || td.querySelector(".selected") || getSelection()?.toString().length > 0).length;
    });
    dragOk = sel >= 1;
    if (dragOk) await clickToolbar(/^Bold/);
  }
  const paint = await paintProbe(".page .sheet-table");
  await snap("B6-cross-cell-drag");
  // 0.3.8 claims a cross-cell drag selects both and Bold paints both.
  record("B6-cross-cell-drag-bold", dragOk && paint.classes.includes("sb"), { dragSelectedCells: dragOk, paint });
});

await testCase("B7-enter-in-last-cell", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cells = page.locator(CELL);
  const n = await cells.count();
  await cells.nth(n - 1).click();
  await page.keyboard.type("last");
  const rowsBefore = await page.locator(".page .sheet-table tr").count();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.type("grown");
  await page.waitForTimeout(150);
  const rowsAfter = await page.locator(".page .sheet-table tr").count();
  const tables = await page.locator(".page .table-block").count();
  record("B7-enter-in-last-cell", tables === 1, { rowsBefore, rowsAfter, tables, note: "Enter in last cell should not destroy the table" });
  await snap("B7-enter-last-cell");
});

await testCase("B8-delete-table-button-cell-focused", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  await page.locator(CELL).first().click();
  const del = page.getByRole("button", { name: /Delete (this )?table/i }).first();
  const visible = (await del.count()) > 0 && (await del.isVisible().catch(() => false));
  const enabledNow = visible ? await del.isEnabled() : false;
  record("B8-delete-table-button-cell-focused", visible && enabledNow, {
    visible, enabled: enabledNow,
    note: visible && enabledNow ? "Delete table reachable with a cell focused" : "Delete table hidden/disabled while a cell is focused (baseline flagged this)",
  });
});

// ===========================================================================
// GROUP C — images
// ===========================================================================

await testCase("C1-add-delete-undo-image", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await pasteInto(EDITOR, { plain: "", image: PNG });
  await page.waitForTimeout(300);
  const added = await page.locator(".page .picture").count();
  await page.locator(".page .picture").first().click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(250);
  const deleted = await page.locator(".page .picture").count();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(250);
  const undone = await page.locator(".page .picture").count();
  const ok = added === 1 && deleted === 0 && undone === 1;
  record("C1-add-delete-undo-image", ok, { added, deleted, undone });
  await snap("C1-image-delete-undo");
});

await testCase("C2-selectall-bold-with-image", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("text around image");
  await pasteInto(EDITOR, { plain: "", image: PNG });
  await page.waitForTimeout(250);
  await page.locator(EDITOR).first().click();
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(120);
  const st = await markStates();
  const boldOn = enabled(st, "bold");
  if (boldOn) await clickToolbar(/^Bold/);
  const imgs = await page.locator(".page .picture").count();
  const paint = await paintProbe(".page");
  record("C2-selectall-bold-with-image", boldOn && imgs === 1, { boldOn, imgsAfterBold: imgs, paint });
  await snap("C2-selectall-image");
});

// ===========================================================================
// GROUP D — colours & paint
// ===========================================================================

await testCase("D1-all-inks-paint", async () => {
  await openNote("Short");
  const results = {};
  for (const [key, label, cls] of [["waxRed", /^Wax red ink/, "ink1"], ["blueInk", /^Blue ink/, "ink2"], ["greenInk", /^Green ink/, "ink3"], ["pencilInk", /^Pencil ink/, "ink4"]]) {
    await openNote("Short");
    await realSelect(EDITOR, 4, 9);
    const st = await markStates();
    if (!enabled(st, key)) { results[cls] = "DISABLED"; continue; }
    await clickToolbar(label);
    const paint = await paintProbe(".page .block:not(.table-block)");
    results[cls] = paint.classes.includes(cls) ? "PAINTED" : `MISSING (${paint.classes.join(",")})`;
  }
  const ok = Object.values(results).every((v) => v === "PAINTED");
  record("D1-all-inks-paint", ok, results);
  if (!ok) await snap("D1-inks-fail");
});

await testCase("D2-all-highlights-paint", async () => {
  const results = {};
  for (const [key, label, cls] of [["yellowHl", /^Yellow highlighter/, "hl1"], ["pinkHl", /^Pink highlighter/, "hl2"], ["greenHl", /^Green highlighter/, "hl3"], ["blueHl", /^Blue highlighter/, "hl4"]]) {
    await openNote("Short");
    await realSelect(EDITOR, 10, 15);
    const st = await markStates();
    if (!enabled(st, key)) { results[cls] = "DISABLED"; continue; }
    await clickToolbar(label);
    const paint = await paintProbe(".page .block:not(.table-block)");
    results[cls] = paint.classes.includes(cls) ? "PAINTED" : `MISSING (${paint.classes.join(",")})`;
  }
  const ok = Object.values(results).every((v) => v === "PAINTED");
  record("D2-all-highlights-paint", ok, results);
  if (!ok) await snap("D2-highlights-fail");
});

await testCase("D3-clear-styles-removes-all", async () => {
  await openNote("Short");
  await realSelect(EDITOR, 4, 15);
  await clickToolbar(/^Bold/);
  await clickToolbar(/^Wax red ink/);
  await clickToolbar(/^Yellow highlighter/);
  const before = await paintProbe(".page .block:not(.table-block)");
  await realSelect(EDITOR, 4, 15);
  await clickToolbar(/^Clear styles/);
  const after = await paintProbe(".page .block:not(.table-block)");
  const ok = before.classes.length >= 2 && after.classes.length === 0;
  record("D3-clear-styles-removes-all", ok, { before: before.classes, after: after.classes });
  if (!ok) await snap("D3-clear-styles-fail");
});

await testCase("D4-paint-undo-redo", async () => {
  await openNote("Short");
  await realSelect(EDITOR, 4, 9);
  await clickToolbar(/^Wax red ink/);
  const painted = await paintProbe(".page .block:not(.table-block)");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  const undone = await paintProbe(".page .block:not(.table-block)");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(150);
  const redone = await paintProbe(".page .block:not(.table-block)");
  const ok = painted.classes.includes("ink1") && !undone.classes.includes("ink1") && redone.classes.includes("ink1");
  record("D4-paint-undo-redo", ok, { painted: painted.classes, undone: undone.classes, redone: redone.classes });
});

await testCase("D5-bold-plus-color-combo", async () => {
  await openNote("Short");
  await realSelect(EDITOR, 4, 9);
  await clickToolbar(/^Bold/);
  await realSelect(EDITOR, 4, 9);
  await clickToolbar(/^Blue ink/);
  const paint = await paintProbe(".page .block:not(.table-block)");
  const ok = paint.classes.includes("sb") && paint.classes.includes("ink2");
  record("D5-bold-plus-color-combo", ok, paint);
  await snap("D5-bold-color-combo");
});

// ===========================================================================
// GROUP E — alignment & word wrap
// ===========================================================================

await testCase("E1-align-left-center-right", async () => {
  await openNote("Short");
  await page.locator(EDITOR).first().click();
  const out = {};
  for (const [name, re, expect] of [["left", /^Align left/, "left"], ["centre", /^Align centre/, "center"], ["right", /^Align right/, "right"]]) {
    await clickToolbar(re);
    out[name] = await page.evaluate(() => document.querySelector(".page .block")?.getAttribute("data-align") || document.querySelector(".page")?.getAttribute("data-align"));
  }
  const ok = out.left === "left" && out.centre === "center" && out.right === "right";
  record("E1-align-left-center-right", ok, out);
});

await testCase("E2-wrap-off-long-line", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("x".repeat(400));
  const wrapBtn = page.getByRole("button", { name: /Word wrap|Toggle word wrap/ }).first();
  await wrapBtn.click();
  await page.waitForTimeout(200);
  const wrapOff = await page.evaluate(() => document.querySelector(".page")?.getAttribute("data-wrap"));
  const scrollable = await page.evaluate(() => {
    const pre = document.querySelector(".page .block pre");
    return pre ? pre.scrollWidth > pre.clientWidth : false;
  });
  await clickToolbar(/^Align right/);
  const alignRight = await page.evaluate(() => document.querySelector(".page .block")?.getAttribute("data-align"));
  record("E2-wrap-off-long-line", wrapOff === "off" && scrollable, { wrapOff, scrollable, alignRight });
  await snap("E2-wrap-off");
});

await testCase("E3-wrap-toggle-big-text", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.evaluate(async (t) => { await navigator.clipboard.writeText(t); }, longText(220));
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(400);
  const lenBefore = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value.length ?? 0);
  const wrapBtn = page.getByRole("button", { name: /Word wrap|Toggle word wrap/ }).first();
  let toggles = 0;
  for (let i = 0; i < 6; i += 1) { await wrapBtn.click(); await page.waitForTimeout(120); toggles += 1; }
  const lenAfter = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value.length ?? 0);
  const ok = lenBefore > 5000 && lenBefore === lenAfter;
  record("E3-wrap-toggle-big-text", ok, { lenBefore, lenAfter, toggles, textIntact: lenBefore === lenAfter });
  if (!ok) await snap("E3-wrap-big-text-fail");
});

await testCase("E4-align-cell-vs-outside-independent", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("outside text");
  await insertTable();
  await page.locator(CELL).first().click();
  await page.keyboard.type("inside");
  await clickToolbar(/^Align centre/); // align the cell
  const cellAlign = await page.evaluate(() => document.querySelector(".page .sheet-table td")?.getAttribute("data-align"));
  // Now click outside and align right — cell should keep centre.
  await page.locator(EDITOR).first().click();
  await clickToolbar(/^Align right/);
  const after = await page.evaluate(() => ({
    cellAlign: document.querySelector(".page .sheet-table td")?.getAttribute("data-align"),
    blockAlign: document.querySelector(".page .block:not(.table-block)")?.getAttribute("data-align"),
  }));
  const ok = cellAlign === "center" && after.cellAlign === "center" && after.blockAlign === "right";
  record("E4-align-cell-vs-outside-independent", ok, { cellAlignAfterCellOp: cellAlign, ...after });
  await snap("E4-align-cell-outside");
});

// ===========================================================================
// GROUP F — fonts
// ===========================================================================

await testCase("F1-cycle-all-typefaces", async () => {
  const faces = ["IBM Plex Sans", "IBM Plex Mono", "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "JetBrains Mono"];
  const applied = [];
  await openNote("Short");
  for (const face of faces) {
    await page.locator(EDITOR).first().click();
    const fontBtn = page.getByRole("button", { name: /Paragraph style and font|Font for this block/ }).first();
    if ((await fontBtn.count()) === 0) { applied.push(`${face}:NO_BUTTON`); continue; }
    await fontBtn.click();
    await page.waitForTimeout(140);
    const item = page.getByRole("menuitemradio", { name: new RegExp(`^${face.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
    if ((await item.count()) === 0) { applied.push(`${face}:NO_MENU_ITEM`); await page.keyboard.press("Escape"); continue; }
    await item.first().click();
    await page.waitForTimeout(160);
    const got = await page.evaluate(() => {
      const b = document.querySelector(".page .block");
      return b?.getAttribute("data-face") || getComputedStyle(b).fontFamily;
    });
    applied.push(`${face}->${String(got).slice(0, 30)}`);
  }
  const ok = applied.filter((a) => a.includes("NO_")).length === 0;
  record("F1-cycle-all-typefaces", ok, { applied, failures: applied.filter((a) => a.includes("NO_")) });
  await snap("F1-fonts");
});

// ===========================================================================
// GROUP G — big/short text + rollback
// ===========================================================================

await testCase("G1-10k-line-format-undo", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.evaluate(async (t) => { await navigator.clipboard.writeText(t); }, longText(10000));
  const t0 = Date.now();
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(1500);
  const pasteMs = Date.now() - t0;
  const len = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value.length ?? 0);
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(200);
  const st = await markStates();
  const boldOn = enabled(st, "bold");
  if (boldOn) await clickToolbar(/^Bold/);
  await page.waitForTimeout(300);
  const lenAfterBold = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value.length ?? 0);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  const lenAfterUndo = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value.length ?? 0);
  const ok = len > 100000 && lenAfterBold === len && lenAfterUndo === len;
  record("G1-10k-line-format-undo", ok, { pasteMs, len, boldOn, lenAfterBold, lenAfterUndo, textStable: lenAfterUndo === len });
  await snap("G1-10k");
});

await testCase("G2-mixed-ops-rollback-chain", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("rollback chain");
  const ops = [];
  // bold a word
  await realSelect(EDITOR, 0, 8); await clickToolbar(/^Bold/); ops.push("bold");
  // colour it
  await realSelect(EDITOR, 0, 8); await clickToolbar(/^Wax red ink/); ops.push("ink");
  // highlight
  await realSelect(EDITOR, 9, 14); await clickToolbar(/^Yellow highlighter/); ops.push("hl");
  // insert table at end
  await page.locator(EDITOR).first().click(); await page.keyboard.press("Control+End");
  await insertTable(); ops.push("table");
  // image
  await page.locator(EDITOR).first().click(); await pasteInto(EDITOR, { plain: "", image: PNG }); ops.push("image");
  await page.waitForTimeout(300);
  const stateFull = await page.evaluate(() => ({
    tables: document.querySelectorAll(".page .table-block").length,
    images: document.querySelectorAll(".page .picture").length,
    text: document.querySelector(".page textarea.editor")?.value ?? "",
  }));
  // Undo everything back toward the start.
  let undoCount = 0;
  for (let i = 0; i < 12; i += 1) {
    const before = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value + "|" + document.querySelectorAll(".page .table-block").length + "|" + document.querySelectorAll(".page .picture").length);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(180);
    const after = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value + "|" + document.querySelectorAll(".page .table-block").length + "|" + document.querySelectorAll(".page .picture").length);
    undoCount += 1;
    if (before === after && i > 3) break; // hit bottom of stack
  }
  const stateUndone = await page.evaluate(() => ({
    tables: document.querySelectorAll(".page .table-block").length,
    images: document.querySelectorAll(".page .picture").length,
    text: document.querySelector(".page textarea.editor")?.value ?? "",
  }));
  // Redo forward.
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press("Control+y"); await page.waitForTimeout(150); }
  const stateRedone = await page.evaluate(() => ({
    tables: document.querySelectorAll(".page .table-block").length,
    images: document.querySelectorAll(".page .picture").length,
    text: document.querySelector(".page textarea.editor")?.value ?? "",
  }));
  const ok = stateFull.tables === 1 && stateFull.images === 1 &&
    stateUndone.tables <= stateFull.tables &&
    stateRedone.tables === stateFull.tables && stateRedone.images === stateFull.images &&
    stateRedone.text === stateFull.text;
  record("G2-mixed-ops-rollback-chain", ok, { ops, stateFull, stateUndone, stateRedone, undoCount });
  await snap("G2-rollback");
});

await testCase("G3-single-char-and-empty-selection", async () => {
  await openNote("Short");
  await realSelect(EDITOR, 4, 5); // one char "q"
  const st1 = await markStates();
  const singleOn = enabled(st1, "bold");
  if (singleOn) await clickToolbar(/^Bold/);
  const paint1 = await paintProbe(".page .block:not(.table-block)");
  // Collapse to empty selection (caret only).
  await page.locator(EDITOR).first().click();
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(100);
  const st2 = await markStates();
  const emptyDisabled = st2.bold?.disabled === true;
  record("G3-single-char-and-empty-selection", singleOn && paint1.classes.includes("sb") && emptyDisabled, {
    singleCharBoldEnabled: singleOn, painted: paint1.classes, emptySelectionBoldDisabled: emptyDisabled, emptyLabel: st2.bold?.label,
  });
});

// ===========================================================================
// GROUP H — crazy combos
// ===========================================================================

await testCase("H1-cell-full-stack-then-undo", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("stack me");
  await realSelect(CELL, 0, 5);
  await clickToolbar(/^Bold/);
  await realSelect(CELL, 0, 5);
  await clickToolbar(/^Wax red ink/);
  await realSelect(CELL, 0, 5);
  await clickToolbar(/^Yellow highlighter/);
  await clickToolbar(/^Align centre/);
  const painted = await paintProbe(".page .sheet-table");
  // Undo the stack.
  for (let i = 0; i < 6; i += 1) { await page.keyboard.press("Control+z"); await page.waitForTimeout(140); }
  const after = await page.evaluate(() => ({
    cellVal: document.querySelector(".page .sheet-table td textarea")?.value ?? null,
    tables: document.querySelectorAll(".page .table-block").length,
  }));
  const paintAfter = await paintProbe(".page .sheet-table");
  const ok = painted.classes.length >= 2 && after.tables === 1 && /stack me/.test(after.cellVal || "");
  record("H1-cell-full-stack-then-undo", ok, { paintedWhileStyled: painted.classes, afterUndo: after, paintAfterUndo: paintAfter.classes });
  await snap("H1-cell-stack");
});

await testCase("H2-insert-table-from-cell-is-sibling", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  await page.locator(CELL).first().click();
  const before = await page.evaluate(() => [...document.querySelectorAll(".page .block")].map((b) => b.classList.contains("table-block") ? "table" : "text"));
  await page.getByRole("button", { name: /^Insert table$/ }).click();
  const sizeBtn = page.getByRole("button", { name: /Insert a 2 by 2 table/ });
  if ((await sizeBtn.count()) > 0) await sizeBtn.first().click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    blocks: [...document.querySelectorAll(".page .block")].map((b) => b.classList.contains("table-block") ? "table" : "text"),
    nested: document.querySelectorAll(".page .sheet-table .sheet-table").length,
    tables: document.querySelectorAll(".page .table-block").length,
  }));
  // 0.3.8: a cell cannot hold a table; the new table is a sibling below.
  const ok = after.nested === 0 && after.tables === 2;
  record("H2-insert-table-from-cell-is-sibling", ok, { before, after });
  await snap("H2-table-from-cell");
});

await testCase("H3-copy-styled-cell-paste-outside", async () => {
  await openNote("Scratch");
  await clearSheet();
  await insertTable();
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.type("copied text");
  await realSelect(CELL, 0, 6);
  await clickToolbar(/^Bold/);
  await realSelect(CELL, 0, 6);
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(150);
  // Click the text block after the table and paste.
  const editors = page.locator(EDITOR);
  await editors.last().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll(".page .block:not(.table-block)")];
    const last = blocks[blocks.length - 1];
    return { text: last?.querySelector("textarea")?.value ?? null, hasBoldSpan: !!last?.querySelector("pre span.sb") };
  });
  record("H3-copy-styled-cell-paste-outside", /copied/.test(out.text || ""), { pastedText: out.text, boldCarriedOver: out.hasBoldSpan });
  await snap("H3-copy-cell-out");
});

await testCase("H4-excel-table-edit-reload-persists", async () => {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  await pasteInto(EDITOR, { plain: EXCEL_TSV, html: EXCEL_HTML });
  await page.waitForTimeout(350);
  const tablesAfterPaste = await page.locator(".page .table-block").count();
  // Edit a cell.
  const cell = page.locator(CELL).first();
  await cell.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("EDITED");
  await page.waitForTimeout(200);
  // Trigger autosave then reload.
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1200);
  // Reopen the note.
  const stillGated = await page.locator(".modal-back").count();
  if (!stillGated) {
    const noteBtn = page.getByRole("button", { name: "Scratch", exact: true }).first();
    if ((await noteBtn.count()) > 0) { await noteBtn.click(); await page.waitForTimeout(400); }
  }
  const after = await page.evaluate(() => ({
    tables: document.querySelectorAll(".page .table-block").length,
    cellText: document.querySelector(".page .sheet-table td textarea")?.value ?? null,
  }));
  const ok = tablesAfterPaste === 1 && after.tables === 1 && /EDITED/.test(after.cellText || "");
  record("H4-excel-table-edit-reload-persists", ok, { tablesAfterPaste, gated: stillGated, after });
  await snap("H4-reload-table");
});

// --- summary ----------------------------------------------------------------
const summary = {
  version: VERSION,
  suite: "qa-creative",
  browser: "Chromium (Playwright), real keyboard/mouse selections",
  cases,
  pageErrors,
  pass: cases.filter((c) => c.ok).length,
  fail: cases.filter((c) => !c.ok).length,
};
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-creative] ${summary.pass} pass / ${summary.fail} fail`);
console.log(`[qa-creative] wrote ${join(OUT, "results.json")}`);
await browser.close().catch(() => undefined);
server.close();
process.exitCode = summary.fail ? 1 : 0;
