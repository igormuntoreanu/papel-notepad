/**
 * FB-34 — a pasted spreadsheet grid is ONE undo step.
 *   UP1 paste a 3x3 grid -> a single Ctrl+Z removes the whole table
 *   UP2 redo (Ctrl+Y) brings the grid back, cells included
 *   UP3 the step before the paste is still next (the group is exactly one step, it does
 *       not swallow the edits around it)
 *   UP4 Ctrl+A + Delete (Clear sheet) is one undo as well
 *
 *   npm run build:desktop && node scripts/qa-undo-paste.mjs
 *   BASE=http://localhost:8080 node scripts/qa-undo-paste.mjs   # against `npm run dev`
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "0.5.4");
const PORT = 8099;
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
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
const TSV = "Name\tQty\tPrice\nApple\t3\t1.50\nPear\t2\t0.75";

let server = null;
if (!process.env.BASE) {
  if (!existsSync(join(ROOT, "index.html"))) {
    console.error("[qa-undo-paste] run npm run build:desktop first (or set BASE)");
    process.exit(2);
  }
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      const body = await readFile(
        join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "")),
      );
      res.writeHead(200, {
        "content-type": MIME[extname(requested)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("no");
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
}
await mkdir(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${JSON.stringify(detail)}`);
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// The desktop contract is v2 (src/lib/desktop/bridge.ts); files stay in memory.
await page.addInitScript(() => {
  // The contenteditable renderer is the default; pin it so a stale profile cannot
  // swap the editor under the guard.
  if (localStorage.getItem("papel-ce") !== "1") localStorage.setItem("papel-ce", "1");
  const dir = { id: "d", name: "d" };
  const files = new Map();
  window.__PAPEL_DESKTOP__ = {
    version: 2,
    async appVersion() {
      return "0.5.4";
    },
    async minimize() {},
    async toggleMaximize() {},
    async isMaximized() {
      return false;
    },
    async close() {},
    async pickDirectory() {
      return dir;
    },
    async resolveDirectory() {
      return dir;
    },
    async readFile(_id, name) {
      return files.get(name) ?? null;
    },
    async writeFile(_id, name, bytes) {
      files.set(name, bytes);
    },
    async removeFile(_id, name) {
      files.delete(name);
    },
    async listFiles() {
      return [...files.keys()];
    },
    async saveFile() {
      return true;
    },
  };
});

const tables = () => page.locator(".table-block").count();
const cells = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".table-block textarea.cell-input")].map((t) => t.value),
  );
const bodyText = async () => (await page.locator(".ce-root").first().innerText()).trim();
const shot = (name) => page.screenshot({ path: join(OUT, name), timeout: 8000 }).catch(() => null);
/** The caret the app itself reports: "Ln 1, Col 7" in the status strip. */
async function caret() {
  const text = await page.locator("header, .strip-paper").first().innerText();
  const m = text.match(/Ln (\d+), Col (\d+)/);
  return m ? { line: Number(m[1]), col: Number(m[2]) } : null;
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
const choose = page.getByRole("button", { name: /Choose folder/ });
await choose.first().waitFor({ timeout: 30000 });
await choose.first().click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "New sheet" }).first().click();
const editor = page.locator(".ce-root").first();
await editor.waitFor({ timeout: 20000 });
await page.waitForTimeout(800);

