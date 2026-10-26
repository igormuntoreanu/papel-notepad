#!/usr/bin/env node
/**
 * Prove the desktop code path in a real browser engine, with a fake shell.
 *
 * The shells themselves are hard to drive from CI (native dialogs, no headless
 * WebView2), but the part that can regress silently is the *app* side: folder
 * gating, the FSA adapter, autosave through the bridge. Those are plain browser
 * code, so this serves `dist-desktop/client` and injects a recording fake
 * `window.__PAPEL_DESKTOP__` before any app script runs.
 *
 * What it asserts, in order:
 *   1. the board asks for a folder, exactly as it does in Chrome;
 *   2. clicking "Choose folder…" goes through the bridge instead of
 *      `showDirectoryPicker` (which does not exist here);
 *   3. the empty folder receives the open sheets as `.papel` files;
 *   4. "New sheet" writes the new note through the bridge too.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { projectRoot } from "./with-app-env.mjs";

const ROOT = join(projectRoot(), "dist-desktop", "client");
const PORT = 8092;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  // wasm-bindgen streams this module; a wrong type fails instantiation.
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function serve() {
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
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

/** Injected before app code: a shell that records instead of writing files. */
const FAKE_BRIDGE = `
  window.__PAPEL_CALLS__ = [];
  const dir = { id: "fake-dir", name: "Notes" };
  const files = new Map();
  const call = (name, extra) => window.__PAPEL_CALLS__.push({ name, ...extra });
  window.__PAPEL_DESKTOP__ = {
    version: 1,
    async pickDirectory() { call("pickDirectory"); return dir; },
    async resolveDirectory(id) { return id === dir.id ? dir : null; },
    async readFile(dirId, name) { call("readFile", { fileName: name }); return files.get(name) ?? null; },
    async writeFile(dirId, name, bytes) { call("writeFile", { fileName: name, size: bytes.length }); files.set(name, bytes); },
    async removeFile(dirId, name) { call("removeFile", { fileName: name }); files.delete(name); },
    async listFiles() { call("listFiles"); return [...files.keys()]; },
    async saveFile(name) { call("saveFile", { fileName: name }); return true; },
    __files: () => Object.fromEntries([...files.keys()].map((k) => [k, files.get(k).length])),
  };
`;

function fail(message) {
  console.error(`[smoke] FAIL ${message}`);
  process.exit(1);
}

const server = await serve();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(FAKE_BRIDGE);

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  try {
    await page.waitForFunction(() => document.body.innerText.includes("Choose a folder for your sheets"), { timeout: 20000 });
  } catch (err) {
    // Printing the DOM and the page's own errors beats guessing why a selector
    // missed: the app boots through a dynamic import, so a throw there renders
    // nothing at all.
    const body = await page.innerText("body").catch(() => "<no body>");
    await page.screenshot({ path: "screenshots/desktop-smoke-fail.png", fullPage: true }).catch(() => {});
    console.error(`[smoke] body text:\n${body.slice(0, 800)}`);
    console.error(`[smoke] page errors: ${pageErrors.join(" | ") || "none"}`);
    throw err;
  }
  console.log("[smoke] board rendered and asked for a folder");

  await page.click("text=Choose folder…");
  // Link + empty-folder migration happen before the board is usable.
  await page.waitForFunction(() => document.body.innerText.includes("A blank sheet."), { timeout: 20000 });
  console.log("[smoke] folder linked through the bridge");

  const afterLink = await page.evaluate(() => window.__PAPEL_CALLS__.map((c) => c.name));
  const gateStillUp = await page.evaluate(() => document.body.innerText.includes("Choose folder�"));
  console.log(`[smoke] after link calls=${afterLink.join(",") || "none"} gateUp=${gateStillUp}`);
  if (!afterLink.includes("pickDirectory")) fail("pickDirectory was never called");
  if (afterLink.includes("showDirectoryPicker")) fail("took the browser path instead of the bridge");

  await page.getByRole("button", { name: /^new sheet$/i }).first().click();
  // Typing marks the sheet dirty; the folder writer only runs for dirty sheets.
  const editor = page.locator("textarea").first();
  await editor.waitFor({ state: "visible", timeout: 10000 });
  await editor.click();
  await page.keyboard.type("hello from the bridge");
  await page.waitForTimeout(1500); // autosave debounce is 400 ms

  const result = await page.evaluate(() => ({
    calls: window.__PAPEL_CALLS__,
    files: window.__PAPEL_DESKTOP__.__files(),
  }));
  const writes = result.calls.filter((c) => c.name === "writeFile");
  if (writes.length === 0) fail(`nothing was written to the sync folder; calls=${result.calls.map((c) => c.name).join(",") || "none"}`);
  if (!Object.keys(result.files).some((name) => name.endsWith(".papel"))) {
    fail(`expected a .papel file, saw ${JSON.stringify(result.files)}`);
  }
  if (pageErrors.length) fail(`page errors: ${pageErrors.join(" | ")}`);

  console.log(`[smoke] wrote: ${JSON.stringify(result.files)}`);
  console.log(`[smoke] bridge calls: ${result.calls.map((c) => c.name).join(", ")}`);
  console.log("[smoke] PASS");
} finally {
  await browser.close();
  server.close();
}
