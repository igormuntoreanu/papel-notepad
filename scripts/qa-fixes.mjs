/**
 * Verification of the two implemented fixes — v0.3.8.
 *   FIX-2  Word Wrap defaults pressed; Align left/centre/right disabled when wrap is off.
 *   FIX-3  Adding a bullet keeps the caret on the SAME line (end of it), ready to type.
 *
 *   npm run build:desktop && node scripts/qa-fixes.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const VERSION = "0.3.8";
const OUT = join(process.cwd(), "AI_Documentation", "qa", VERSION, "fixes");
const PORT = 8098;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };
if (!existsSync(join(ROOT, "index.html"))) { console.error("[qa-fixes] run npm run build:desktop first"); process.exit(2); }
await mkdir(OUT, { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try { const body = await readFile(join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, ""))); res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404).end("no"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${JSON.stringify(detail)}`); }

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(String(e)));
let shotN = 0;
async function snap(n) { shotN += 1; const f = `${String(shotN).padStart(2, "0")}-${n.replace(/[^a-z0-9-]+/gi, "-").slice(0, 50)}.png`; try { await page.screenshot({ path: join(OUT, f), timeout: 8000 }); return f; } catch { return null; } }

await page.addInitScript(() => {
  const dir = { id: "d", name: "d" }; const files = new Map(); let maximized = false; window.__papelWin = [];
  window.__PAPEL_DESKTOP__ = { version: 2, async appVersion() { return "0.3.8"; }, async minimize() { window.__papelWin.push("minimize"); }, async toggleMaximize() { maximized = !maximized; window.__papelWin.push(maximized ? "maximize" : "restore"); }, async isMaximized() { return maximized; }, async close() { window.__papelWin.push("close"); }, async pickDirectory() { return dir; }, async resolveDirectory() { return dir; }, async readFile(_i, n) { return files.get(n) ?? null; }, async writeFile(_i, n, b) { files.set(n, b); }, async removeFile(_i, n) { files.delete(n); }, async listFiles() { return [...files.keys()]; }, async saveFile(n) { window.__papelWin.push(`save:${n}`); return true; } };
});
await page.goto(`http://127.0.0.1:${PORT}/favicon.svg`);
await page.evaluate(async () => {
  const note = (id, title, text, wrap = true) => ({ id, title, wrap, edited: Date.now(), sourceExt: "papel", language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text }] });
  const doc = { notes: [note("short", "Short", "The quick brown fox jumps over the lazy dog."), note("scratch", "Scratch", "")], order: ["short", "scratch"], activeId: null };
  const prefs = { skin: "ink", zoom: 16, autocorrect: true, sort: "manual" };
  const handle = { __papelDesktopDir: { id: "d", name: "d" } };
  await new Promise((res, rej) => { const rq = indexedDB.open("papel", 1); rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction("kv", "readwrite"); const s = tx.objectStore("kv"); s.put(doc, "doc"); s.put(prefs, "prefs"); s.put(handle, "folderHandle"); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; });
});
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);

const EDITOR = ".page textarea.editor";
async function goBoard() { if ((await page.locator(".page").count()) > 0) { const b = page.getByRole("button", { name: "Back to board" }); if (await b.count()) await b.click(); await page.waitForTimeout(250); } }
async function openNote(t) { await goBoard(); await page.getByRole("button", { name: t, exact: true }).first().click(); await page.locator(EDITOR).first().waitFor({ timeout: 8000 }); await page.waitForTimeout(200); }
async function clearSheet() { await page.locator(EDITOR).first().click(); await page.keyboard.press("Control+a"); await page.waitForTimeout(80); await page.keyboard.press("Delete"); await page.waitForTimeout(200); }

const wrapBtn = () => page.getByRole("button", { name: /^Word wrap$/ }).first();
const alignBtn = (name) => page.getByRole("button", { name, exact: true }).first();
async function alignState() {
  return page.evaluate(() => {
    const get = (re) => { const b = [...document.querySelectorAll("button")].find((x) => re.test(x.getAttribute("aria-label") || x.title || "")); return b ? { present: true, disabled: b.hasAttribute("disabled"), pressed: b.getAttribute("aria-pressed") } : { present: false }; };
    return { left: get(/^Align left/), centre: get(/^Align centre/), right: get(/^Align right/), wrap: get(/^Word wrap/) };
  });
}

// ===================== FIX-2: wrap default pressed + align gated on wrap =====================
await openNote("Short");
const initial = await alignState();
const dataWrapOn = await page.evaluate(() => document.querySelector(".page")?.getAttribute("data-wrap"));
// Wrap default pressed?
check("FIX2-wrap-default-pressed", initial.wrap.pressed === "true" && dataWrapOn === "on", { wrapPressed: initial.wrap.pressed, dataWrap: dataWrapOn });
// Align enabled while wrap on?
const alignEnabledWrapOn = initial.left.present && !initial.left.disabled && !initial.centre.disabled && !initial.right.disabled;
// Apply centre while wrap on -> should work.
await alignBtn("Align centre").click().catch(() => {});
await page.waitForTimeout(150);
const alignApplied = await page.evaluate(() => document.querySelector(".page .block")?.getAttribute("data-align"));
check("FIX2-align-works-when-wrap-on", alignEnabledWrapOn && alignApplied === "center", { alignEnabledWrapOn, alignApplied });
await snap("FIX2-wrap-on-align-enabled");

// Toggle wrap OFF.
await wrapBtn().click();
await page.waitForTimeout(200);
const offState = await alignState();
const dataWrapOff = await page.evaluate(() => document.querySelector(".page")?.getAttribute("data-wrap"));
const alignDisabledWrapOff = offState.left.disabled && offState.centre.disabled && offState.right.disabled;
check("FIX2-align-disabled-when-wrap-off", offState.wrap.pressed === "false" && dataWrapOff === "off" && alignDisabledWrapOff, { wrapPressed: offState.wrap.pressed, dataWrap: dataWrapOff, alignDisabledWrapOff, left: offState.left });
await snap("FIX2-wrap-off-align-disabled");

// Toggle wrap back ON -> align re-enabled.
await wrapBtn().click();
await page.waitForTimeout(200);
const backOn = await alignState();
check("FIX2-align-reenabled-when-wrap-back-on", !backOn.left.disabled && !backOn.centre.disabled && !backOn.right.disabled, { left: backOn.left });

// ===================== FIX-3: bullet keeps caret on the same line =====================
async function bulletCaretTest(seedLines, caretLine, label) {
  await openNote("Scratch");
  await clearSheet();
  await page.locator(EDITOR).first().click();
  // Type the seed lines.
  for (let i = 0; i < seedLines.length; i++) { if (i) await page.keyboard.press("Enter"); await page.keyboard.type(seedLines[i]); }
  // Put the caret on caretLine (0-based), at end of that line.
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < caretLine; i++) { await page.keyboard.press("ArrowDown"); }
  await page.keyboard.press("End");
  await page.waitForTimeout(80);
  const before = await page.evaluate(() => { const ta = document.querySelector(".page textarea.editor"); const lines = ta.value.split("\n"); const upto = ta.value.slice(0, ta.selectionStart).split("\n").length - 1; return { caretLine: upto, value: ta.value, lineCount: lines.length }; });
  // Open Lists menu -> Bullet.
  await page.getByRole("button", { name: /^Lists/ }).first().click();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /Bullet/ }).first().click();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const ta = document.querySelector(".page textarea.editor");
    const lines = ta.value.split("\n");
    const caretLine = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
    const col = ta.selectionStart - (ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1);
    return { caretLine, col, lineLen: (lines[caretLine] ?? "").length, lineText: lines[caretLine] ?? null, value: ta.value, selStart: ta.selectionStart };
  });
  await snap(label);
  const stayedOnLine = after.caretLine === before.caretLine;
  const atEndOfLine = after.col === after.lineLen;
  // Now type — it must land on the same line.
  await page.keyboard.type("X");
  await page.waitForTimeout(120);
  const typed = await page.evaluate(() => { const ta = document.querySelector(".page textarea.editor"); const lines = ta.value.split("\n"); const cl = ta.value.slice(0, ta.selectionStart).split("\n").length - 1; return { caretLine: cl, lineText: lines[cl] }; });
  const typedOnSameLine = typed.caretLine === before.caretLine && /X/.test(typed.lineText || "");
  check(`FIX3-bullet-caret-${label}`, stayedOnLine && atEndOfLine && typedOnSameLine, { before, after, typed, stayedOnLine, atEndOfLine, typedOnSameLine });
}

// Empty line in the middle: the core "add a bullet and start typing" flow.
await bulletCaretTest(["alpha", "", "gamma"], 1, "empty-middle-line");
// Line with text: caret should stay at end of that (now bulleted) line.
await bulletCaretTest(["alpha", "beta", "gamma"], 1, "text-middle-line");
// First line.
await bulletCaretTest(["first", "second"], 0, "first-line");
// Last line of a longer note.
await bulletCaretTest(["l1", "l2", "l3", "l4"], 3, "last-line");

const summary = { version: VERSION, suite: "qa-fixes", results, pageErrors, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length };
await writeFile(join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n[qa-fixes] ${summary.pass} pass / ${summary.fail} fail -> ${join(OUT, "results.json")}`);
await browser.close().catch(() => {}); server.close();
process.exitCode = summary.fail ? 1 : 0;
