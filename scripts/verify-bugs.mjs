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
  // Bridge contract is v2 (src/lib/desktop/bridge.ts). v1 is rejected, Chromium
  // still exposes showDirectoryPicker, and the folder gate then covers the board.
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
    async saveFile() {
      window.__papelWin.push("save");
      return true;
    },
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
// Place the caret at the end so Insert table follows the text (not a mid-split at 0).
await page.locator(".page .block textarea.editor").first().click();
await page.keyboard.press("Control+End");
await page.waitForTimeout(150);
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
  column: document.querySelectorAll(".page .block.is-column-select").length,
}));
check(
  "alt-drag-column",
  wrapBefore === "true" && altDrag.rects > 0 && altDrag.wrap === "on" && altDrag.column > 0,
  JSON.stringify({ wrapBefore, ...altDrag }),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const afterEsc = await page.evaluate(() => ({
  rects: document.querySelectorAll(".page .block-rect").length,
  wrap: document.querySelector(".page")?.getAttribute("data-wrap"),
  column: document.querySelectorAll(".page .block.is-column-select").length,
}));
check(
  "alt-drag-clears-without-wrap-off",
  afterEsc.rects === 0 && afterEsc.wrap === "on" && afterEsc.column === 0,
  JSON.stringify(afterEsc),
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
await page.waitForTimeout(200);

// ---- 6b) After focusing a table cell, text selection still enables Bold.
if (!(await page.evaluate(() => Boolean(document.querySelector(".page"))))) {
  await page.getByText(/verify bugs/i).first().click();
  await page.waitForTimeout(600);
}
if ((await page.locator(".page .sheet-table td textarea").count()) === 0) {
  await page.getByRole("button", { name: /^Insert table$/ }).click();
  await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
  await page.waitForTimeout(400);
}
await page.locator(".page .sheet-table td textarea").first().click();
await page.waitForTimeout(200);
const textArea = page.locator(".page .block textarea.editor").first();
await textArea.click();
await page.waitForTimeout(150);
const textBox = await textArea.boundingBox();
await page.mouse.move(textBox.x + 4, textBox.y + 12);
await page.mouse.down();
await page.mouse.move(textBox.x + 60, textBox.y + 12, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(250);
const boldBtn = page.getByRole("button", { name: /^Bold/ });
const boldEnabled = await boldBtn.isEnabled();
if (boldEnabled) await boldBtn.click({ force: true });
await page.waitForTimeout(250);
const afterTableStyle = await page.evaluate(() => ({
  bold: document.querySelector(".page .block:not(.table-block) pre span.sb")?.textContent ?? null,
  disabled: document.querySelector('button[aria-label^="Bold"]')?.hasAttribute("disabled") ?? null,
  sel: (() => {
    const a = document.querySelector(".page .block textarea.editor");
    return a ? { start: a.selectionStart, end: a.selectionEnd } : null;
  })(),
}));
check(
  "toolbar-after-table-cell",
  boldEnabled && afterTableStyle.bold !== null,
  JSON.stringify({ boldEnabled, ...afterTableStyle }),
);
if (afterTableStyle.bold) {
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
}

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

// ---- 8) Grid paste (TSV) becomes a real table block.
await page.locator(".page .block textarea").first().click();
await page.evaluate(async () => {
  const text = "name\tqty\nalpha\t1\nbeta\t2";
  const ta = document.querySelector(".page .block textarea");
  ta.focus();
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
  event.clipboardData.setData("text/plain", text);
  ta.dispatchEvent(event);
});
await page.waitForTimeout(500);
const gridPaste = await page.evaluate(() => ({
  tables: document.querySelectorAll(".page .table-block").length,
  cells: [...document.querySelectorAll(".page .sheet-table td textarea")].map((a) => a.value),
}));
check(
  "paste-tsv-table",
  gridPaste.tables >= 1 && gridPaste.cells.includes("alpha") && gridPaste.cells.includes("1"),
  JSON.stringify(gridPaste),
);

// ---- 9) HTML paste keeps bold emphasis as a painted mark.
await page.locator(".page .block textarea").first().click();
await page.keyboard.press("Control+End");
await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea");
  ta.focus();
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
  event.clipboardData.setData("text/html", "<p>xx <b>BoldWord</b> yy</p>");
  event.clipboardData.setData("text/plain", "xx BoldWord yy");
  ta.dispatchEvent(event);
});
await page.waitForTimeout(500);
const htmlPaste = await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea");
  const bold = document.querySelector(".page .block pre span.sb")?.textContent ?? null;
  return { value: ta?.value ?? "", bold, hasBoldWord: (ta?.value ?? "").includes("BoldWord") };
});
check(
  "paste-html-bold",
  htmlPaste.hasBoldWord && htmlPaste.bold === "BoldWord",
  JSON.stringify(htmlPaste),
);

