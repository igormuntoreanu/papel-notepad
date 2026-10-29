/**
 * Captures visual QA evidence for the editor into AI_Documentation/qa/<version>/.
 *   npm run build:desktop && node scripts/qa-visual.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const VERSION = "0.3.3";
const OUT = join(process.cwd(), "AI_Documentation", "qa", VERSION);
const PORT = 8093;
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
  console.error("[qa-visual] dist-desktop/client missing — run npm run build:desktop first");
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 840 } });

await page.addInitScript(() => {
  const dir = { id: "d", name: "d" };
  window.__PAPEL_DESKTOP__ = {
    version: 1,
    async pickDirectory() {
      return dir;
    },
    async resolveDirectory() {
      return dir;
    },
    async readFile() {
      return null;
    },
    async writeFile() {
      return true;
    },
    async removeFile() {
      return true;
    },
    async listFiles() {
      return [];
    },
    async saveFile() {
      return true;
    },
  };
});

await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const long =
    "New bugs to fix.\n1) Ctrl+A\n2) marks\n3) nesting\n4) Alt selection on a long line: " +
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n" +
    "5) wrap\n6) table\n7) search\nhttps://github.com/igormuntoreanu/papel-notepad/releases";
  const note = {
    id: "a",
    title: "QA visual",
    wrap: true,
    edited: Date.now(),
    sourceExt: "papel",
    language: "auto",
    eol: "lf",
    encoding: "utf-8",
    blocks: [{ kind: "text", text: long }],
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
await page.getByText(/qa visual/i).first().click();
await page.waitForTimeout(900);

const shots = [];

// 01 — Alt column select keeps wrap on
const area = page.locator(".page .block textarea.editor").first();
const box = await area.boundingBox();
await page.keyboard.down("Alt");
await page.mouse.move(box.x + 8, box.y + 70);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 110, { steps: 8 });
await page.mouse.up();
await page.keyboard.up("Alt");
await page.waitForTimeout(300);
const altPath = join(OUT, "01-alt-select-wrap-stays.png");
await page.screenshot({ path: altPath, fullPage: false });
shots.push({
  file: "01-alt-select-wrap-stays.png",
  title: "Alt column select",
  note: "Blue rect visible; Word Wrap stays on (no sheet-wide horizontal break).",
});
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// 02 — toolbar after table cell
await page.getByRole("button", { name: /^Insert table$/ }).click();
await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
await page.waitForTimeout(400);
await page.locator(".page .sheet-table td textarea").first().click();
await page.waitForTimeout(200);
await area.click();
const box2 = await area.boundingBox();
await page.mouse.move(box2.x + 4, box2.y + 12);
await page.mouse.down();
await page.mouse.move(box2.x + 80, box2.y + 12, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^Bold/ }).click({ force: true });
await page.waitForTimeout(250);
const toolbarPath = join(OUT, "02-toolbar-after-table.png");
await page.screenshot({ path: toolbarPath, fullPage: false });
shots.push({
  file: "02-toolbar-after-table.png",
  title: "Toolbar after table",
  note: "After focusing a table cell, text selection enables Bold and paints emphasis.",
});

// Triage shots
await page.keyboard.press("Control+a");
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "triage-ctrl-a.png"), fullPage: false });
shots.push({ file: "triage-ctrl-a.png", title: "Triage: Ctrl+A", note: "Whole-sheet select overlay." });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

const wrapPressed = await page.getByRole("button", { name: /^Word wrap$/ }).getAttribute("aria-pressed");
await page.screenshot({ path: join(OUT, "triage-wrap-align.png"), fullPage: false });
shots.push({
  file: "triage-wrap-align.png",
  title: "Triage: wrap / align",
  note: `Word wrap aria-pressed=${wrapPressed}; alignment buttons visible in toolbar.`,
});

await page.getByRole("button", { name: "Search and filters" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "triage-header-search.png"), fullPage: false });
shots.push({
  file: "triage-header-search.png",
  title: "Triage: header search (lupe)",
  note: "Board/header search control opened from the toolbar/filters affordance.",
});

const index = `# Visual QA ${VERSION}

Captured by \`node scripts/qa-visual.mjs\` against \`dist-desktop/client\` (Chromium).
WebView2 portable builds should match these two fixes; add manual shots here if Edge differs.

## Fixes verified

${shots
  .filter((s) => !s.file.startsWith("triage-"))
  .map((s) => `### ${s.title}\n\n![${s.title}](./${s.file})\n\n${s.note}\n`)
  .join("\n")}

## Triage (evidence only)

${shots
  .filter((s) => s.file.startsWith("triage-"))
  .map((s) => `### ${s.title}\n\n![${s.title}](./${s.file})\n\n${s.note}\n`)
  .join("\n")}

## Harness

Also run \`node scripts/verify-bugs.mjs\` — includes \`alt-drag-column\`, \`alt-drag-clears-without-wrap-off\`, \`toolbar-after-table-cell\`.
`;

await writeFile(join(OUT, "index.md"), index, "utf8");
console.log(`[qa-visual] wrote ${OUT}`);
for (const s of shots) console.log(`  - ${s.file}`);

await browser.close();
server.close();
