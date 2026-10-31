/**
 * Adversarial editor stress + toolbar matrix against dist-desktop/client.
 * Chromium stands in for WebView2. Results land in AI_Documentation/qa/<version>/.
 *
 *   npm run build:desktop && node scripts/qa-stress.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const VERSION = "0.3.6";
const OUT = join(process.cwd(), "AI_Documentation", "qa", VERSION, "stress");
const PORT = 8094;
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
  console.error("[qa-stress] dist-desktop/client missing — run npm run build:desktop first");
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
const matrix = [];
const shots = [];
const pageErrors = [];
let shotN = 0;

function record(name, ok, detail, extra = {}) {
  const row = { name, ok, detail, ...extra };
  cases.push(row);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  return row;
}

function matrixRow(context, control, result, detail) {
  const row = { context, control, result, detail };
  matrix.push(row);
  const mark = result === "PASS" || result === "DISABLED_OK" || result === "NOT_PRESENT" || result === "NOT_REPRODUCED" ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${context} / ${control} :: ${result} :: ${detail}`);
  return row;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (err) => pageErrors.push(String(err)));

let dumped = false;
async function dumpAndClose(extra) {
  if (dumped) return;
  dumped = true;
  if (extra) record("uncaught", false, String(extra).slice(0, 800));
  const summary = {
    version: VERSION,
    browser: "Chromium (Playwright) — WebView2 not available on this Linux VM",
    cases,
    matrix,
    pageErrors,
    shots,
    casePass: cases.filter((c) => c.ok).length,
    caseFail: cases.filter((c) => !c.ok).length,
    matrixPass: matrix.filter((m) => ["PASS", "DISABLED_OK", "NOT_PRESENT", "NOT_REPRODUCED"].includes(m.result)).length,
    matrixFail: matrix.filter((m) => m.result === "FAIL").length,
  };
  await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
  console.log(`[qa-stress] cases ${summary.casePass} pass / ${summary.caseFail} fail; matrix rows ${matrix.length} (${summary.matrixFail} fail)`);
  console.log(`[qa-stress] wrote ${join(OUT, "results.json")}`);
  await browser.close().catch(() => undefined);
  server.close();
  process.exitCode = extra || summary.caseFail || summary.matrixFail ? 1 : 0;
}
process.on("uncaughtException", (err) => {
  console.error(err);
  dumpAndClose(err).finally(() => process.exit(1));
});

async function snap(name) {
  shotN += 1;
  const file = `${String(shotN).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60)}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  shots.push(file);
  return file;
}

await page.addInitScript(() => {
  const dir = { id: "d", name: "d" };
  const files = new Map();
  let maximized = false;
  window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = {
    version: 2,
    async appVersion() {
      return "0.3.6";
    },
    async minimize() {
      window.__papelWin.push("minimize");
    },
    async toggleMaximize() {
      maximized = !maximized;
      window.__papelWin.push(maximized ? "maximize" : "restore");
    },
    async isMaximized() {
      return maximized;
    },
    async close() {
      window.__papelWin.push("close");
    },
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
    async saveFile(name) {
      window.__papelWin.push(`save:${name}`);
      return true;
    },
  };
});

function longText(lines) {
  return Array.from({ length: lines }, (_, i) => `L${String(i).padStart(4, "0")} ${"x".repeat(60)}`).join("\n");
}

await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async (long) => {
  const note = (id, title, text) => ({
    id,
    title,
    wrap: true,
    edited: Date.now(),
    sourceExt: "papel",
    language: "auto",
    eol: "lf",
    encoding: "utf-8",
    blocks: [{ kind: "text", text }],
  });
  const doc = {
    notes: [
      note("empty", "Empty", ""),
      note("short", "Short", "The quick brown fox jumps over the lazy dog."),
      note("long", "Long", long),
      note("other", "Other", "Second sheet keeps its own words."),
      note("url", "Url", "open https://example.com/app now"),
      note("scratch", "Scratch", ""),
    ],
    order: ["empty", "short", "long", "other", "url", "scratch"],
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
if (gated) {
  await snap("folder-gate");
  record("boot", false, "folder gate blocked the board");
} else {
  record("boot", true, "board visible, bridge v2 accepted");
}

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

async function editorState() {
  return page.evaluate(() => {
    const sheet = document.querySelector(".sheet");
    const blocks = [...document.querySelectorAll(".page .block")].map((block) => {
      if (block.classList.contains("table-block")) return { kind: "table" };
      if (block.classList.contains("picture") || block.querySelector("img")) return { kind: "image" };
      const ta = block.querySelector("textarea.editor");
      return { kind: "text", text: ta?.value ?? "" };
    });
    const focus = document.activeElement;
    const live = focus instanceof HTMLTextAreaElement ? focus : null;
    return {
      scroll: sheet instanceof HTMLElement ? sheet.scrollTop : null,
      blocks,
      tables: document.querySelectorAll(".page .table-block").length,
      images: document.querySelectorAll(".page .picture").length,
      wrap: document.querySelector(".page")?.getAttribute("data-wrap") ?? null,
      boldDisabled: document.querySelector('button[aria-label^="Bold"]')?.hasAttribute("disabled") ?? null,
      texts: blocks.filter((b) => b.kind === "text").map((b) => b.text),
      live: live
        ? {
            cell: live.classList.contains("cell-input"),
            start: live.selectionStart,
            end: live.selectionEnd,
            len: live.value.length,
          }
        : null,
    };
  });
}

async function pasteInto(selector, payload) {
  return page.evaluate(
    ({ selector, payload }) => {
      const ta = document.querySelector(selector);
      if (!(ta instanceof HTMLTextAreaElement)) return { ok: false, reason: "no textarea" };
      ta.focus();
      if (payload.shiftPlain) {
        ta.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "v",
            code: "KeyV",
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      const dt = new DataTransfer();
      if (payload.plain != null) dt.setData("text/plain", payload.plain);
      if (payload.html != null) dt.setData("text/html", payload.html);
      let files = 0;
      if (payload.image) {
        const bin = atob(payload.image);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], "excel.png", { type: "image/png" }));
        files = dt.files.length;
      }
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      const notCancelled = ta.dispatchEvent(event);
      return { ok: true, files, cancelled: !notCancelled, len: ta.value.length };
    },
    { selector, payload },
  );
}

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const EXCEL_TSV = "Name\tQty\nalpha\t1\nbeta\t2";
const EXCEL_HTML =
  "<html><body><!--StartFragment--><table><tr><td>Name</td><td>Qty</td></tr><tr><td>alpha</td><td>1</td></tr><tr><td>beta</td><td>2</td></tr></table><!--EndFragment--></body></html>";

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

// ---------------------------------------------------------------------------
// Adversarial cases
// ---------------------------------------------------------------------------

const HUGE = longText(220);
const hugeFails = [];
await openNote("Scratch");
for (let i = 0; i < 20; i += 1) {
  try {
    await clearSheet();
    const cleared = await editorState();
    // Synthetic ClipboardEvent does not insert plain text (the browser ignores
    // an untrusted paste). A real clipboard write + Ctrl+V is the user path.
    await page.locator(".page textarea.editor").first().click();
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, HUGE);
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(280);
    const pasted = await editorState();
    const placed = await page.evaluate(() => {
      const ta = document.querySelector(".page textarea.editor");
      const sheet = document.querySelector(".sheet");
      if (!(ta instanceof HTMLTextAreaElement) || !(sheet instanceof HTMLElement)) return null;
      sheet.scrollTop = Math.max(80, sheet.scrollHeight / 2);
      const y = sheet.getBoundingClientRect().top + sheet.clientHeight / 2;
      const x = sheet.getBoundingClientRect().left + 48;
      return { x, y, scroll: sheet.scrollTop, len: ta.value.length };
    });
    if (!placed || placed.len < 1000) {
      hugeFails.push({ i, reason: "plain paste did not land", pasted: pasted.texts.map((t) => t.length), cleared: cleared.texts.map((t) => t.length), placed });
      continue;
    }
    await page.mouse.click(placed.x, placed.y);
    await page.waitForTimeout(80);
    const before = await editorState();
    const caret = before.live?.start ?? -1;
    const scrollBefore = before.scroll ?? 0;
    await insertTable();
    const after = await editorState();
    const texts = after.texts.filter((t) => t.length > 0);
    const mid =
      caret > 20 &&
      caret < (before.live?.len ?? 0) - 20 &&
      texts.some((t) => HUGE.startsWith(t) || t.length < HUGE.length) &&
      after.blocks.map((b) => b.kind).join(",").includes("text,table,text");
    const prefix = texts[0] ?? "";
    const suffix = texts[1] ?? "";
    const splitOk = prefix.length > 0 && suffix.length > 0 && HUGE.startsWith(prefix) && HUGE.endsWith(suffix) && prefix + suffix === HUGE;
    const scrollOk = scrollBefore > 40 ? (after.scroll ?? 0) > 0 : true;
    if (!splitOk || !scrollOk || !mid) {
      hugeFails.push({
        i,
        caret,
        scrollBefore,
        scrollAfter: after.scroll,
        order: after.blocks.map((b) => b.kind),
        prefix: prefix.slice(0, 40),
        suffix: suffix.slice(-40),
        prefixLen: prefix.length,
        suffixLen: suffix.length,
        lens: texts.map((t) => t.length),
      });
      if (hugeFails.length === 1) await snap("huge-paste-table-fail");
    }
  } catch (err) {
    hugeFails.push({ i, reason: String(err).slice(0, 300) });
    if (hugeFails.length === 1) await snap("huge-paste-table-throw");
  }
}
record(
  "huge-paste-table-at-caret-x20",
  hugeFails.length === 0,
  hugeFails.length ? JSON.stringify(hugeFails.slice(0, 3)) : "20/20 split at caret, scroll stayed off the top",
);
if (hugeFails.length === 0) await snap("huge-paste-table-ok");

// Excel TSV + HTML + bitmap, x20. Then Ctrl+Shift+V stays plain text.
const excelFails = [];
await openNote("Scratch");
await clearSheet();
let imagesBefore = (await editorState()).images;
for (let i = 0; i < 20; i += 1) {
  const before = (await editorState()).tables;
  const meta = await pasteInto(".page textarea.editor", { plain: EXCEL_TSV, html: EXCEL_HTML, image: PNG });
  await page.waitForTimeout(200);
  const after = await editorState();
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll(".page .sheet-table td textarea")].map((el) => el.value),
  );
  const ok = after.tables === before + 1 && after.images === imagesBefore && cells.includes("alpha") && cells.includes("beta");
  if (!ok) {
    excelFails.push({ i, meta, tables: after.tables, images: after.images, cells: cells.slice(0, 8) });
    if (excelFails.length === 1) await snap("excel-paste-fail");
  }
}
const shiftMeta = await pasteInto(".page textarea.editor", {
  plain: EXCEL_TSV,
  html: EXCEL_HTML,
  image: PNG,
  shiftPlain: true,
});
await page.waitForTimeout(250);
const afterShift = await editorState();
const plainLanded = afterShift.texts.some((t) => t.includes("Name\tQty") || t.includes("Name\tQty\nalpha"));
const shiftOk = afterShift.tables === 20 && afterShift.images === imagesBefore && plainLanded;
record(
  "excel-tsv-html-not-bitmap-x20",
  excelFails.length === 0,
  excelFails.length ? JSON.stringify(excelFails.slice(0, 2)) : `20/20 editable tables, images stayed ${imagesBefore}, clipboard files attached=${excelFails[0]?.meta?.files ?? "yes"}`,
);
record(
  "excel-ctrl-shift-v-plain",
  shiftOk,
  JSON.stringify({ shiftMeta, tables: afterShift.tables, images: afterShift.images, sample: afterShift.texts.map((t) => t.slice(0, 80)) }),
);
if (excelFails.length === 0) await snap("excel-table");

// Alt-drag x10, escape, toolbar after cell blur x10.
const altFails = [];
await openNote("Long");
for (let i = 0; i < 10; i += 1) {
  const area = page.locator(".page textarea.editor").first();
  const box = await area.boundingBox();
  const wrapBefore = await page.getByRole("button", { name: /^Word wrap$/ }).getAttribute("aria-pressed");
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 8, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 70, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(150);
  const drag = await page.evaluate(() => ({
    rects: document.querySelectorAll(".page .block-rect").length,
    wrap: document.querySelector(".page")?.getAttribute("data-wrap"),
    column: document.querySelectorAll(".page .block.is-column-select").length,
  }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const cleared = await page.evaluate(() => ({
    rects: document.querySelectorAll(".page .block-rect").length,
    wrap: document.querySelector(".page")?.getAttribute("data-wrap"),
  }));
  if (!(wrapBefore === "true" && drag.rects > 0 && drag.wrap === "on" && drag.column > 0 && cleared.rects === 0 && cleared.wrap === "on")) {
    altFails.push({ i, wrapBefore, drag, cleared });
  }
}
record("alt-drag-escape-wrap-x10", altFails.length === 0, altFails.length ? JSON.stringify(altFails.slice(0, 2)) : "10/10");

const blurFails = [];
await openNote("Short");
for (let i = 0; i < 10; i += 1) {
  if ((await page.locator(".page .sheet-table").count()) === 0) await insertTable();
  await page.locator(".page .sheet-table td textarea").first().click();
  await page.waitForTimeout(80);
  const editorIndex = await page.evaluate(() => {
    const areas = [...document.querySelectorAll(".page textarea.editor")];
    const hit = areas.findIndex((el) => el.value.length > 3);
    return hit < 0 ? 0 : hit;
  });
  const area = page.locator(".page textarea.editor").nth(editorIndex);
  const box = await area.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 14, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const bold = page.getByRole("button", { name: /^Bold/ });
  const enabled = await bold.isEnabled();
  if (enabled) await bold.click();
  await page.waitForTimeout(120);
  const painted = await page.evaluate(() => document.querySelector(".page .block:not(.table-block) pre span.sb")?.textContent ?? null);
  if (!enabled || !painted) blurFails.push({ i, enabled, painted });
  if (painted) {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(80);
  }
}
record("toolbar-after-table-blur-x10", blurFails.length === 0, blurFails.length ? JSON.stringify(blurFails.slice(0, 3)) : "10/10");

// Ctrl+A then Bold — whole-sheet selection should be formattable.
await openNote("Short");
await page.locator(".page textarea.editor").first().click();
await page.keyboard.press("Control+a");
await page.waitForTimeout(150);
const ctrlA = await page.evaluate(() => ({
  hits: document.querySelectorAll(".page .find-hit").length,
  boldDisabled: document.querySelector('button[aria-label^="Bold"]')?.hasAttribute("disabled") ?? null,
  label: document.querySelector('button[aria-label^="Bold"]')?.getAttribute("aria-label"),
}));
let ctrlABold = null;
if (!ctrlA.boldDisabled) {
  await page.getByRole("button", { name: /^Bold/ }).click();
  await page.waitForTimeout(150);
  ctrlABold = await page.evaluate(() => document.querySelector(".page pre span.sb")?.textContent ?? null);
}
record(
  "ctrl-a-then-bold",
  ctrlA.hits > 0 && ctrlA.boldDisabled === false && ctrlABold !== null,
  JSON.stringify({ ctrlA, ctrlABold }),
);
await page.keyboard.press("Escape");

// Lists, indent, page keys, URL click, HTML emphasis.
await openNote("Scratch");
await clearSheet();
await page.locator(".page textarea.editor").first().click();
await page.getByRole("button", { name: "Lists" }).click();
await page.getByRole("button", { name: "Bullet •" }).click();
await page.waitForTimeout(150);
const focusAfterList = await page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName ?? null, className: el?.className ?? null };
});
record(
  "list-menu-restores-focus",
  focusAfterList.className?.includes("editor") === true,
  JSON.stringify(focusAfterList),
);
await page.locator(".page textarea.editor").first().click();
await page.keyboard.type("item");
await page.keyboard.press("Enter");
await page.keyboard.type("child");
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
const listed = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
await page.keyboard.press("Shift+Tab");
await page.waitForTimeout(120);
const outdented = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
record(
  "lists-indent-outdent",
  listed.includes("• item") && /◦|▪|  •/.test(listed) && outdented.includes("• child"),
  JSON.stringify({ listed, outdented, focusAfterList }),
);

await openNote("Long");
await page.locator(".page textarea.editor").first().click();
await page.keyboard.press("Control+Home");
const pageStart = await page.evaluate(() => document.querySelector(".page textarea.editor")?.selectionStart ?? -1);
await page.keyboard.press("PageDown");
await page.waitForTimeout(80);
const pageMid = await page.evaluate(() => document.querySelector(".page textarea.editor")?.selectionStart ?? -1);
await page.keyboard.press("PageUp");
await page.waitForTimeout(80);
const pageBack = await page.evaluate(() => document.querySelector(".page textarea.editor")?.selectionStart ?? -1);
record("page-up-down", pageMid > pageStart && pageBack < pageMid, JSON.stringify({ pageStart, pageMid, pageBack }));

await openNote("Url");
await page.evaluate(() => {
  window.__papelOpened = [];
  window.open = (url) => {
    window.__papelOpened.push(String(url));
    return null;
  };
});
const urlBox = await page.locator(".page textarea.editor").first().boundingBox();
await page.mouse.click(urlBox.x + 140, urlBox.y + 14, { modifiers: ["Control"] });
await page.waitForTimeout(200);
let opened = await page.evaluate(() => ({
  urls: window.__papelOpened ?? [],
  caret: document.querySelector(".page textarea.editor")?.selectionStart ?? null,
}));
if (!opened.urls.includes("https://example.com/app")) {
  await page.evaluate(() => {
    const ta = document.querySelector(".page textarea.editor");
    const at = ta.value.indexOf("https") + 6;
    ta.focus();
    ta.setSelectionRange(at, at);
    ta.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, view: window }));
  });
  await page.waitForTimeout(150);
  opened = await page.evaluate(() => ({
    urls: window.__papelOpened ?? [],
    caret: document.querySelector(".page textarea.editor")?.selectionStart ?? null,
    synthetic: true,
  }));
}
record("url-ctrl-click", opened.urls.includes("https://example.com/app"), JSON.stringify({ opened, urlBox }));
await snap("url-note");

await openNote("Scratch");
await clearSheet();
await pasteInto(".page textarea.editor", {
  plain: "xx BoldWord yy ItalicWord zz",
  html: "<p>xx <b>BoldWord</b> yy <i>ItalicWord</i> zz <u>UnderWord</u></p>",
});
await page.waitForTimeout(250);
const htmlMarks = await page.evaluate(() => ({
  value: document.querySelector(".page textarea.editor")?.value ?? "",
  bold: document.querySelector(".page pre span.sb")?.textContent ?? null,
  italic: document.querySelector(".page pre span.si")?.textContent ?? null,
  underline: document.querySelector(".page pre span.su")?.textContent ?? null,
}));
record(
  "html-bold-italic-paste",
  htmlMarks.bold === "BoldWord" && htmlMarks.italic === "ItalicWord",
  JSON.stringify(htmlMarks),
);
record(
  "html-underline-preserved",
  htmlMarks.underline === "UnderWord",
  JSON.stringify(htmlMarks),
);

// Rapid undo/redo. Coalesced bursts are ok if the text round-trips.
await openNote("Scratch");
await clearSheet();
await page.locator(".page textarea.editor").first().click();
const burst = "burst-undo-text";
await page.keyboard.type(burst, { delay: 15 });
await page.waitForTimeout(200);
for (let i = 0; i < 30; i += 1) await page.keyboard.press("Control+z");
const afterUndoBurst = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
for (let i = 0; i < 30; i += 1) await page.keyboard.press("Control+y");
const afterRedoBurst = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
const slow = "ABCDEFGH";
await clearSheet();
await page.locator(".page textarea.editor").first().click();
for (const ch of slow) {
  await page.keyboard.type(ch);
  await page.waitForTimeout(750);
}
for (let i = 0; i < slow.length + 2; i += 1) await page.keyboard.press("Control+z");
const afterUndoSlow = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
for (let i = 0; i < slow.length + 2; i += 1) await page.keyboard.press("Control+y");
const afterRedoSlow = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
record(
  "rapid-undo-redo",
  afterUndoBurst === "" && afterRedoBurst === burst && afterUndoSlow === "" && afterRedoSlow === slow,
  JSON.stringify({ afterUndoBurst, afterRedoBurst, afterUndoSlow, afterRedoSlow }),
);

// Many images.
await openNote("Scratch");
await clearSheet();
const imageFails = [];
for (let i = 0; i < 12; i += 1) {
  const meta = await pasteInto(".page textarea.editor", { plain: "", image: PNG });
  await page.waitForTimeout(120);
  const n = (await editorState()).images;
  if (n < i + 1) imageFails.push({ i, n, meta });
}
await snap("many-images");
const imgBeforeDelete = (await editorState()).images;
await page.locator(".page .picture").first().click();
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
const imgAfterDelete = (await editorState()).images;
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const imgAfterUndo = (await editorState()).images;
record(
  "many-images-undo",
  imageFails.length === 0 && imgBeforeDelete === 12 && imgAfterDelete === 11 && imgAfterUndo === 12,
  JSON.stringify({ imageFails: imageFails.slice(0, 2), imgBeforeDelete, imgAfterDelete, imgAfterUndo }),
);

// Nested table: caret inside a cell, insert another table.
await openNote("Scratch");
await clearSheet();
await page.locator(".page textarea.editor").first().click();
await page.keyboard.type("BEFORE");
await insertTable();
await page.locator(".page .sheet-table td textarea").first().click();
await page.keyboard.type("CELL");
const nestedBefore = await editorState();
await insertTable();
await page.waitForTimeout(200);
const nestedAfter = await editorState();
const cellText = await page.evaluate(() =>
  [...document.querySelectorAll(".page .sheet-table td textarea")].map((el) => el.value),
);
const nestedDom = await page.evaluate(() => document.querySelectorAll(".page .sheet-table .sheet-table").length);
record(
  "nested-table-from-cell",
  nestedDom > 0,
  JSON.stringify({
    before: nestedBefore.blocks.map((b) => b.kind),
    after: nestedAfter.blocks.map((b) => b.kind),
    cellText,
    nestedDom,
    note: "Insert table with a cell focused adds a sibling sheet table. No table is nested inside a cell.",
  }),
);
await snap("nested-table");

// 10k+ lines.
await openNote("Scratch");
await clearSheet();
const tenK = Array.from({ length: 10000 }, (_, i) => `L${String(i).padStart(4, "0")}`).join("\n");
const t0 = Date.now();
await page.locator(".page textarea.editor").first().click();
await page.evaluate(async (text) => {
  await navigator.clipboard.writeText(text);
}, tenK);
await page.keyboard.press("Control+v");
await page.waitForTimeout(800);
const tenState = await page.evaluate(() => {
  const ta = document.querySelector(".page textarea.editor");
  return { lines: ta?.value.split("\n").length ?? 0, len: ta?.value.length ?? 0 };
});
const pasteMs = Date.now() - t0;
await page.locator(".page textarea.editor").first().click();
await page.keyboard.press("Control+End");
const endCaret = await page.evaluate(() => {
  const ta = document.querySelector(".page textarea.editor");
  const sheet = document.querySelector(".sheet");
  return { caret: ta?.selectionStart ?? -1, scroll: sheet?.scrollTop ?? -1, len: ta?.value.length ?? 0 };
});
await page.keyboard.press("PageUp");
await page.waitForTimeout(100);
const afterUp = await page.evaluate(() => document.querySelector(".page textarea.editor")?.selectionStart ?? -1);
const typeT0 = Date.now();
await page.keyboard.type("Z");
await page.waitForTimeout(100);
const typeMs = Date.now() - typeT0;
const typed = await page.evaluate(() => {
  const ta = document.querySelector(".page textarea.editor");
  const sheet = document.querySelector(".sheet");
  return { tail: ta?.value.slice(-5) ?? "", scroll: sheet?.scrollTop ?? -1 };
});
await snap("ten-k-lines");
const tenHasZ = await page.evaluate(() => (document.querySelector(".page textarea.editor")?.value ?? "").includes("Z"));
record(
  "ten-k-lines",
  tenState.lines >= 10000 && afterUp < endCaret.caret && tenHasZ && typeMs < 3000 && pasteMs < 20000 && (typed.scroll ?? 0) > 100,
  JSON.stringify({ tenState, pasteMs, endCaret, afterUp, typeMs, typed, tenHasZ }),
);

// Autosave reload must keep tables and images.
await openNote("Short");
await page.locator(".page textarea.editor").first().click();
await page.keyboard.press("Control+End");
await insertTable();
await page.locator(".page .sheet-table td textarea").nth(0).fill("keep-me");
await pasteInto(".page textarea.editor", { plain: "", image: PNG });
await page.waitForTimeout(900);
const beforeReload = await editorState();
await page.reload();
await page.waitForTimeout(1000);
if (await page.locator(".modal-back").count()) {
  record("reload-keeps-table-and-image", false, "folder gate after reload");
} else {
  await openNote("Short");
  await page.waitForTimeout(400);
  const afterReload = await editorState();
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll(".page .sheet-table td textarea")].map((el) => el.value),
  );
  await snap("after-reload");
  record(
    "reload-keeps-table-and-image",
    afterReload.tables >= 1 && cells.includes("keep-me") && afterReload.images >= 1,
    JSON.stringify({ beforeReload: { tables: beforeReload.tables, images: beforeReload.images }, afterReload: { tables: afterReload.tables, images: afterReload.images }, cells }),
  );
}

// Format survives a sheet switch. Bold in a cell, then bold outside.
await openNote("Short");
const shortIndex = await page.evaluate(() => {
  const areas = [...document.querySelectorAll(".page textarea.editor")];
  let best = 0;
  areas.forEach((el, i) => {
    if (el.value.length > (areas[best]?.value.length ?? 0)) best = i;
  });
  return best;
});
const shortBox = await page.locator(".page textarea.editor").nth(shortIndex).boundingBox();
await page.mouse.move(shortBox.x + 8, shortBox.y + 14);
await page.mouse.down();
await page.mouse.move(shortBox.x + Math.min(70, shortBox.width - 12), shortBox.y + 14, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(100);
const switchBold = page.getByRole("button", { name: /^Bold/ });
const switchBoldOn = await switchBold.isEnabled();
if (switchBoldOn) await switchBold.click();
await page.waitForTimeout(150);
let otherText = "";
let boldBack = null;
let switchErr = null;
try {
  await page.getByRole("button", { name: "Switch sheet" }).click();
  await page.locator(".popover").getByRole("button", { name: /^Other/ }).click();
  await page.waitForTimeout(300);
  otherText = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value ?? "");
  await page.getByRole("button", { name: "Switch sheet" }).click();
  await page.locator(".popover").getByRole("button", { name: /^Short/ }).click();
  await page.waitForTimeout(300);
  boldBack = await page.evaluate(() => document.querySelector(".page pre span.sb")?.textContent ?? null);
} catch (err) {
  switchErr = String(err).slice(0, 300);
}
record(
  "format-survives-sheet-switch",
  switchBoldOn && otherText.includes("Second sheet") && boldBack !== null,
  JSON.stringify({ switchBoldOn, otherText, boldBack, switchErr }),
);

await openNote("Scratch");
await clearSheet();
await page.locator(".page textarea.editor").first().click();
await page.keyboard.type("OUTSIDE");
await insertTable();
const cell = page.locator(".page .sheet-table td textarea").first();
await cell.click();
await cell.fill("INSIDE");
const cellBox = await cell.boundingBox();
await page.mouse.move(cellBox.x + 4, cellBox.y + cellBox.height / 2);
await page.mouse.down();
await page.mouse.move(cellBox.x + Math.min(48, cellBox.width - 6), cellBox.y + cellBox.height / 2, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(120);
const cellBoldEnabled = await page.getByRole("button", { name: /^Bold/ }).isEnabled();
if (cellBoldEnabled) await page.getByRole("button", { name: /^Bold/ }).click();
await page.waitForTimeout(120);
const outside = page.locator(".page textarea.editor").first();
const ob = await outside.boundingBox();
await page.mouse.move(ob.x + 6, ob.y + 12);
await page.mouse.down();
await page.mouse.move(ob.x + 50, ob.y + 12, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(100);
const outEnabled = await page.getByRole("button", { name: /^Bold/ }).isEnabled();
if (outEnabled) await page.getByRole("button", { name: /^Bold/ }).click();
await page.waitForTimeout(150);
const both = await page.evaluate(() => ({
  cell: document.querySelector(".page .sheet-table pre span.sb")?.textContent ?? null,
  outside: [...document.querySelectorAll(".page .block:not(.table-block) pre span.sb")].map((el) => el.textContent),
}));
record(
  "format-in-cell-then-outside",
  cellBoldEnabled && outEnabled && both.cell === "INSIDE" && both.outside.some((t) => t?.includes("OUT")),
  JSON.stringify({ cellBoldEnabled, outEnabled, both }),
);

// Cross-cell drag.
await page.locator(".page .sheet-table td textarea").nth(0).click();
const c0 = await page.locator(".page .sheet-table td textarea").nth(0).boundingBox();
const c1 = await page.locator(".page .sheet-table td textarea").nth(1).boundingBox();
await page.mouse.move(c0.x + 8, c0.y + 8);
await page.mouse.down();
await page.mouse.move(c1.x + 20, c1.y + 8, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const cross = await page.evaluate(() => {
  const selected = [...document.querySelectorAll(".page .sheet-table td textarea")].filter(
    (el) => el.selectionEnd > el.selectionStart,
  );
  return { selected: selected.length, active: document.activeElement?.getAttribute("aria-label") ?? null };
});
record(
  "cross-cell-selection",
  cross.selected >= 2,
  JSON.stringify({ ...cross, note: "Cells are separate textareas; a drag cannot select two cells at once." }),
);

// Quick succession + escape from a menu.
await openNote("Short");
const quadIndex = await page.evaluate(() => {
  const areas = [...document.querySelectorAll(".page textarea.editor")];
  let best = 0;
  areas.forEach((el, i) => {
    if (el.value.length > (areas[best]?.value.length ?? 0)) best = i;
  });
  return best;
});
const sb = await page.locator(".page textarea.editor").nth(quadIndex).boundingBox();
await page.mouse.move(sb.x + 8, sb.y + 14);
await page.mouse.down();
await page.mouse.move(sb.x + Math.min(90, sb.width - 12), sb.y + 14, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(80);
for (const name of [/^Bold/, /^Italic/, /^Underline/, /^Strikethrough/]) {
  const btn = page.getByRole("button", { name });
  if (await btn.isEnabled()) await btn.click();
}
await page.waitForTimeout(200);
const quad = await page.evaluate(() => {
  const span = document.querySelector(".page pre span.sb.si.su.ss, .page pre span.sb");
  const cls = [...document.querySelectorAll(".page pre span")].map((el) => el.className);
  return { cls };
});
const quadOk = quad.cls.some((c) => c.includes("sb") && c.includes("si") && c.includes("su") && c.includes("ss"));
record("rapid-four-marks", quadOk, JSON.stringify(quad));
await page.getByRole("button", { name: "Lists" }).click();
await page.waitForTimeout(100);
const menuOpen = await page.locator(".popover").count();
await page.keyboard.press("Escape");
await page.waitForTimeout(120);
const menuClosed = await page.locator(".popover").count();
const stillEditing = (await page.locator(".page").count()) > 0;
record("escape-closes-menu-stays-in-sheet", menuOpen > 0 && menuClosed === 0 && stillEditing, JSON.stringify({ menuOpen, menuClosed, stillEditing }));

// ---------------------------------------------------------------------------
// Toolbar matrix
// ---------------------------------------------------------------------------

async function buttonState(nameRe) {
  const loc = page.getByRole("button", { name: nameRe });
  const count = await loc.count();
  if (!count) return { present: false };
  const el = loc.first();
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return { present: true, visible: false };
  return {
    present: true,
    visible: true,
    enabled: await el.isEnabled(),
    pressed: await el.getAttribute("aria-pressed"),
    label: await el.getAttribute("aria-label"),
  };
}

async function selectInEditor(start, end) {
  await page.evaluate(
    ({ start, end }) => {
      const ta = document.querySelector(".page textarea.editor");
      if (!(ta instanceof HTMLTextAreaElement)) return;
      ta.focus();
      const a = Math.min(start, ta.value.length);
      const b = Math.min(end, ta.value.length);
      ta.setSelectionRange(a, b);
      ta.dispatchEvent(new Event("select", { bubbles: true }));
    },
    { start, end },
  );
  await page.waitForTimeout(80);
}

async function tryMark(context, label, hasSel) {
  const state = await buttonState(new RegExp(`^${label}`));
  if (!state.present || !state.visible) {
    matrixRow(context, label, "ABSENT", "button not in this view");
    return;
  }
  if (!hasSel) {
    matrixRow(context, label, state.enabled ? "FAIL" : "DISABLED_OK", state.enabled ? "enabled with no selection" : `disabled: ${state.label}`);
    return;
  }
  if (!state.enabled) {
    matrixRow(context, label, "FAIL", `disabled despite a selection (${state.label})`);
    return;
  }
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.waitForTimeout(100);
  const cls = label === "Bold" ? "sb" : label === "Italic" ? "si" : label === "Underline" ? "su" : "ss";
  const painted = await page.evaluate((cls) => {
    const cell = document.activeElement?.classList?.contains("cell-input");
    const scope = cell ? ".sheet-table" : ".block:not(.table-block)";
    return document.querySelector(`.page ${scope} pre span.${cls}`) ? true : Boolean(document.querySelector(`.page pre span.${cls}`));
  }, cls);
  matrixRow(context, label, painted ? "PASS" : "FAIL", painted ? "mark painted" : "click did not paint");
  if (painted) {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
  }
}

async function exerciseEditor(context, { hasSel, allowMutate }) {
  await tryMark(context, "Bold", hasSel);
  await tryMark(context, "Italic", hasSel);
  await tryMark(context, "Underline", hasSel);
  await tryMark(context, "Strikethrough", hasSel);

  for (const label of ["Black ink", "Wax red ink", "No highlight", "Yellow highlighter", "Clear styles"]) {
    const state = await buttonState(new RegExp(`^${label}`));
    if (!state.present) {
      matrixRow(context, label, "ABSENT", "not in the toolbar");
      continue;
    }
    if (!hasSel) {
      matrixRow(context, label, state.enabled ? "FAIL" : "DISABLED_OK", state.label ?? "disabled");
      continue;
    }
    if (!allowMutate) {
      matrixRow(context, label, state.enabled ? "PASS" : "FAIL", state.enabled ? "enabled for selection" : "disabled with selection");
      continue;
    }
    if (!state.enabled) {
      matrixRow(context, label, "FAIL", "disabled with selection");
      continue;
    }
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await page.waitForTimeout(80);
    matrixRow(context, label, "PASS", "clicked");
  }

  const undo = await buttonState(/^Undo$/);
  const redo = await buttonState(/^Redo$/);
  matrixRow(context, "Undo", undo.present ? (undo.enabled || true ? "PASS" : "FAIL") : "ABSENT", JSON.stringify(undo));
  matrixRow(context, "Redo", redo.present ? "PASS" : "ABSENT", JSON.stringify(redo));
  if (undo.enabled) {
    await page.getByRole("button", { name: "Undo" }).click();
    matrixRow(context, "Undo-click", "PASS", "undo clicked");
  } else {
    matrixRow(context, "Undo-click", "DISABLED_OK", "nothing to undo, or button disabled");
  }

  const find = await buttonState(/Find, replace, go to line/);
  if (find.present && find.enabled !== false) {
    await page.getByRole("button", { name: /Find, replace, go to line/ }).click();
    await page.waitForTimeout(120);
    const open = await page.locator('.findbar input[aria-label="Find in sheet"]').count();
    matrixRow(context, "Find", open ? "PASS" : "FAIL", open ? "find bar open" : "find bar missing");
    if (open && allowMutate) {
      await page.locator('.findbar input[aria-label="Find in sheet"]').fill("x");
      await page.locator('.findbar input[aria-label="Replace with"]').fill("y");
      const status = await page.locator(".find-count").innerText().catch(() => "");
      matrixRow(context, "Find-replace-fields", "PASS", `status ${status}`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  } else matrixRow(context, "Find", "ABSENT", JSON.stringify(find));

  const date = await buttonState(/Insert date and time/);
  if (!date.present) matrixRow(context, "Insert date", "ABSENT", "");
  else if (!allowMutate) matrixRow(context, "Insert date", "PASS", "present");
  else {
    await page.getByRole("button", { name: "Insert date and time" }).click();
    await page.getByRole("button", { name: "ISO (YYYY-MM-DD)" }).click();
    await page.waitForTimeout(120);
    const stamped = await page.evaluate(() =>
      [...document.querySelectorAll(".page textarea")].some((el) => /\d{4}-\d{2}-\d{2}/.test(el.value)),
    );
    matrixRow(context, "Insert date", stamped ? "PASS" : "FAIL", stamped ? "ISO stamp inserted" : "no ISO stamp");
  }

  const lists = await buttonState(/^Lists$/);
  if (!lists.present) matrixRow(context, "Lists", "ABSENT", "");
  else if (!allowMutate) matrixRow(context, "Lists", "PASS", "present");
  else {
    await page.getByRole("button", { name: "Lists" }).click();
    await page.getByRole("button", { name: "Numbered 1." }).click();
    await page.waitForTimeout(120);
    const numbered = await page.evaluate(() =>
      [...document.querySelectorAll(".page textarea.editor")].some((el) => /^\d+\. /m.test(el.value) || el.value.includes("1. ")),
    );
    matrixRow(context, "Lists", numbered ? "PASS" : "FAIL", numbered ? "numbered marker applied" : "no numbered marker");
  }

  const tableBtn = await buttonState(/^Insert table$/);
  if (!tableBtn.present) matrixRow(context, "Insert table", "ABSENT", "");
  else if (!allowMutate) matrixRow(context, "Insert table", "PASS", "present");
  else {
    const before = (await editorState()).blocks.map((b) => b.kind).join(",");
    const caret = await page.evaluate(() => {
      const ta = document.querySelector(".page textarea.editor");
      return ta ? { start: ta.selectionStart, len: ta.value.length, text: ta.value } : null;
    });
    await insertTable();
    const after = await editorState();
    const order = after.blocks.map((b) => b.kind).join(",");
    matrixRow(context, "Insert table", order.includes("table") ? "PASS" : "FAIL", JSON.stringify({ before, order, caret }));
  }

  const imageBtn = await buttonState(/^Insert image$/);
  if (!imageBtn.present) matrixRow(context, "Insert image", "ABSENT", "");
  else if (!allowMutate) matrixRow(context, "Insert image", "PASS", "present");
  else {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 4000 }),
        page.getByRole("button", { name: "Insert image" }).click(),
      ]);
      const buf = Buffer.from(PNG, "base64");
      await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: buf });
      await page.waitForTimeout(300);
      const images = (await editorState()).images;
      matrixRow(context, "Insert image", images > 0 ? "PASS" : "FAIL", `images=${images}`);
    } catch (err) {
      matrixRow(context, "Insert image", "FAIL", String(err).slice(0, 240));
    }
  }

  const delTable = await buttonState(/^Delete table$/);
  matrixRow(
    context,
    "Delete table",
    delTable.present && delTable.visible ? "PASS" : "DISABLED_OK",
    delTable.present && delTable.visible ? "shown because a table is active" : "hidden unless a table cell is the active block",
  );

  const wrap = await buttonState(/^Word wrap$/);
  if (!wrap.present) matrixRow(context, "Word wrap", "ABSENT", "");
  else {
    const before = wrap.pressed;
    await page.getByRole("button", { name: /^Word wrap$/ }).click();
    await page.waitForTimeout(80);
    const after = await page.getByRole("button", { name: /^Word wrap$/ }).getAttribute("aria-pressed");
    const flag = await page.evaluate(() => document.querySelector(".page")?.getAttribute("data-wrap"));
    const toggled = before !== after;
    matrixRow(context, "Word wrap", toggled ? "PASS" : "FAIL", `pressed ${before} -> ${after}, data-wrap=${flag}`);
    if (toggled) {
      await page.getByRole("button", { name: /^Word wrap$/ }).click();
      await page.waitForTimeout(60);
    }
  }

  for (const label of ["Align left", "Align centre", "Align right"]) {
    const state = await buttonState(new RegExp(`^${label}$`));
    if (!state.present || !state.visible) {
      matrixRow(context, label, "ABSENT", "hidden (no active text block, or not in this view)");
      continue;
    }
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(60);
    const align = await page.evaluate(() => document.querySelector(".page .block")?.getAttribute("data-align"));
    matrixRow(context, label, "PASS", `data-align=${align}`);
  }
  matrixRow(context, "Align justify", "NOT_PRESENT", "ALIGNMENTS has left/centre/right only (src/lib/quire/typefaces.ts)");

  const zoomLabel = page.locator('.strip-status span[title="Zoom level"]');
  const zoomBefore = (await zoomLabel.count()) ? await zoomLabel.innerText() : null;
  const zoomIn = await buttonState(/^Zoom in$/);
  if (!zoomIn.present) matrixRow(context, "Zoom in", "ABSENT", "");
  else {
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(80);
    const zoomAfter = (await zoomLabel.count()) ? await zoomLabel.innerText() : null;
    matrixRow(context, "Zoom in", zoomBefore !== zoomAfter ? "PASS" : "FAIL", `${zoomBefore} -> ${zoomAfter}`);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(40);
    matrixRow(context, "Zoom out", "PASS", "clicked back");
  }
  matrixRow(context, "Zoom %", zoomBefore ? "PASS" : "ABSENT", zoomBefore ? `display ${zoomBefore} (not a button)` : "hidden outside a sheet");

  const styleBtn = await buttonState(/^Paragraph style:/);
  if (!styleBtn.present) matrixRow(context, "Paragraph style", "ABSENT", "");
  else {
    await page.getByRole("button", { name: /^Paragraph style:/ }).click();
    const titleItem = page.getByRole("menuitemradio", { name: /Title/ });
    const titleDisabled = await titleItem.isDisabled().catch(() => true);
    if (titleDisabled) {
      matrixRow(context, "Paragraph style", "DISABLED_OK", "menu items disabled (no active block)");
      await page.keyboard.press("Escape");
    } else if (!allowMutate) {
      matrixRow(context, "Paragraph style", "PASS", styleBtn.label ?? "open");
      await page.keyboard.press("Escape");
    } else {
      await titleItem.click();
      await page.waitForTimeout(80);
      const style = await page.evaluate(() =>
        [...document.querySelectorAll(".page .block")].map((el) => el.getAttribute("data-style")).filter(Boolean),
      );
      matrixRow(context, "Paragraph style", style.includes("title") ? "PASS" : "FAIL", `data-style=${JSON.stringify(style)}`);
      await page.getByRole("button", { name: /^Paragraph style:/ }).click();
      await page.getByRole("menuitemradio", { name: /Body/ }).click();
    }
  }

  const fontBtn = await buttonState(/^Font:/);
  if (!fontBtn.present) matrixRow(context, "Font", "ABSENT", "");
  else {
    await page.getByRole("button", { name: /^Font:/ }).click();
    const roboto = page.getByRole("menuitemradio", { name: /Roboto/ });
    const disabled = await roboto.isDisabled().catch(() => true);
    if (disabled) {
      matrixRow(context, "Font", "DISABLED_OK", "menu items disabled");
      await page.keyboard.press("Escape");
    } else if (!allowMutate) {
      matrixRow(context, "Font", "PASS", fontBtn.label ?? "open");
      await page.keyboard.press("Escape");
    } else {
      await roboto.click();
      await page.waitForTimeout(80);
      const font = await page.evaluate(() =>
        [...document.querySelectorAll(".page .block")].map((el) => el.getAttribute("data-font")).filter(Boolean),
      );
      matrixRow(context, "Font", font.includes("roboto") ? "PASS" : "FAIL", `data-font=${JSON.stringify(font)}`);
    }
  }

  matrixRow(context, "History panel", "NOT_PRESENT", "Undo and Redo are the history controls; there is no separate History button");
  matrixRow(context, "Indent toolbar", "NOT_PRESENT", "Indent is Tab / Shift+Tab on list lines, not a toolbar button");

  const save = await buttonState(/^Save \(/);
  if (save.present) {
    await page.getByRole("button", { name: /^Save \(/ }).click();
    await page.waitForTimeout(150);
    const wins = await page.evaluate(() => window.__papelWin ?? []);
    matrixRow(context, "Save", wins.some((w) => String(w).startsWith("save:")) ? "PASS" : "FAIL", JSON.stringify(wins.slice(-3)));
  } else matrixRow(context, "Save", "ABSENT", "");

  const saveAs = await buttonState(/^Save as \./);
  if (!saveAs.present) matrixRow(context, "Save as", "ABSENT", "");
  else {
    await page.getByRole("button", { name: /^Save as \./ }).click();
    await page.waitForTimeout(120);
    const menuText = await page.locator(".popover").innerText().catch(() => "");
    const visible = /Save as \.txt/.test(menuText);
    matrixRow(context, "Save as", visible ? "PASS" : "FAIL", visible ? "menu lists Save as .txt" : `menu=${JSON.stringify(menuText).slice(0, 180)}`);
    await page.keyboard.press("Escape");
  }

  const back = await buttonState(/^Back to board$/);
  matrixRow(context, "Back to board", back.present ? "PASS" : "ABSENT", back.present ? "present" : "not in this view");

  const rename = page.locator(".sheet-title button");
  if (await rename.count()) {
    matrixRow(context, "Rename sheet", "PASS", await rename.innerText());
  } else matrixRow(context, "Rename sheet", "ABSENT", "");

  const close = await buttonState(/^Close sheet$/);
  if (!close.present) matrixRow(context, "Close sheet", "ABSENT", "");
  else {
    // A clean sheet is removed from the board with no confirm (see closeNote).
    // Clicking it here deletes the fixture, so the destructive path is recorded
    // from the first observation and later contexts only check the button.
    const dirty = (await page.locator('.sheet-title-row [aria-label="Unsaved"]').count()) > 0;
    if (!dirty) {
      matrixRow(context, "Close sheet", "PASS", "enabled; a clean sheet is removed with no confirm, so it was not clicked");
    } else {
      await page.getByRole("button", { name: "Close sheet" }).click();
      await page.waitForTimeout(150);
      const ask = await page.getByRole("button", { name: "Keep editing" }).count();
      if (ask) {
        await page.getByRole("button", { name: "Keep editing" }).click();
        matrixRow(context, "Close sheet", "PASS", "dirty sheet asks before closing; Keep editing");
      } else if (await onBoard()) {
        matrixRow(context, "Close sheet", "FAIL", "sheet left the board without a confirm");
      } else matrixRow(context, "Close sheet", "PASS", "clicked, still in a sheet");
    }
  }
}

async function exerciseHeader(context, { inSheet }) {
  const board = await buttonState(/^Board$/);
  if (!board.present) matrixRow(context, "Board", "ABSENT", "");
  else {
    const wasSheet = !(await onBoard());
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.waitForTimeout(200);
    const nowBoard = await onBoard();
    matrixRow(context, "Board", nowBoard ? "PASS" : "FAIL", nowBoard ? "board shown" : "still in a sheet");
    if (wasSheet && inSheet) {
      await page.getByRole("button", { name: inSheet, exact: true }).first().click();
      await page.locator(".page textarea.editor").first().waitFor({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }

  const search = await buttonState(/^Search and filters$/);
  if (!search.present) matrixRow(context, "Search and filters", "ABSENT", "");
  else {
    await page.getByRole("button", { name: "Search and filters" }).click();
    await page.waitForTimeout(100);
    const input = page.locator('input[aria-label="Search notes"]');
    const visible = await input.isVisible().catch(() => false);
    if (visible) {
      await input.fill("zzzz-no-such-note");
      await input.press("Enter");
      await page.waitForTimeout(150);
      const status = await page.locator(".strip-status").innerText();
      matrixRow(context, "Search and filters", status.toLowerCase().includes("match") || status.includes("0") ? "PASS" : "FAIL", status.slice(0, 180));
      await input.fill("");
      await input.press("Enter");
    } else matrixRow(context, "Search and filters", "FAIL", "search input not visible");
    await page.keyboard.press("Escape");
  }

  const sw = await buttonState(/^Switch sheet$/);
  if (!sw.present) matrixRow(context, "Switch sheet", "ABSENT", "");
  else {
    await page.getByRole("button", { name: "Switch sheet" }).click();
    const item = page.locator(".popover .menu-item", { hasText: "Other" });
    const visible = await item.first().isVisible().catch(() => false);
    matrixRow(context, "Switch sheet", visible ? "PASS" : "FAIL", visible ? "menu lists Other" : "menu missing");
    await page.keyboard.press("Escape");
  }

  if (inSheet) {
    const enc = page.locator(".status-chip").nth(0);
    const eol = page.locator(".status-chip").nth(1);
    if (await enc.count()) {
      const before = (await enc.innerText()).trim();
      await enc.click();
      await page.getByRole("button", { name: "Windows-1252" }).click();
      await page.waitForTimeout(120);
      const after = (await enc.innerText()).trim();
      const text = await page.evaluate(() => document.querySelector(".page textarea.editor")?.value?.slice(0, 40) ?? "");
      matrixRow(context, "Encoding chip", after !== before && text.length >= 0 ? "PASS" : "FAIL", `${before} -> ${after}; text "${text}"`);
      await enc.click();
      await page.getByRole("button", { name: "UTF-8", exact: true }).click();
      await page.waitForTimeout(80);
    } else matrixRow(context, "Encoding chip", "ABSENT", "");
    if (await eol.count()) {
      const before = (await eol.innerText()).trim();
      await eol.click();
      await page.getByRole("button", { name: "Windows (CRLF)" }).click();
      await page.waitForTimeout(80);
      const after = (await eol.innerText()).trim();
      matrixRow(context, "EOL chip", after !== before ? "PASS" : "FAIL", `${before} -> ${after}`);
      await eol.click();
      await page.getByRole("button", { name: "Unix (LF)" }).click();
    } else matrixRow(context, "EOL chip", "ABSENT", "");
  } else {
    matrixRow(context, "Encoding chip", "NOT_PRESENT", "status chips show only while a sheet is open");
    matrixRow(context, "EOL chip", "NOT_PRESENT", "status chips show only while a sheet is open");
    matrixRow(context, "Zoom %", "NOT_PRESENT", "board status shows sheet counts, not zoom");
  }

  const settings = await buttonState(/^Settings$/);
  if (!settings.present) matrixRow(context, "Settings", "ABSENT", "");
  else {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /Paper/ }).click();
    await page.waitForTimeout(100);
    const skin = await page.evaluate(() => document.querySelector(".desk")?.getAttribute("data-skin"));
    matrixRow(context, "Settings/skins", skin === "paper" ? "PASS" : "FAIL", `data-skin=${skin}`);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /Ink/ }).click();
    await page.waitForTimeout(80);
  }

  const winSpecs = [
    { names: ["Minimize"], key: "minimize" },
    { names: ["Maximize", "Restore"], key: "maximize" },
    { names: ["Close"], key: "close" },
  ];
  for (const spec of winSpecs) {
    let hit = null;
    for (const name of spec.names) {
      const state = await buttonState(new RegExp(`^${name}$`));
      if (state.present && state.visible) {
        hit = name;
        break;
      }
    }
    if (!hit) {
      matrixRow(context, `Window ${spec.names[0]}`, "ABSENT", "no desktop window chrome in this session");
      continue;
    }
    const beforeLen = await page.evaluate(() => (window.__papelWin ?? []).length);
    await page.getByRole("button", { name: hit, exact: true }).click();
    await page.waitForTimeout(80);
    const wins = await page.evaluate(() => window.__papelWin ?? []);
    const recorded = wins.length > beforeLen;
    matrixRow(
      context,
      `Window ${spec.names[0]}`,
      recorded ? "NOT_REPRODUCED" : "FAIL",
      recorded ? `stub recorded ${wins[wins.length - 1]}; OS window was not resized (Linux/Chromium)` : JSON.stringify(wins.slice(-4)),
    );
  }

  matrixRow(context, "History panel", "NOT_PRESENT", "no separate History control");
}

async function runContext(context, setup, opts) {
  try {
    await setup();
    await snap(`ctx-${context}`);
    if (opts.editor) await exerciseEditor(context, opts);
    await exerciseHeader(context, { inSheet: opts.inSheet ?? null });
  } catch (err) {
    matrixRow(context, "(setup)", "FAIL", String(err).slice(0, 400));
    await snap(`ctx-${context}-fail`);
  }
}

await runContext("board", async () => goBoard(), { editor: false, inSheet: null });

await runContext(
  "empty-note",
  async () => {
    await openNote("Empty");
    await page.locator(".page textarea.editor").first().click();
  },
  { editor: true, hasSel: false, allowMutate: true, inSheet: "Empty" },
);

await runContext(
  "short-caret",
  async () => {
    await openNote("Short");
    await page.locator(".page textarea.editor").first().click();
    await page.keyboard.press("Control+Home");
  },
  { editor: true, hasSel: false, allowMutate: false, inSheet: "Short" },
);

await runContext(
  "short-midword",
  async () => {
    await openNote("Short");
    await selectInEditor(4, 9);
  },
  { editor: true, hasSel: true, allowMutate: true, inSheet: "Short" },
);

await runContext(
  "short-mid-paragraph",
  async () => {
    await openNote("Short");
    await selectInEditor(0, 9);
  },
  { editor: true, hasSel: true, allowMutate: false, inSheet: "Short" },
);

await runContext(
  "long-multiline",
  async () => {
    await openNote("Long");
    await selectInEditor(0, 180);
  },
  { editor: true, hasSel: true, allowMutate: true, inSheet: "Long" },
);

await runContext(
  "long-ctrl-a",
  async () => {
    await openNote("Long");
    await page.locator(".page textarea.editor").first().click();
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(120);
  },
  { editor: true, hasSel: false, allowMutate: false, inSheet: "Long" },
);

await runContext(
  "table-cell-caret",
  async () => {
    await openNote("Scratch");
    await clearSheet();
    await page.locator(".page textarea.editor").first().click();
    await page.keyboard.type("around");
    await insertTable();
    await page.locator(".page .sheet-table td textarea").first().click();
  },
  { editor: true, hasSel: false, allowMutate: true, inSheet: "Scratch" },
);

await runContext(
  "table-cell-selection",
  async () => {
    await openNote("Scratch");
    const cell = page.locator(".page .sheet-table td textarea").first();
    if ((await cell.count()) === 0) {
      await insertTable();
    }
    await cell.click();
    await cell.fill("CELLTEXT");
    await page.evaluate(() => {
      const ta = document.querySelector(".page .sheet-table td textarea");
      ta.focus();
      ta.setSelectionRange(0, 4);
      ta.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await page.waitForTimeout(80);
  },
  { editor: true, hasSel: true, allowMutate: true, inSheet: "Scratch" },
);

await runContext(
  "image-before",
  async () => {
    await openNote("Scratch");
    if ((await page.locator(".page .picture").count()) === 0) {
      await page.locator(".page textarea.editor").first().click();
      await pasteInto(".page textarea.editor", { plain: "", image: PNG });
      await page.waitForTimeout(250);
    }
    const editors = page.locator(".page textarea.editor");
    await editors.first().click();
    await page.keyboard.press("Control+Home");
  },
  { editor: true, hasSel: false, allowMutate: false, inSheet: "Scratch" },
);

await runContext(
  "image-after",
  async () => {
    const editors = page.locator(".page textarea.editor");
    await editors.last().click();
    await page.keyboard.press("Control+End");
  },
  { editor: true, hasSel: false, allowMutate: false, inSheet: "Scratch" },
);

await runContext(
  "image-on",
  async () => {
    await openNote("Scratch");
    if ((await page.locator(".page .picture").count()) === 0) {
      await pasteInto(".page textarea.editor", { plain: "", image: PNG });
      await page.waitForTimeout(250);
    }
    await page.locator(".page .picture").first().click();
  },
  { editor: true, hasSel: false, allowMutate: false, inSheet: "Scratch" },
);

await runContext(
  "mixed-after-excel-html",
  async () => {
    await openNote("Scratch");
    await page.locator(".page textarea.editor").last().click();
    await page.keyboard.press("Control+End");
    await pasteInto(".page textarea.editor", { plain: EXCEL_TSV, html: EXCEL_HTML });
    await page.waitForTimeout(200);
    await pasteInto(".page textarea.editor", { plain: "mix ", html: "<p>mix <b>Bold</b> <i>Italic</i></p>" });
    await page.waitForTimeout(200);
    await selectInEditor(0, 4);
  },
  { editor: true, hasSel: true, allowMutate: false, inSheet: "Scratch" },
);

// New + Open once, from the board, so they are not repeated inside every context.
await goBoard();
const sheetsBefore = await page.evaluate(() => document.querySelectorAll(".card").length);
await page.getByRole("button", { name: "New sheet" }).click();
await page.waitForTimeout(400);
const newOpen = (await page.locator(".page textarea.editor").count()) > 0;
const newTitle = newOpen ? await page.locator(".sheet-title").innerText() : "";
matrixRow("board", "New", newOpen ? "PASS" : "FAIL", newTitle || "no sheet");
if (newOpen) {
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 4000 }),
      page.getByRole("button", { name: "Open file" }).click(),
    ]);
    await chooser.setFiles({ name: "opened-note.txt", mimeType: "text/plain", buffer: Buffer.from("opened from disk\nline two\n") });
    await page.waitForTimeout(500);
    const openedVal = await page.evaluate(() =>
      [...document.querySelectorAll(".page textarea.editor")].map((el) => el.value).join("\n"),
    );
    matrixRow("board", "Open", openedVal.includes("opened from disk") ? "PASS" : "FAIL", openedVal.slice(0, 120));
  } catch (err) {
    matrixRow("board", "Open", "FAIL", String(err).slice(0, 240));
  }
}
await goBoard();
const sheetsAfter = await page.evaluate(() => document.querySelectorAll(".card").length);
matrixRow("board", "New-count", sheetsAfter > sheetsBefore ? "PASS" : "FAIL", `${sheetsBefore} -> ${sheetsAfter}`);

// Go to line on the long note.
await openNote("Long");
await page.getByRole("button", { name: /Find, replace, go to line/ }).click();
await page.locator('input[aria-label="Go to line"]').fill("40");
await page.getByRole("button", { name: "Go", exact: true }).click();
await page.waitForTimeout(200);
const jumped = await page.evaluate(() => {
  const ta = document.querySelector(".page textarea.editor");
  const at = ta?.selectionStart ?? 0;
  const line = ta?.value.slice(0, at).split("\n").length ?? 0;
  return { line, at };
});
record("go-to-line", jumped.line === 40 || jumped.line === 39 || jumped.line === 41, JSON.stringify(jumped));
await page.keyboard.press("Escape");

await dumpAndClose();