// ---- 10) PageDown moves the caret down a long note.
await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea");
  const body = Array.from({ length: 120 }, (_, i) => `line-${i}`).join("\n");
  ta.focus();
  ta.select();
  // Replace via input path: set value and dispatch input so sync runs.
  const start = 0;
  const end = ta.value.length;
  document.execCommand("selectAll");
  // Direct session sync through React is hard; type is slow — assign + input event.
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  nativeSet?.call(ta, body);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: body }));
  ta.setSelectionRange(0, 0);
});
await page.waitForTimeout(400);
const beforePage = await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea");
  return { caret: ta.selectionStart, len: ta.value.length, lines: ta.value.split("\n").length };
});
await page.keyboard.press("PageDown");
await page.waitForTimeout(200);
const afterPage = await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea");
  return { caret: ta.selectionStart };
});
check(
  "page-down-moves",
  beforePage.lines >= 100 && afterPage.caret > beforePage.caret,
  JSON.stringify({ beforePage, afterPage }),
);

// ---- 11) Ctrl+Enter recognises a URL under the caret (open is stubbed).
await page.evaluate(() => {
  window.__papelOpened = [];
  const real = window.open;
  window.open = (url) => {
    window.__papelOpened.push(String(url));
    return null;
  };
  window.__papelOpenRestore = real;
  const ta = document.querySelector(".page .block textarea");
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const next = "open https://example.com/app now";
  nativeSet?.call(ta, next);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: next }));
  const at = next.indexOf("https");
  ta.setSelectionRange(at + 5, at + 5);
  ta.focus();
});
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const opened = await page.evaluate(() => {
  const urls = window.__papelOpened ?? [];
  if (typeof window.__papelOpenRestore === "function") window.open = window.__papelOpenRestore;
  return urls;
});
check("ctrl-enter-opens-url", opened.includes("https://example.com/app"), JSON.stringify(opened));

// ---- 12) Insert table at caret splits mid-text (not always at the end).
await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea.editor");
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const body = "AAA_MID_BBB";
  nativeSet?.call(ta, body);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: body }));
  ta.focus();
  ta.setSelectionRange(3, 3); // caret after AAA
});
await page.waitForTimeout(300);
await page.getByRole("button", { name: /^Insert table$/ }).click();
await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
await page.waitForTimeout(500);
const midTable = await page.evaluate(() => {
  const editors = [...document.querySelectorAll(".page .block textarea.editor")].map((a) => a.value);
  const tables = document.querySelectorAll(".page .table-block").length;
  const order = [...document.querySelectorAll(".page .block")].map((b) =>
    b.classList.contains("table-block") ? "table" : "text",
  );
  return { editors, tables, order };
});
check(
  "table-insert-at-caret",
  midTable.editors.some((t) => t === "AAA") &&
    midTable.editors.some((t) => t.includes("MID_BBB")) &&
    midTable.order.join(",").includes("text,table,text"),
  JSON.stringify(midTable),
);

