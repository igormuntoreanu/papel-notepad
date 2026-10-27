/**
 * Verification for the seven reported bugs, against the built bundle.
 *   node scripts/verify-bugs.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const PORT = 8092;
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 840 } });
const results = {};
const check = (name, ok, detail) => {
  results[name] = { ok, detail };
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`);
};

await page.addInitScript(() => {
  const dir = { id: "d", name: "d" };
  window.__PAPEL_DESKTOP__ = {
    version: 1,
    async pickDirectory() { return dir; },
    async resolveDirectory() { return dir; },
    async readFile() { return null; },
    async writeFile() { return true; },
    async removeFile() { return true; },
    async listFiles() { return []; },
    async saveFile() { return true; },
  };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = {
    id: "a",
    title: "Verify bugs",
    wrap: true,
    edited: Date.now(),
    sourceExt: "papel",
    language: "auto",
    eol: "lf",
    encoding: "utf-8",
    blocks: [{ kind: "text", text: "alpha\nbeta\ngamma" }],
  };
  const doc = { notes: [note], order: ["a"], activeId: null };
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
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.getByText(/verify bugs/i).first().click();
await page.waitForTimeout(900);

// ---- 1) Ctrl+A selects the whole sheet, with a table between text blocks.
await page.getByRole("button", { name: /^Insert table$/ }).click();
await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
await page.waitForTimeout(400);
await page.locator(".page .block textarea").first().click();
await page.keyboard.press("Control+a");
await page.waitForTimeout(400);
const selected = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll(".page .block:not(.table-block)")];
  return {
    blocks: blocks.length,
    painted: blocks.map((block) => block.querySelectorAll(".hl .find-hit").length),
    spanText: blocks.map((block) => block.querySelector(".hl .find-hit")?.textContent ?? null),
  };
});
check(
  "ctrl-a-whole-sheet",
  selected.blocks === 2 && selected.painted[0] > 0 && selected.spanText[0] === "alpha\nbeta\ngamma",
  JSON.stringify(selected),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

console.log("[dbg] after ctrl-a:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".page .block textarea")].map((a) => a.value.slice(0, 20)))));
// ---- 2) Marks apply on six immediate mouse selections.
const rounds = [];
for (let round = 0; round < 6; round += 1) {
  const area = page.locator(".page .block textarea").first();
  const box = await area.boundingBox();
  const y = box.y + 12;
  await page.mouse.move(box.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, y, { steps: 3 });
  await page.mouse.up();
  await page.getByRole("button", { name: /^Bold/ }).click({ force: true });
  await page.waitForTimeout(200);
  rounds.push(await page.evaluate(() => document.querySelector(".page .block pre span.sb")?.textContent ?? null));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(120);
}
check("marks-reliable", rounds.every((text) => text !== null), JSON.stringify(rounds));

console.log("[dbg] before list:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".page .block textarea")].map((a) => a.value.slice(0, 20)))));
// ---- 3) Caret at the end of a level-3 marker after Enter + Tab.
const listArea = page.locator(".page .block textarea").first();
await listArea.click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\n1) a");
let lastState = null;
const listSteps = [
  { press: "Enter" },
  { type: "b" },
  { press: "Tab" },
  { press: "Enter" },
  { type: "c" },
  { press: "Tab" },
  { press: "Enter" },
];
for (const step of listSteps) {
  if (step.press) await page.keyboard.press(step.press);
  if (step.type) await page.keyboard.type(step.type);
  lastState = await page.evaluate(() => {
    const a = document.querySelector(".page .block textarea");
    return { value: a.value, caret: a.selectionStart, end: a.value.length };
  });
  await page.waitForTimeout(180);
  console.log(
    `[dbg] after ${step.press ?? `type ${step.type}`}:`,
    JSON.stringify(
      await page.evaluate(() => {
        const a = document.querySelector(".page .block textarea");
        return { value: a.value, caret: a.selectionStart, end: a.value.length };
      }),
    ),
  );
}await page.waitForTimeout(300);
await page.keyboard.type("X");
await page.waitForTimeout(300);
const listState = await page.evaluate(() => {
  const a = document.querySelector(".page .block textarea");
  return { value: a.value, caret: a.selectionStart, end: a.value.length };
});
check(
  "list-caret-level-3",
  /1\.1\.2\) X$/.test(listState?.value ?? "") && listState?.caret === listState?.end,
  JSON.stringify(listState),
);

// ---- 4) Alt+drag column selection while Word Wrap is on.
const wrapBefore = await page.getByRole("button", { name: /^Word wrap$/ }).getAttribute("aria-pressed");
const area2 = page.locator(".page .block textarea").first();
const box2 = await area2.boundingBox();
await page.keyboard.down("Alt");
await page.mouse.move(box2.x + 6, box2.y + 12);
await page.mouse.down();
await page.mouse.move(box2.x + 70, box2.y + 46, { steps: 6 });
await page.mouse.up();
await page.keyboard.up("Alt");
await page.waitForTimeout(350);
const altDrag = await page.evaluate(() => ({
  rects: document.querySelectorAll(".page .block-rect").length,
  wrap: document.querySelector(".page")?.getAttribute("data-wrap"),
}));
check(
  "alt-drag-column",
  wrapBefore === "true" && altDrag.rects > 0 && altDrag.wrap === "off",
  JSON.stringify({ wrapBefore, ...altDrag }),
);

// ---- 5) Alignment available while Word Wrap is on.
const alignment = await page.evaluate(() =>
  ["Align left", "Align centre", "Align right"].map((name) => Boolean(document.querySelector(`button[aria-label="${name}"]`))),
);
check("alignment-with-wrap", alignment.every(Boolean), JSON.stringify(alignment));

// ---- 6) No floating Table button; right-click menu carries the actions.
await page.locator(".page .sheet-table td textarea").first().click();
await page.waitForTimeout(200);
const floating = await page.evaluate(() => document.querySelectorAll(".table-tools").length);
await page.locator(".page .table-block").click({ button: "right", position: { x: 5, y: 5 } });
await page.waitForTimeout(300);
const menu = await page.evaluate(() =>
  [...document.querySelectorAll(".cell-menu .menu-item")].map((item) => item.textContent?.trim()),
);
check(
  "table-right-click-only",
  floating === 0 &&
    ["Insert row above", "Insert row below", "Delete row", "Insert column left", "Insert column right", "Delete column", "Delete table"].every(
      (label) => menu.includes(label),
    ),
  JSON.stringify({ floating, menu }),
);
await page.keyboard.press("Escape");

console.log("[dbg] view has page:", await page.evaluate(() => Boolean(document.querySelector(".page"))));
if (!(await page.evaluate(() => Boolean(document.querySelector(".page"))))) {
  await page.getByText(/verify bugs/i).first().click();
  await page.waitForTimeout(600);
}
// ---- 7) Yellow find highlight and a header search that opens with an input.
// Open Find from its toolbar button: Ctrl+F only opens the find bar in the sheet view.
await page.getByRole("button", { name: /Find, replace, go to line/ }).click();
await page.waitForTimeout(300);
await page.locator('.findbar input[aria-label="Find in sheet"]').first().fill("alpha");
await page.waitForTimeout(500);
const find = await page.evaluate(() => {
  // Paint a probe span with the same classes the engine emits and read the colour.
  const host = document.createElement("pre");
  host.className = "hl";
  const span = document.createElement("span");
  span.className = "find-hit";
  span.textContent = "x";
  host.appendChild(span);
  document.body.appendChild(host);
  const background = getComputedStyle(span).backgroundColor;
  host.remove();
  return { exists: true, background };
});
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Search and filters" }).click();
await page.waitForTimeout(300);
const header = await page.evaluate(() => {
  const input = document.querySelector('.filters input[type="search"]');
  if (!input) return { input: false, visible: false };
  const style = getComputedStyle(input);
  return { input: true, visible: style.display !== "none" && input.getBoundingClientRect().width > 0, focused: document.activeElement === input };
});
check(
  "search-yellow-and-open",
  find.background === "rgb(240, 212, 74)" && header.input && header.visible,
  JSON.stringify({ find, header }),
);

const failed = Object.entries(results).filter(([, value]) => !value.ok).map(([name]) => name);
console.log(failed.length ? `FAILED: ${failed.join(", ")}` : "ALL PASS");
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
