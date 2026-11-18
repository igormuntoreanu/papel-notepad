/**
 * Note search in the sheet toolbar.
 *   SR1 the field sits in the status strip, after the zoom %, behind a "|" separator;
 *       the Go / Filters / Sort controls are gone from the header
 *   SR2 Enter paints every match of the current sheet in yellow
 *   SR3 clicking the loupe does the same
 *   SR4 a query that only lives in another sheet opens that sheet and paints it there
 *   SR5 clearing the field takes the yellow away
 *   SR6 the yellow is temporary: no style marks written, no undo step added
 *
 *   npm run build:desktop && node scripts/qa-search.mjs
 *   BASE=http://localhost:8080 node scripts/qa-search.mjs   # against `npm run dev`
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "0.5.4");
const PORT = 8101;
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

let server = null;
if (!process.env.BASE) {
  if (!existsSync(join(ROOT, "index.html"))) {
    console.error("[qa-search] run npm run build:desktop first (or set BASE)");
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.addInitScript(() => {
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

const shot = (name) => page.screenshot({ path: join(OUT, name), timeout: 8000 }).catch(() => null);
const input = page.locator('.strip-search input[aria-label="Search notes"]');
const hits = () =>
  page.evaluate(() => [...document.querySelectorAll(".find-hit")].map((e) => e.textContent));
const message = () =>
  page
    .locator(".status-msg")
    .first()
    .innerText()
    .catch(() => "");
const bodyText = async () => (await page.locator(".ce-root").first().innerText()).trim();

await page.goto(BASE, { waitUntil: "domcontentloaded" });
const choose = page.getByRole("button", { name: /Choose folder/ });
await choose.first().waitFor({ timeout: 30000 });
await choose.first().click();
await page.waitForTimeout(1200);

async function openNewSheetAndType(text) {
  const newSheet = page.getByRole("button", { name: "New sheet" }).first();
  await newSheet.click();
  const editor = page.locator(".ce-root").first();
  await editor.waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await editor.click();
  await page.keyboard.type(text);
  await page.waitForTimeout(400);
}

// Two sheets: the search field has to reach past the open one.
await openNewSheetAndType("alpha beta alpha");
await openNewSheetAndType("gamma delta");

async function search(query, { submit = "enter" } = {}) {
  await input.fill(query);
  if (submit === "enter") await input.press("Enter");
  else await page.getByRole("button", { name: "Search notes", exact: true }).click();
  await page.waitForTimeout(500);
}

// SR1 — placement: after the zoom %, behind a "|", and the old controls are gone -----
const placement = await page.evaluate(() => {
  const strip = document.querySelector(".strip-status");
  if (!strip) return { found: false };
  const items = [...strip.children].map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className,
    text: (el.textContent ?? "").trim().slice(0, 24),
  }));
  const zoom = items.findIndex((i) => /^\d+%$/.test(i.text));
  const sep = items.findIndex((i) => i.cls.includes("strip-sep"));
  const field = items.findIndex((i) => i.cls.includes("strip-search"));
  const header = document.querySelector(".strip-paper");
  const labels = [...(header?.querySelectorAll("button") ?? [])].map((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").trim(),
  );
  return {
    found: true,
    zoom,
    sep,
    field,
    ordered: zoom >= 0 && sep === zoom + 1 && field === sep + 1,
    separator: items[sep]?.text ?? null,
    hasGo: labels.some((l) => /^Go$/i.test(l)),
    hasFilters: labels.some((l) => /filter|sort/i.test(l)),
    labels,
  };
});
check(
  "SR1-field-sits-after-the-zoom-with-a-divider",
  placement.found &&
    placement.ordered &&
    placement.separator === "|" &&
    !placement.hasGo &&
    !placement.hasFilters,
  placement,
);

// SR8 — the field fills the gap between its two "|" and grows with the window ------
const geometry = async () =>
  page.evaluate(() => {
    const strip = document.querySelector(".strip-status");
    const field = document.querySelector(".strip-search");
    const items = [...strip.children];
    const at = items.indexOf(field);
    const stripBox = strip.getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    return {
      separators: items.filter((el) => el.classList.contains("strip-sep")).length,
      opensWithSep: items[at - 1]?.classList.contains("strip-sep") ?? false,
      closesWithSep: items[at + 1]?.classList.contains("strip-sep") ?? false,
      fieldWidth: Math.round(fieldBox.width),
      gapRight: Math.round(stripBox.right - fieldBox.right),
    };
  });
const narrow = await geometry();
await page.setViewportSize({ width: 1800, height: 900 });
await page.waitForTimeout(400);
const wide = await geometry();
await page.setViewportSize({ width: 1400, height: 900 });
await page.waitForTimeout(300);
check(
  "SR8-field-stretches-between-the-two-bars",
  narrow.separators === 2 &&
    narrow.opensWithSep &&
    narrow.closesWithSep &&
    narrow.fieldWidth > 200 &&
    narrow.gapRight < 40 &&
    wide.fieldWidth > narrow.fieldWidth + 150,
  { narrow, wide },
);

// SR2 — Enter paints every match of the open sheet -------------------------------
await search("gamma");
const sr2 = { hits: await hits(), message: await message(), text: await bodyText() };
check("SR2-enter-highlights-every-match", sr2.hits.length === 1 && sr2.hits[0] === "gamma", sr2);
await shot("04-strip-search.png");

// SR3 — the loupe button runs the same search ------------------------------------
await search("delta", { submit: "loupe" });
const sr3 = { hits: await hits(), text: await bodyText() };
check("SR3-loupe-button-runs-the-search", sr3.hits.length === 1 && sr3.hits[0] === "delta", sr3);

// SR4 — a match that only lives in another sheet opens that sheet ----------------
await search("alpha");
const sr4 = { hits: await hits(), text: await bodyText(), message: await message() };
check(
  "SR4-opens-the-sheet-that-has-the-match",
  sr4.text === "alpha beta alpha" && sr4.hits.length === 2 && sr4.hits.every((h) => h === "alpha"),
  sr4,
);

// SR5 — clearing the field takes the yellow away ---------------------------------
// (while SR4's highlights are still on screen, so the two orders cannot mask each other)
const styledRuns = await page.evaluate(
  () =>
    document.querySelectorAll(
      ".ce-root .ce-line span.sb, .ce-root .ce-line span.si, .ce-root .ce-line span.su, .ce-root .ce-line span.ink1, .ce-root .ce-line span.ink2",
    ).length,
);
const beforeClear = await hits();
await input.fill("");
await page.waitForTimeout(400);
const afterClear = await hits();
check(
  "SR5-clearing-the-field-clears-the-highlight",
  beforeClear.length === 2 && afterClear.length === 0,
  {
    beforeClear,
    afterClear,
  },
);

// SR6 — the yellow was temporary: no style marks in the document, no undo step ----
await page.locator(".ce-root").first().click();
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
const afterUndo = await bodyText();
check(
  "SR6-search-writes-nothing-and-adds-no-undo-step",
  styledRuns === 0 && afterUndo !== "alpha beta alpha",
  { styledRuns, afterUndo },
);

// SR7 — searching from the board opens the sheet that has the match ---------------
// SR6's undo emptied this sheet, so give it words to find again.
await page.locator(".ce-root").first().click();
await page.keyboard.type("beta gamma beta");
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Board", exact: true }).first().click();
await page.waitForTimeout(600);
const onBoard = await page.evaluate(() =>
  document.querySelector(".desk")?.getAttribute("data-view"),
);
await search("beta");
const fromBoard = {
  onBoard,
  view: await page.evaluate(() => document.querySelector(".desk")?.getAttribute("data-view")),
  hits: await hits(),
};
check(
  "SR7-search-from-the-board-opens-the-sheet",
  fromBoard.onBoard === "board" &&
    fromBoard.view === "focus" &&
    fromBoard.hits.length === 2 &&
    fromBoard.hits.every((h) => h === "beta"),
  fromBoard,
);

// SR9 — the caret stays in the search field when a search finds something ---------
const focusState = () =>
  page.evaluate(() => {
    const field = document.querySelector(".strip-search input");
    return {
      focused: document.activeElement === field,
      caret: field.selectionStart,
      value: field.value,
      hits: document.querySelectorAll(".find-hit").length,
    };
  });
await input.click();
await input.fill("beta");
await input.press("Enter");
await page.waitForTimeout(500);
const afterEnter = await focusState();
check(
  "SR9-enter-keeps-the-caret-in-the-search-field",
  afterEnter.focused && afterEnter.caret === 4 && afterEnter.hits > 0,
  afterEnter,
);

// SR10 — and while backspacing, which clears the highlights and repaints the sheet --
await page.keyboard.press("Backspace");
await page.waitForTimeout(400);
const afterBackspace = await focusState();
check(
  "SR10-backspace-keeps-the-caret-in-the-search-field",
  afterBackspace.focused && afterBackspace.value === "bet" && afterBackspace.caret === 3,
  afterBackspace,
);

// SR11 — even when the search opens another sheet --------------------------------
await input.fill("delta");
await input.press("Enter");
await page.waitForTimeout(600);
const afterJump = await focusState();
check(
  "SR11-opening-a-sheet-keeps-the-caret-in-the-search-field",
  afterJump.focused && afterJump.hits === 1,
  afterJump,
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