// ---- 13) Ctrl+Shift+V must keep Excel's bitmap from becoming the paste.
// Excel puts TSV, HTML, and a picture on the clipboard together. Plain paste
// should insert the tab-separated text and neither a table nor an image.
const imagesBeforePlain = await page.evaluate(() => document.querySelectorAll(".page .picture").length);
const tablesBeforePlain = await page.evaluate(() => document.querySelectorAll(".page .table-block").length);
await page.locator(".page .block textarea.editor").first().click();
await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea.editor");
  ta.focus();
  ta.dispatchEvent(
    new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
  );
  const dt = new DataTransfer();
  dt.setData("text/plain", "Name\tQty\nalpha\t1");
  dt.setData("text/html", "<table><tr><td>Name</td><td>Qty</td></tr><tr><td>alpha</td><td>1</td></tr></table>");
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  dt.items.add(new File([png], "excel.png", { type: "image/png" }));
  ta.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
});
await page.waitForTimeout(400);
const plainPaste = await page.evaluate(() => ({
  images: document.querySelectorAll(".page .picture").length,
  tables: document.querySelectorAll(".page .table-block").length,
  text: [...document.querySelectorAll(".page .block textarea.editor")].map((el) => el.value).join("\n"),
}));
check(
  "ctrl-shift-v-skips-excel-bitmap",
  plainPaste.images === imagesBeforePlain &&
    plainPaste.tables === tablesBeforePlain &&
    plainPaste.text.includes("Name\tQty"),
  JSON.stringify({ imagesBeforePlain, tablesBeforePlain, ...plainPaste, text: plainPaste.text.slice(0, 180) }),
);

// ---- 14) Ctrl+A is a real selection: Bold must apply, not stay disabled.
await page.locator(".page .block textarea.editor").first().click();
await page.keyboard.press("Control+a");
await page.waitForTimeout(200);
const whole = await page.evaluate(() => ({
  hits: document.querySelectorAll(".page .find-hit").length,
  disabled: document.querySelector('button[aria-label^="Bold"]')?.hasAttribute("disabled") ?? null,
  label: document.querySelector('button[aria-label^="Bold"]')?.getAttribute("aria-label"),
}));
check(
  "ctrl-a-enables-bold",
  whole.hits > 0 && whole.disabled === false,
  JSON.stringify(whole),
);
await page.keyboard.press("Escape");

// ---- 15) Choosing a list style must leave the caret in the editor.
await page.locator(".page .block textarea.editor").first().click();
await page.getByRole("button", { name: "Lists" }).click();
await page.getByRole("button", { name: "Bullet •" }).click();
await page.waitForTimeout(200);
const listFocus = await page.evaluate(() => ({
  tag: document.activeElement?.tagName ?? null,
  className: document.activeElement?.className ?? "",
}));
check(
  "list-menu-keeps-editor-focus",
  listFocus.className.includes("editor"),
  JSON.stringify(listFocus),
);

// ---- 16) An inserted table must still be there after autosave and reload.
await page.locator(".page .block textarea.editor").first().click();
await page.keyboard.press("Control+End");
await page.evaluate(() => {
  const ta = document.querySelector(".page .block textarea.editor");
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  nativeSet?.call(ta, "RELOAD_ANCHOR");
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: "RELOAD_ANCHOR" }));
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
});
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^Insert table$/ }).click();
await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
await page.waitForTimeout(300);
await page.locator(".page .sheet-table td textarea").first().fill("persist-cell");
await page.waitForTimeout(1000);
await page.reload();
await page.waitForTimeout(900);
if (await page.locator(".modal-back").count()) {
  check("table-survives-reload", false, "folder gate after reload");
} else {
  await page.getByText(/verify bugs/i).first().click();
  await page.waitForTimeout(700);
  const survived = await page.evaluate(() => ({
    tables: document.querySelectorAll(".page .table-block").length,
    cells: [...document.querySelectorAll(".page .sheet-table td textarea")].map((el) => el.value),
  }));
  check(
    "table-survives-reload",
    survived.tables >= 1 && survived.cells.includes("persist-cell"),
    JSON.stringify(survived),
  );
}

const failed = Object.entries(results).filter(([, value]) => !value.ok).map(([name]) => name);
console.log(failed.length ? `FAILED: ${failed.join(", ")}` : "ALL PASS");
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
