#!/usr/bin/env node
/**
 * Screenshot the built editor at a narrow width, to prove toolbar controls wrap
 * instead of being clipped or scrolled out of reach.
 *
 *   node scripts/narrow-shot.mjs [width] [height] [outfile]
 *
 * Serves the same `dist-desktop/client` the v1 shell embeds, seeds one note into
 * IndexedDB (the board is not populated from a folder), opens it, and captures the
 * editor. Nothing here runs the packaged exe, so it works on machines whose
 * application-control policy refuses freshly built binaries.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { projectRoot } from "./with-app-env.mjs";

const ROOT = join(projectRoot(), "dist-desktop", "client");
const WIDTH = Number(process.argv[2] ?? 620);
const HEIGHT = Number(process.argv[3] ?? 760);
const OUT = process.argv[4] ?? join(projectRoot(), "screenshots", `sheet-narrow-${WIDTH}.png`);
const PORT = 8096;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const path = join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, ""));
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const dir = { id: "shot-dir", name: "shot" };
    window.__PAPEL_DESKTOP__ = {
      version: 1,
      async pickDirectory() { return dir; },
      async resolveDirectory(id) { return id === dir.id ? dir : null; },
      async readFile() { return null; },
      async writeFile() { return true; },
      async removeFile() { return true; },
      async listFiles() { return []; },
      // The shell intercepts saves, so record what the app asked it to write.
      async saveFile(name, bytes) {
        window.__saved = { name, bytes: Array.from(bytes) };
        return true;
      },
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`, { waitUntil: "load" });
  const boxMode = process.argv.includes("--box");
  const listMode = process.argv.includes("--lists");
  const seedText = listMode
    ? "one\ntwo\nthree"
    : boxMode
    ? ["SELECT *", "    FROM /SCMTMS/D_TOREXE", "    INTO TABLE @DATA(lt_log)", "    FOR ALL ENTRIES IN @lt_track_logi", "    WHERE parent_key = @lt_track_logi-chavetecnicaordemfrete.", ""].join("\n")
    : "Toolbar wrap check.\n\nEvery button in the strip must stay visible and clickable at this width.\n";
  await page.evaluate(async (seed) => {
    const note = {
      id: "shot-1",
      title: "Narrow window",
      wrap: seed.wrap,
      edited: Date.now(),
      sourceExt: "papel",
      language: "auto",
      eol: "lf",
      encoding: "utf-8",
      blocks: [{ kind: "text", text: seed.text }],
    };
    const doc = { notes: [note], order: [note.id], activeId: null };
    const prefs = { skin: "ink", zoom: 100, autocorrect: true, sort: "manual", folderName: "shot" };
    const handle = { __papelDesktopDir: { id: "shot-dir", name: "shot" } };
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
        tx.objectStore("kv").put(doc, "doc");
        tx.objectStore("kv").put(prefs, "prefs");
        tx.objectStore("kv").put(handle, "folderHandle");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { text: seedText, wrap: !boxMode });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.getByText(/narrow window/i).first().click({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const overflow = await page.evaluate(() => {
    const strip = document.querySelector(".sheet-title-row");
    const tools = document.querySelector(".sheet-tools");
    if (!strip || !tools) return { found: false };
    const rect = tools.getBoundingClientRect();
    const buttons = [...tools.querySelectorAll("button")];
    const outside = buttons.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1);
    }).length;
    return {
      found: true,
      stripHeight: Math.round(strip.getBoundingClientRect().height),
      toolsHeight: Math.round(rect.height),
      buttons: buttons.length,
      outside,
      scrolls: tools.scrollWidth > tools.clientWidth + 1,
    };
  });

  // Optional end-to-end check for the paragraph style and font pickers, including
  // the reload, because "it looks right now" is not the same as "it was saved".
  const looksReport = await page.evaluate(() => null);
  if (process.argv.includes("--looks")) {
    const cell = ".page .block";
    const beforeStyle = await page.getAttribute(cell, "data-style");
    await page.getByRole("button", { name: /^Paragraph style/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole("menuitemradio", { name: /^Title/ }).click();
    await page.getByRole("button", { name: /^Font:/ }).click();
    await page.getByRole("menuitemradio", { name: /^Inter/ }).click();
    // Alignment is part of the same block look; it applies while wrap is off.
    const wrapBtn = page.getByRole("button", { name: /^Word wrap$/ });
    if ((await wrapBtn.getAttribute("aria-pressed")) === "true") await wrapBtn.click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Align right" }).click();
    await page.waitForTimeout(400);
    const applied = {
      style: await page.getAttribute(cell, "data-style"),
      font: await page.getAttribute(cell, "data-font"),
      align: await page.getAttribute(cell, "data-align"),
      computed: await page.evaluate(() => {
        const area = document.querySelector(".page .block textarea");
        if (!area) return null;
        const cs = getComputedStyle(area);
        return { fontSize: cs.fontSize, fontFamily: cs.fontFamily };
      }),
    };
    // The autosave effect is debounced; give it time before reloading.
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: "load" });
    await page.getByText(/narrow window/i).first().click({ timeout: 20000 });
    await page.waitForTimeout(800);
    const after = {
      style: await page.getAttribute(cell, "data-style"),
      font: await page.getAttribute(cell, "data-font"),
      align: await page.getAttribute(cell, "data-align"),
    };
    console.log(
      `[looks] default=${beforeStyle ?? "body"} applied=${applied.style}/${applied.font}/${applied.align} ` +
        `computed=${applied.computed?.fontSize}/${applied.computed?.fontFamily} ` +
        `afterReload=${after.style}/${after.font}/${after.align}`,
    );
    // Save the sheet and read the bytes the bridge was handed: the look must be in the
    // file, not only in browser storage, or opening the .papel elsewhere would lose it.
    await page.getByRole("button", { name: /^Save \(\.papel\)/ }).click();
    await page.waitForTimeout(600);
    const payload = await page.evaluate(() => {
      const saved = window.__saved;
      if (!saved) return null;
      return JSON.parse(new TextDecoder().decode(new Uint8Array(saved.bytes)));
    });
    const textBlock = payload?.blocks?.find((b) => b.type === "text");
    console.log(`[looks] .papel block: ${JSON.stringify({ font: textBlock?.font, style: textBlock?.style, align: textBlock?.align })}`);
    const fileOk = textBlock?.font === "inter" && textBlock?.style === "title" && textBlock?.align === "right";

    const ok = fileOk &&
      applied.style === "title" &&
      applied.font === "inter" &&
      applied.align === "right" &&
      after.style === "title" &&
      after.font === "inter" &&
      applied.computed?.fontSize === "32px";
    if (!ok) {
      console.error("[looks] FAIL: the look did not apply, take effect, or survive a reload");
      process.exitCode = 1;
    }
  }
  // Optional check for the table fix: insert a table through the toolbar and prove a
  // text block still exists below it and accepts typing. The core test covers the
  // document model; this covers the editor the user actually clicks in.
  if (process.argv.includes("--table")) {
    await page.getByRole("button", { name: /^Insert table$/ }).click();
    await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
    await page.waitForTimeout(600);

    const structure = await page.evaluate(() => {
      const page = document.querySelector(".page");
      if (!page) return null;
      const kids = [...page.children].map((el) =>
        el.classList.contains("table-block") ? "table" : el.classList.contains("block") ? "text" : "other",
      );
      const tableAt = kids.indexOf("table");
      return { kids, tableAt, after: kids[tableAt + 1] ?? null };
    });

    // Type into the block after the table, exactly as a user would.
    const tail = page.locator(".page > .block:not(.table-block) textarea").last();
    await tail.click();
    await page.keyboard.type("written below the table");
    await page.waitForTimeout(500);
    const tailText = await tail.inputValue();

    console.log(
      `[table] structure=${JSON.stringify(structure)} typed=${JSON.stringify(tailText.slice(-24))}`,
    );
    const ok =
      structure?.after === "text" &&
      structure.tableAt >= 0 &&
      tailText.includes("written below the table");
    if (!ok) {
      console.error("[table] FAIL: no editable block below the table, or typing did not land");
      process.exitCode = 1;
    }
  }
  // Optional check for deleting a table: from the toolbar and from the right-click menu,
  // with Ctrl+Z restoring it.
  if (process.argv.includes("--delete-table")) {
    const tables = () => page.evaluate(() => document.querySelectorAll(".page .table-block").length);
    await page.getByRole("button", { name: /^Insert table$/ }).click();
    await page.getByRole("button", { name: "Insert a 2 by 2 table" }).click();
    await page.waitForTimeout(500);
    const inserted = await tables();
    await page.locator(".page .sheet-table td textarea").first().click();
    await page.waitForTimeout(200);
    const button = page.getByRole("button", { name: /^Delete table$/ });
    const buttonVisible = await button.isVisible();
    await button.click();
    await page.waitForTimeout(500);
    const afterToolbar = await tables();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);
    const afterUndo = await tables();

    // Right-click the cell: the menu offers the same removal.
    await page.locator(".page .sheet-table td textarea").first().click({ button: "right" });
    await page.waitForTimeout(300);
    const deleteItem = page.locator(".cell-menu button", { hasText: "Delete table" });
    const menuHasDelete = await deleteItem.isVisible().catch(() => false);
    await deleteItem.click();
    await page.waitForTimeout(500);
    const afterMenu = await tables();

    console.log(
      `[delete-table] inserted=${inserted} toolbarBtn=${buttonVisible} afterToolbar=${afterToolbar} ` +
        `afterUndo=${afterUndo} contextMenu=${menuHasDelete} afterMenu=${afterMenu}`,
    );
    const ok = inserted === 1 && buttonVisible && afterToolbar === 0 && afterUndo === 1 && menuHasDelete && afterMenu === 0;
    if (!ok) {
      console.error("[delete-table] FAIL");
      process.exitCode = 1;
    }
  }
  // Optional check for zoom: the two toolbar buttons, Ctrl+wheel over the page, and
  // the 10..40 px clamp that the readout turns into 63%..250%.
  if (process.argv.includes("--zoom")) {
    const percent = () =>
      page.evaluate(() => {
        const span = [...document.querySelectorAll(".strip-status span")].find((s) => /^\d+%$/.test(s.textContent ?? ""));
        return span ? Number.parseInt(span.textContent, 10) : null;
      });
    const start = await percent();
    await page.getByRole("button", { name: /^Zoom in$/ }).click();
    await page.waitForTimeout(250);
    const afterButton = await percent();

    const box = await page.locator(".page").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await page.waitForTimeout(250);
    const afterWheel = await percent();

    // Push past the top: it must stop at 40 px (250%).
    for (let i = 0; i < 30; i += 1) await page.getByRole("button", { name: /^Zoom in$/ }).click();
    await page.waitForTimeout(250);
    const top = await percent();
    for (let i = 0; i < 40; i += 1) await page.getByRole("button", { name: /^Zoom out$/ }).click();
    await page.waitForTimeout(250);
    const bottom = await percent();

    console.log(`[zoom] start=${start} button=${afterButton} wheel=${afterWheel} top=${top} bottom=${bottom}`);
    const ok = afterButton > start && afterWheel > afterButton && top === 250 && bottom === 63;
    if (!ok) {
      console.error("[zoom] FAIL");
      process.exitCode = 1;
    }
    await page.getByRole("button", { name: /^Zoom in$/ }).click();
    await page.waitForTimeout(200);
  }
  // Optional check for Word Wrap: grid paste becomes a table, alignment applies when
  // wrap is off, and a long line scrolls sideways instead of being clipped.
  if (process.argv.includes("--wrap")) {
    await page.evaluate(() => {
      const ta = document.querySelector(".page .block textarea");
      ta.focus();
      const data = new DataTransfer();
      data.setData("text/plain", "name\tqty\tprice\nApple\t3\t1.20\nPear\t5\t0.90");
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(700);
    const pasted = await page.evaluate(() => {
      const table = document.querySelector(".page .table-block");
      if (!table) return null;
      const cells = [...table.querySelectorAll("td textarea")].map((ta) => ta.value);
      return { cells, columns: table.querySelectorAll("tbody tr:first-child td").length };
    });

    // Turn Word Wrap off: the alignment buttons appear.
    const wrapButton = page.getByRole("button", { name: /^Word wrap$/ });
    const wrapWasOn = await wrapButton.getAttribute("aria-pressed");
    if (wrapWasOn === "true") await wrapButton.click();
    await page.waitForTimeout(300);
    const alignVisible = await page.getByRole("button", { name: "Align centre" }).isVisible();

    const area = page.locator(".page .block textarea").first();
    await area.click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Align centre" }).click();
    await page.waitForTimeout(300);
    const alignment = await page.evaluate(() => {
      const block = document.querySelector(".page .block:not(.table-block)");
      const ta = block?.querySelector("textarea");
      return { attr: block?.getAttribute("data-align"), textAlign: ta ? getComputedStyle(ta).textAlign : null,
        overflowX: block ? getComputedStyle(block).overflowX : null };
    });

    console.log(
      `[wrap] pasted=${JSON.stringify(pasted)} alignBtn=${alignVisible} ` +
        `align=${alignment.attr}/${alignment.textAlign} overflowX=${alignment.overflowX}`,
    );
    const ok =
      pasted?.columns === 3 &&
      pasted.cells.join("|") === "name|qty|price|Apple|3|1.20|Pear|5|0.90" &&
      alignVisible &&
      alignment.attr === "center" &&
      alignment.textAlign === "center" &&
      alignment.overflowX === "auto";
    if (!ok) {
      console.error("[wrap] FAIL");
      process.exitCode = 1;
    }
  }
  // Optional check for the paragraph-style menu: each row previews at its own size.
  if (process.argv.includes("--style-menu")) {
    await page.getByRole("button", { name: /^Paragraph style/ }).click();
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".popover [role=menuitemradio]")].map((el) => ({
        text: el.firstChild?.textContent?.trim() ?? "",
        size: Number.parseFloat(getComputedStyle(el).fontSize),
      })),
    );
    // Optional check for Alt+drag column selection: paint the rectangle, copy it, delete it.
  if (process.argv.includes("--box")) {
    const info = await page.evaluate(() => {
      const ta = document.querySelector(".page .block textarea");
      if (!ta) return null;
      const cs = getComputedStyle(ta);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const charWidth = ctx.measureText("0000000000").width / 10;
      const lineHeight = Number.parseFloat(cs.lineHeight);
      const box = ta.getBoundingClientRect();
      return { charWidth, lineHeight, left: box.left, top: box.top, lines: ta.value.split("\n") };
    });
    if (!info) throw new Error("no editor");
    const at = (line, col) => ({
      x: info.left + (col + 0.5) * info.charWidth,
      y: info.top + (line + 0.5) * info.lineHeight,
    });
    const [l0, c0, l1, c1] = [1, 10, 4, 20];
    const start = at(l0, c0);
    const end = at(l1, c1);
    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(300);

    const painted = await page.evaluate(() => {
      const rect = document.querySelector(".page .block-rect");
      if (!rect) return null;
      const box = rect.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });

    const expected = info.lines
      .slice(l0, l1 + 1)
      .map((line) => line.slice(c0, c1))
      .join("\n");
    // Headless has no clipboard permission; record what the app puts on the event.
    await page.evaluate(() => {
      document.addEventListener("copy", (event) => {
        window.__copied = event.clipboardData?.getData("text/plain") ?? null;
      });
    });
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => window.__copied ?? null);

    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    const afterDelete = await page.evaluate(() => document.querySelector(".page .block textarea")?.value);
    const expectedAfter = info.lines
      .map((line, i) => (i >= l0 && i <= l1 ? line.slice(0, c0) + line.slice(c1) : line))
      .join("\n");

    console.log(
      `[box] painted=${JSON.stringify(painted)} expectedWidth=${Math.round((c1 - c0) * info.charWidth)} ` +
        `copied=${JSON.stringify(copied)} deleted=${afterDelete === expectedAfter}`,
    );
    const ok =
      painted !== null &&
      Math.abs(painted.width - (c1 - c0) * info.charWidth) <= 2 &&
      copied === expected &&
      afterDelete === expectedAfter;
    if (!ok) {
      console.error("[box] FAIL");
      process.exitCode = 1;
    }
  }
  // Optional check for lists: apply numbering, split an item with Enter, nest with Tab.
  if (process.argv.includes("--lists")) {
    await page.locator(".page .block textarea").first().click();
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^Lists$/ }).click();
    await page.locator(".popover button", { hasText: "Numbered 1." }).click();
    await page.waitForTimeout(500);
    const numbered = await page.locator(".page .block textarea").first().inputValue();

    // Enter at the end of the first line splits the list and renumbers the rest.
    const area = page.locator(".page .block textarea").first();
    await area.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("inserted");
    await page.waitForTimeout(500);
    const split = await area.inputValue();

    // Tab nests the item that now holds the caret.
    await page.keyboard.press("Tab");
    await page.waitForTimeout(500);
    const nested = await area.inputValue();
    // Optional regression check for text marks: select with the mouse, then bold, highlight
  // and ink each land as a span on the overlay. This is the path a user reported broken.
  if (process.argv.includes("--marks")) {
    const area = page.locator(".page .block textarea").first();
    const box = await area.boundingBox();
    // The textarea can be taller than its text; drag along the first text line.
    const lineY = box.y + 12;
    await page.mouse.move(box.x + 6, lineY);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, lineY, { steps: 8 });
    await page.mouse.up();
    const state = await page.evaluate(() => ({
      start: document.querySelector(".page .block textarea")?.selectionStart,
      end: document.querySelector(".page .block textarea")?.selectionEnd,
      active: document.activeElement?.tagName,
      boldDisabled: document.querySelector("button[aria-label^=\"Bold\"]")?.disabled,
    }));
    console.log(`[marks] state=${JSON.stringify(state)}`);
    await page.getByRole("button", { name: /^Bold/ }).click();
    await page.getByRole("button", { name: /Yellow highlighter/ }).click();
    await page.waitForTimeout(400);
    const painted = await page.evaluate(() => {
      const pre = document.querySelector(".page .block pre");
      const span = pre?.querySelector("span");
      return {
        html: pre?.innerHTML?.slice(0, 120) ?? null,
        classes: span?.className ?? null,
        background: span ? getComputedStyle(span).backgroundColor : null,
      };
    });
    console.log(`[marks] ${JSON.stringify(painted)}`);
    const ok = Boolean(painted.classes?.includes("sb")) && Boolean(painted.classes?.includes("hl1"));
    if (!ok) {
      console.error("[marks] FAIL: bold or highlight did not paint after a mouse selection");
      process.exitCode = 1;
    }
  }
  await page.screenshot({ path: OUT });

    console.log(`[lists] numbered=${JSON.stringify(numbered)}\n[lists] split=${JSON.stringify(split)}\n[lists] nested=${JSON.stringify(nested)}`);
    const ok =
      numbered === "1. one\n2. two\n3. three" &&
      split === "1. one\n2. inserted\n3. two\n4. three" &&
      nested === "1. one\n  1.1. inserted\n2. two\n3. three";
    if (!ok) {
      console.error("[lists] FAIL");
      process.exitCode = 1;
    }
  }
  // Optional regression check for text marks: select with the mouse, then bold, highlight
  // and ink each land as a span on the overlay. This is the path a user reported broken.
  if (process.argv.includes("--marks")) {
    const area = page.locator(".page .block textarea").first();
    const box = await area.boundingBox();
    // The textarea can be taller than its text; drag along the first text line.
    const lineY = box.y + 12;
    await page.mouse.move(box.x + 6, lineY);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, lineY, { steps: 8 });
    await page.mouse.up();
    const state = await page.evaluate(() => ({
      start: document.querySelector(".page .block textarea")?.selectionStart,
      end: document.querySelector(".page .block textarea")?.selectionEnd,
      active: document.activeElement?.tagName,
      boldDisabled: document.querySelector("button[aria-label^=\"Bold\"]")?.disabled,
    }));
    console.log(`[marks] state=${JSON.stringify(state)}`);
    await page.getByRole("button", { name: /^Bold/ }).click();
    await page.getByRole("button", { name: /Yellow highlighter/ }).click();
    await page.waitForTimeout(400);
    const painted = await page.evaluate(() => {
      const pre = document.querySelector(".page .block pre");
      const span = pre?.querySelector("span");
      return {
        html: pre?.innerHTML?.slice(0, 120) ?? null,
        classes: span?.className ?? null,
        background: span ? getComputedStyle(span).backgroundColor : null,
      };
    });
    console.log(`[marks] ${JSON.stringify(painted)}`);
    const ok = Boolean(painted.classes?.includes("sb")) && Boolean(painted.classes?.includes("hl1"));
    if (!ok) {
      console.error("[marks] FAIL: bold or highlight did not paint after a mouse selection");
      process.exitCode = 1;
    }
  }
  await page.screenshot({ path: OUT });
    console.log(`[style-menu] ${JSON.stringify(rows)}`);
    const descending = rows.every((row, i) => i === 0 || row.size <= rows[i - 1].size);
    const ok = rows.length === 7 && descending && rows[0].size > rows[6].size + 4;
    if (!ok) {
      console.error("[style-menu] FAIL: previews do not follow the style sizes");
      process.exitCode = 1;
    }
    await page.keyboard.press("Escape");
  }
  // Optional check for Alt+drag column selection: paint the rectangle, copy it, delete it.
  if (process.argv.includes("--box")) {
    const info = await page.evaluate(() => {
      const ta = document.querySelector(".page .block textarea");
      if (!ta) return null;
      const cs = getComputedStyle(ta);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const charWidth = ctx.measureText("0000000000").width / 10;
      const lineHeight = Number.parseFloat(cs.lineHeight);
      const box = ta.getBoundingClientRect();
      return { charWidth, lineHeight, left: box.left, top: box.top, lines: ta.value.split("\n") };
    });
    if (!info) throw new Error("no editor");
    const at = (line, col) => ({
      x: info.left + (col + 0.5) * info.charWidth,
      y: info.top + (line + 0.5) * info.lineHeight,
    });
    const [l0, c0, l1, c1] = [1, 10, 4, 20];
    const start = at(l0, c0);
    const end = at(l1, c1);
    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(300);

    const painted = await page.evaluate(() => {
      const rect = document.querySelector(".page .block-rect");
      if (!rect) return null;
      const box = rect.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });

    const expected = info.lines
      .slice(l0, l1 + 1)
      .map((line) => line.slice(c0, c1))
      .join("\n");
    // Headless has no clipboard permission; record what the app puts on the event.
    await page.evaluate(() => {
      document.addEventListener("copy", (event) => {
        window.__copied = event.clipboardData?.getData("text/plain") ?? null;
      });
    });
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => window.__copied ?? null);

    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    const afterDelete = await page.evaluate(() => document.querySelector(".page .block textarea")?.value);
    const expectedAfter = info.lines
      .map((line, i) => (i >= l0 && i <= l1 ? line.slice(0, c0) + line.slice(c1) : line))
      .join("\n");

    console.log(
      `[box] painted=${JSON.stringify(painted)} expectedWidth=${Math.round((c1 - c0) * info.charWidth)} ` +
        `copied=${JSON.stringify(copied)} deleted=${afterDelete === expectedAfter}`,
    );
    const ok =
      painted !== null &&
      Math.abs(painted.width - (c1 - c0) * info.charWidth) <= 2 &&
      copied === expected &&
      afterDelete === expectedAfter;
    if (!ok) {
      console.error("[box] FAIL");
      process.exitCode = 1;
    }
  }
  // Optional check for lists: apply numbering, split an item with Enter, nest with Tab.
  if (process.argv.includes("--lists")) {
    await page.locator(".page .block textarea").first().click();
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^Lists$/ }).click();
    await page.locator(".popover button", { hasText: "Numbered 1." }).click();
    await page.waitForTimeout(500);
    const numbered = await page.locator(".page .block textarea").first().inputValue();

    // Enter at the end of the first line splits the list and renumbers the rest.
    const area = page.locator(".page .block textarea").first();
    await area.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("inserted");
    await page.waitForTimeout(500);
    const split = await area.inputValue();

    // Tab nests the item that now holds the caret.
    await page.keyboard.press("Tab");
    await page.waitForTimeout(500);
    const nested = await area.inputValue();
    // Optional regression check for text marks: select with the mouse, then bold, highlight
  // and ink each land as a span on the overlay. This is the path a user reported broken.
  if (process.argv.includes("--marks")) {
    const area = page.locator(".page .block textarea").first();
    const box = await area.boundingBox();
    // The textarea can be taller than its text; drag along the first text line.
    const lineY = box.y + 12;
    await page.mouse.move(box.x + 6, lineY);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, lineY, { steps: 8 });
    await page.mouse.up();
    const state = await page.evaluate(() => ({
      start: document.querySelector(".page .block textarea")?.selectionStart,
      end: document.querySelector(".page .block textarea")?.selectionEnd,
      active: document.activeElement?.tagName,
      boldDisabled: document.querySelector("button[aria-label^=\"Bold\"]")?.disabled,
    }));
    console.log(`[marks] state=${JSON.stringify(state)}`);
    await page.getByRole("button", { name: /^Bold/ }).click();
    await page.getByRole("button", { name: /Yellow highlighter/ }).click();
    await page.waitForTimeout(400);
    const painted = await page.evaluate(() => {
      const pre = document.querySelector(".page .block pre");
      const span = pre?.querySelector("span");
      return {
        html: pre?.innerHTML?.slice(0, 120) ?? null,
        classes: span?.className ?? null,
        background: span ? getComputedStyle(span).backgroundColor : null,
      };
    });
    console.log(`[marks] ${JSON.stringify(painted)}`);
    const ok = Boolean(painted.classes?.includes("sb")) && Boolean(painted.classes?.includes("hl1"));
    if (!ok) {
      console.error("[marks] FAIL: bold or highlight did not paint after a mouse selection");
      process.exitCode = 1;
    }
  }
  await page.screenshot({ path: OUT });

    console.log(`[lists] numbered=${JSON.stringify(numbered)}\n[lists] split=${JSON.stringify(split)}\n[lists] nested=${JSON.stringify(nested)}`);
    const ok =
      numbered === "1. one\n2. two\n3. three" &&
      split === "1. one\n2. inserted\n3. two\n4. three" &&
      nested === "1. one\n  1.1. inserted\n2. two\n3. three";
    if (!ok) {
      console.error("[lists] FAIL");
      process.exitCode = 1;
    }
  }
  // Optional regression check for text marks: select with the mouse, then bold, highlight
  // and ink each land as a span on the overlay. This is the path a user reported broken.
  if (process.argv.includes("--marks")) {
    const area = page.locator(".page .block textarea").first();
    const box = await area.boundingBox();
    // The textarea can be taller than its text; drag along the first text line.
    const lineY = box.y + 12;
    await page.mouse.move(box.x + 6, lineY);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, lineY, { steps: 8 });
    await page.mouse.up();
    const state = await page.evaluate(() => ({
      start: document.querySelector(".page .block textarea")?.selectionStart,
      end: document.querySelector(".page .block textarea")?.selectionEnd,
      active: document.activeElement?.tagName,
      boldDisabled: document.querySelector("button[aria-label^=\"Bold\"]")?.disabled,
    }));
    console.log(`[marks] state=${JSON.stringify(state)}`);
    await page.getByRole("button", { name: /^Bold/ }).click();
    await page.getByRole("button", { name: /Yellow highlighter/ }).click();
    await page.waitForTimeout(400);
    const painted = await page.evaluate(() => {
      const pre = document.querySelector(".page .block pre");
      const span = pre?.querySelector("span");
      return {
        html: pre?.innerHTML?.slice(0, 120) ?? null,
        classes: span?.className ?? null,
        background: span ? getComputedStyle(span).backgroundColor : null,
      };
    });
    console.log(`[marks] ${JSON.stringify(painted)}`);
    const ok = Boolean(painted.classes?.includes("sb")) && Boolean(painted.classes?.includes("hl1"));
    if (!ok) {
      console.error("[marks] FAIL: bold or highlight did not paint after a mouse selection");
      process.exitCode = 1;
    }
  }
  await page.screenshot({ path: OUT });
  console.log(`[narrow] ${WIDTH}x${HEIGHT} -> ${OUT}`);
  console.log(`[narrow] toolbar: ${JSON.stringify(overflow)}`);
  if (overflow.found && (overflow.outside > 0 || overflow.scrolls)) {
    console.error("[narrow] FAIL: controls are still clipped or scrolling");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.close();
}
