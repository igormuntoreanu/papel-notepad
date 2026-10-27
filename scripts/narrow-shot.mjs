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
      async saveFile() { return true; },
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`, { waitUntil: "load" });
  await page.evaluate(async () => {
    const text =
      "Toolbar wrap check.\n\nEvery button in the strip must stay visible and clickable at this width.\n";
    const note = {
      id: "shot-1",
      title: "Narrow window",
      wrap: true,
      edited: Date.now(),
      sourceExt: "txt",
      language: "auto",
      eol: "lf",
      encoding: "utf-8",
      blocks: [{ kind: "text", text }],
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
  });

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