async function clearSheet() {
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(150);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
}
async function undo(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(220);
  }
}
async function redo(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(220);
  }
}
async function pasteGrid(tsv) {
  await page.evaluate((text) => {
    const root = document.querySelector(".ce-root");
    root.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    root.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, tsv);
  await page.waitForTimeout(700);
}

// UP1 — a 3x3 paste leaves in one press --------------------------------------
await clearSheet();
await editor.click();
await page.keyboard.type("before");
await page.waitForTimeout(250);
await pasteGrid(TSV);
const pastedCells = await cells();
const pastedTables = await tables();
await shot("01-pasted-grid.png");
check("UP1-paste-lands", pastedTables === 1 && pastedCells.length === 9, {
  tables: pastedTables,
  cells: pastedCells,
});

await undo();
const tablesAfterOneUndo = await tables();
await shot("02-one-undo-cleared-the-grid.png");
check("UP1-paste-clears-in-one-undo", tablesAfterOneUndo === 0, { tablesAfterOneUndo });

// UP2 — redo restores the grid with its cells ---------------------------------
await redo();
const redoneCells = await cells();
check(
  "UP2-redo-restores-grid",
  (await tables()) === 1 && redoneCells.join(",") === pastedCells.join(","),
  {
    tables: await tables(),
    cells: redoneCells,
  },
);

// UP3 — the group is exactly one step, not zero and not two -------------------
await undo();
const afterFirstUndo = await tables();
const textAfterFirstUndo = await bodyText();
await undo();
check(
  "UP3-step-before-the-paste-is-next",
  afterFirstUndo === 0 && textAfterFirstUndo === "before" && (await bodyText()) === "",
  { afterFirstUndo, textAfterFirstUndo, afterSecondUndo: await bodyText() },
);

// UP5 — undo returns the caret to where it stood before the paste -------------
await clearSheet();
await editor.click();
await page.keyboard.type("helloWORLD");
await page.waitForTimeout(250);
const caretAtEnd = await caret(); // caret sits after the last character
await pasteGrid(TSV);
await undo();
const caretAfterUndoAtEnd = await caret();
const textAfterUndoAtEnd = await bodyText();
check(
  "UP5-undo-restores-caret-after-text",
  textAfterUndoAtEnd === "helloWORLD" && caretAfterUndoAtEnd?.col === caretAtEnd?.col,
  { caretBefore: caretAtEnd, caretAfter: caretAfterUndoAtEnd, text: textAfterUndoAtEnd },
);

// UP6 — same, with the caret in the middle of the text ----------------------
await clearSheet();
await editor.click();
await page.keyboard.type("helloWORLD");
for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(250);
const caretMid = await caret();
await pasteGrid(TSV);
await undo();
const caretAfterUndoMid = await caret();
const textAfterUndoMid = await bodyText();
check(
  "UP6-undo-restores-caret-mid-text",
  textAfterUndoMid === "helloWORLD" && caretAfterUndoMid?.col === caretMid?.col,
  { caretBefore: caretMid, caretAfter: caretAfterUndoMid, text: textAfterUndoMid },
);

// UP7 — the caret comes back on its own line, not on line 1 -------------------
await clearSheet();
await editor.click();
await page.keyboard.type("first line");
await page.keyboard.press("Enter");
await page.keyboard.type("second");
await page.waitForTimeout(250);
const caretLine2 = await caret();
await pasteGrid(TSV);
await undo();
const caretAfterUndoLine2 = await caret();
const textAfterUndoLine2 = await bodyText();
check(
  "UP7-undo-restores-caret-on-a-later-line",
  textAfterUndoLine2 === "first line\nsecond" &&
    caretAfterUndoLine2?.line === caretLine2?.line &&
    caretAfterUndoLine2?.col === caretLine2?.col,
  { caretBefore: caretLine2, caretAfter: caretAfterUndoLine2, text: textAfterUndoLine2 },
);

// UP4 — Clear sheet (Ctrl+A, Delete) is one undo ------------------------------
await clearSheet();
await editor.click();
await page.keyboard.type("keep me");
await page.waitForTimeout(200);
await pasteGrid(TSV);
const beforeClear = { tables: await tables(), text: await bodyText() };
await clearSheet();
const afterClear = { tables: await tables(), text: await bodyText() };
await undo();
const afterRestore = { tables: await tables(), text: await bodyText() };
check(
  "UP4-clear-sheet-is-one-undo",
  beforeClear.tables === 1 &&
    afterClear.tables === 0 &&
    afterClear.text === "" &&
    afterRestore.tables === 1 &&
    afterRestore.text === beforeClear.text,
  { beforeClear, afterClear, afterRestore },
);

const failed = results.filter((r) => !r.ok);
console.log(
  JSON.stringify(
    {
      passed: results.length - failed.length,
      failed: failed.length,
      pageErrors: pageErrors.slice(0, 5),
    },
    null,
    1,
  ),
);

await browser.close();
if (server) server.close();
process.exit(failed.length === 0 && pageErrors.length === 0 ? 0 : 1);
