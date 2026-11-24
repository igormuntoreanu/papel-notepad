/**
 * Snap layouts on the frameless maximize button.
 *   SN1 right-click opens the flyout
 *   SN2 a zone calls bridge.snap with that fraction
 *   SN3 Escape closes the flyout without snapping
 *   SN4 a bridge without snap keeps a plain maximize button
 *
 *   npm run build:desktop && node scripts/qa-snap.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "0.6.1");
const PORT = 8106;
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
  console.error("[qa-snap] run npm run build:desktop first");
  process.exit(2);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const body = await readFile(
      join(ROOT, normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "")),
    );
    res.writeHead(200, { "content-type": MIME[extname(requested)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("no");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await mkdir(OUT, { recursive: true });

function bridgeScript(withSnap) {
    const dir = { id: "d", name: "d" };
    const files = new Map();
    let maximized = false;
    window.__papelSnaps = [];
    window.__PAPEL_DESKTOP__ = {
      version: 2,
      async appVersion() {
        return "0.6.1";
      },
      async minimize() {},
      async toggleMaximize() {
        maximized = !maximized;
      },
      async isMaximized() {
        return maximized;
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
    if (withSnap) {
      window.__PAPEL_DESKTOP__.snap = async (zone) => {
        window.__papelSnaps.push(zone);
        maximized = false;
      };
    }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${JSON.stringify(detail)}`);
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });

async function boot(withSnap) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  // The argument must be passed in: addInitScript serializes the function and
  // a closed-over Node variable arrives as undefined, which hides snap.
  await page.addInitScript(bridgeScript, withSnap);
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const choose = page.getByRole("button", { name: /Choose folder/ });
  await choose.first().waitFor();
  await choose.first().click();
  await page.locator(".modal-back").waitFor({ state: "detached" });
  await page.waitForSelector('button[aria-label="Maximize"], button[aria-label="Restore"]');
  return page;
}

const page = await boot(true);
await page.click('button[aria-label="Maximize"]', { button: "right" });
const menu = page.getByRole("menu", { name: "Snap layouts" });
await menu.waitFor({ state: "visible" });
const zones = await menu.getByRole("menuitem").count();
check("SN1", zones >= 8, { zones });
await page.screenshot({ path: join(OUT, "snap-layouts.png") });

await menu.getByRole("menuitem", { name: "Left half" }).first().click();
const snaps = await page.evaluate(() => window.__papelSnaps);
const menuGone = (await menu.count()) === 0 || !(await menu.isVisible());
check("SN2", snaps.length === 1 && snaps[0].x === 0 && snaps[0].w === 0.5 && snaps[0].h === 1 && menuGone, {
  snaps,
  menuGone,
});

await page.click('button[aria-label="Maximize"]', { button: "right" });
await menu.waitFor({ state: "visible" });
await page.keyboard.press("Escape");
await menu.waitFor({ state: "hidden" });
const snapsAfterEscape = await page.evaluate(() => window.__papelSnaps.length);
check("SN3", snapsAfterEscape === 1, { snapsAfterEscape });
await page.close();

const plain = await boot(false);
await plain.click('button[aria-label="Maximize"]', { button: "right" });
await plain.waitForTimeout(200);
const flyout = await plain.getByRole("menu", { name: "Snap layouts" }).count();
check("SN4", flyout === 0, { flyout });
await plain.close();

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
if (failed.length) {
  console.error(`[qa-snap] ${failed.length} failed`);
  process.exit(1);
}
console.log("[qa-snap] all passed");
