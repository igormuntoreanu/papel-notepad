/**
 * Links (0.5.4) — pasted links are links.
 *   LK1 pasting URLs styles exactly them: Blue ink + underline, nothing around them
 *   LK2 Ctrl+click on a link opens it (window.open is stubbed, as verify-bugs does)
 *   LK3 a plain click does NOT open anything
 *   LK4 Ctrl+click on ordinary text opens nothing
 *   LK5 one Ctrl+Z takes the whole pasted link text away
 *
 *   npm run build:desktop && node scripts/qa-links.mjs
 *   BASE=http://localhost:8080 node scripts/qa-links.mjs   # against `npm run dev`
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist-desktop", "client");
const OUT = join(process.cwd(), "AI_Documentation", "qa", "0.5.4");
const PORT = 8100;
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
const PAGES = "http://localhost:8080/\nhttps://www.youtube.com/watch?v=e5b4lgf2jXE";

let server = null;
if (!process.env.BASE) {
  if (!existsSync(join(ROOT, "index.html"))) {
    console.error("[qa-links] run npm run build:desktop first (or set BASE)");
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
const bodyText = async () => (await page.locator(".ce-root").first().innerText()).trim();

await page.goto(BASE, { waitUntil: "domcontentloaded" });
const choose = page.getByRole("button", { name: /Choose folder/ });
await choose.first().waitFor({ timeout: 30000 });
await choose.first().click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "New sheet" }).first().click();
const editor = page.locator(".ce-root").first();
await editor.waitFor({ timeout: 20000 });
await page.waitForTimeout(800);

// ---- paste two links, the way a chat client puts them on the clipboard ----------
// The sheet is brand new, so the block starts empty: no clearing needed (Ctrl+A leaves a
// whole-sheet overlay on screen that would spoil the screenshot).
await editor.click();
await page.evaluate((text) => {
  const root = document.querySelector(".ce-root");
  root.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  root.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  );
}, PAGES);
await page.waitForTimeout(800);

/** Every styled run in the block: text, underline, ink colour class. */
const styled = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".ce-root .ce-line span")].map((s) => ({
      text: s.textContent ?? "",
      underline: getComputedStyle(s).textDecorationLine.includes("underline"),
      blue: getComputedStyle(s).color,
      cls: s.className,
    })),
  );

/** Viewport point inside link span `index` (the styled run itself). */
const linkPoint = (index) =>
  page.evaluate((i) => {
    const span = [...document.querySelectorAll(".ce-root .ce-line span")].filter((s) =>
      getComputedStyle(s).textDecorationLine.includes("underline"),
    )[i];
    if (!span) return null;
    const r = span.getBoundingClientRect();
    return { x: r.left + Math.min(10, r.width / 2), y: r.top + r.height / 2 };
  }, index);

/** What the editor currently promises with the pointer. */
const hoverState = () =>
  page.evaluate(() => {
    const root = document.querySelector(".ce-root");
    return {
      attr: root.getAttribute("data-link-hover"),
      title: root.getAttribute("title"),
      cursor: getComputedStyle(root).cursor,
    };
  });

// LK1 — only the two URLs wear the link look, and it is Blue + underlined ---------
const runs = await styled();
const links = runs.filter((r) => r.underline);
// The link ink is the "Blue" swatch: resolve the skin's --ink2 to a concrete colour.
const expectedBlue = await page.evaluate(() => {
  const ink2 = getComputedStyle(document.querySelector(".ce-root"))
    .getPropertyValue("--ink2")
    .trim();
  const probe = document.createElement("span");
  probe.style.color = ink2;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
});
check(
  "LK1-only-the-urls-are-styled",
  links.map((r) => r.text).join("|") ===
    "http://localhost:8080/|https://www.youtube.com/watch?v=e5b4lgf2jXE" &&
    links.every((r) => r.blue === expectedBlue),
  { links, expectedBlue, allRuns: runs.length },
);
await shot("03-pasted-links.png");

// LK10 — hovering a link WITHOUT the modifier promises nothing -------------------
const firstPoint = await linkPoint(0);
await page.mouse.move(firstPoint.x, firstPoint.y);
await page.waitForTimeout(150);
const bareHover = await hoverState();
check(
  "LK10-no-pointer-without-the-modifier",
  bareHover.attr === null && bareHover.cursor !== "pointer",
  {
    bareHover,
  },
);

// LK7 — Ctrl down over the link: hand pointer + the URL as a tooltip ------------
await page.keyboard.down("Control");
await page.waitForTimeout(150);
const ctrlHover = await hoverState();
check(
  "LK7-ctrl-hover-shows-a-pointer",
  ctrlHover.attr === "http://localhost:8080/" &&
    ctrlHover.title === "http://localhost:8080/" &&
    ctrlHover.cursor === "pointer",
  { ctrlHover },
);

// LK8 — releasing Ctrl clears it again without any mouse movement ---------------
await page.keyboard.up("Control");
await page.waitForTimeout(150);
const released = await hoverState();
check(
  "LK8-releasing-ctrl-clears-the-pointer",
  released.attr === null && released.cursor !== "pointer",
  {
    released,
  },
);

// LK2 — Ctrl+click on the first link opens it ------------------------------------
async function ctrlClickLink(which) {
  return page.evaluate(async (index) => {
    const opened = [];
    const real = window.open;
    window.open = (url) => {
      opened.push(String(url));
      return null;
    };
    try {
      const spans = [...document.querySelectorAll(".ce-root .ce-line span")].filter((s) =>
        getComputedStyle(s).textDecorationLine.includes("underline"),
      );
      const target = spans[index];
      if (!target) return { opened, reason: "no link span" };
      const range = document.createRange();
      range.selectNodeContents(target);
      const box = range.getBoundingClientRect();
      const x = box.left + Math.min(12, box.width / 2);
      const y = box.top + box.height / 2;
      const fire = (type) =>
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            ctrlKey: true,
            button: 0,
          }),
        );
      fire("mousedown");
      fire("mouseup");
      fire("click");
      await new Promise((r) => setTimeout(r, 150));
      return { opened, x: Math.round(x), y: Math.round(y) };
    } finally {
      window.open = real;
    }
  }, which);
}

const first = await ctrlClickLink(0);
check("LK2-ctrl-click-opens-the-link", first.opened[0] === "http://localhost:8080/", first);

const second = await ctrlClickLink(1);
check(
  "LK2b-ctrl-click-opens-the-second-link",
  second.opened[0] === "https://www.youtube.com/watch?v=e5b4lgf2jXE",
  second,
);

// LK3 — a plain click opens nothing ---------------------------------------------
const plainClick = await page.evaluate(async () => {
  const opened = [];
  const real = window.open;
  window.open = (url) => {
    opened.push(String(url));
    return null;
  };
  try {
    const span = [...document.querySelectorAll(".ce-root .ce-line span")].find((s) =>
      getComputedStyle(s).textDecorationLine.includes("underline"),
    );
    const range = document.createRange();
    range.selectNodeContents(span);
    const box = range.getBoundingClientRect();
    for (const type of ["mousedown", "mouseup", "click"]) {
      span.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: box.left + 6,
          clientY: box.top + box.height / 2,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 150));
    return opened;
  } finally {
    window.open = real;
  }
});
check("LK3-plain-click-does-nothing", plainClick.length === 0, { opened: plainClick });

// LK5 — one undo removes the whole pasted block of text --------------------------
await editor.click();
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
check("LK5-one-undo-removes-the-pasted-links", (await bodyText()) === "", {
  text: await bodyText(),
});

// LK4 — Ctrl+click on ordinary text opens nothing -------------------------------
await editor.click();
await page.keyboard.type("plain words here");
await page.waitForTimeout(300);
const prose = await page.evaluate(async () => {
  const opened = [];
  const real = window.open;
  window.open = (url) => {
    opened.push(String(url));
    return null;
  };
  try {
    const line = document.querySelector(".ce-root .ce-line");
    const range = document.createRange();
    range.selectNodeContents(line);
    const box = range.getBoundingClientRect();
    for (const type of ["mousedown", "mouseup", "click"]) {
      line.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: box.left + 8,
          clientY: box.top + box.height / 2,
          ctrlKey: true,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 150));
    return opened;
  } finally {
    window.open = real;
  }
});
check("LK4-ctrl-click-on-prose-does-nothing", prose.length === 0, { opened: prose });

// LK9 — Ctrl over ordinary text keeps the I-beam ---------------------------------
const prosePoint = await page.evaluate(() => {
  const line = document.querySelector(".ce-root .ce-line");
  const r = line.getBoundingClientRect();
  return { x: r.left + 20, y: r.top + r.height / 2 };
});
await page.keyboard.down("Control");
await page.mouse.move(prosePoint.x, prosePoint.y);
await page.waitForTimeout(150);
const proseHover = await hoverState();
await page.keyboard.up("Control");
check(
  "LK9-ctrl-hover-over-prose-stays-an-ibeam",
  proseHover.attr === null && proseHover.cursor !== "pointer",
  {
    proseHover,
  },
);

// LK6 — the legacy textarea renderer paints the same link look -------------------
// Both renderers share `stylizeLinks`; the textarea shows marks through its <pre> mirror.
const legacy = await browser.newPage({ viewport: { width: 1280, height: 900 } });
legacy.setDefaultTimeout(15000);
await legacy.addInitScript(() => {
  localStorage.setItem("papel-ce", "0");
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
await legacy.goto(BASE, { waitUntil: "domcontentloaded" });
await legacy
  .getByRole("button", { name: /Choose folder/ })
  .first()
  .waitFor({ timeout: 30000 });
await legacy
  .getByRole("button", { name: /Choose folder/ })
  .first()
  .click();
await legacy.waitForTimeout(1200);
await legacy.getByRole("button", { name: "New sheet" }).first().click();
const legacyEditor = legacy.locator("textarea.editor").first();
await legacyEditor.waitFor({ timeout: 20000 });
await legacy.waitForTimeout(800);
await legacyEditor.click();
await legacy.evaluate((text) => {
  const ta = document.querySelector("textarea.editor");
  ta.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  ta.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  );
}, PAGES);
await legacy.waitForTimeout(700);
const legacyLinks = await legacy.evaluate(() =>
  [...document.querySelectorAll(".block pre.hl span")]
    .filter((s) => getComputedStyle(s).textDecorationLine.includes("underline"))
    .map((s) => ({ text: s.textContent ?? "", cls: s.className })),
);
check(
  "LK6-legacy-renderer-shows-the-same-links",
  legacyLinks.length === 2 && legacyLinks.every((s) => s.cls.includes("ink2")),
  { legacyLinks },
);
// LK11 — the textarea renderer swaps its own cursor, and only while the modifier is down
const legacyPoint = await legacy.evaluate(() => {
  const span = [...document.querySelectorAll(".block pre.hl span")].find((s) =>
    getComputedStyle(s).textDecorationLine.includes("underline"),
  );
  if (!span) return null;
  const r = span.getBoundingClientRect();
  return { x: r.left + Math.min(10, r.width / 2), y: r.top + r.height / 2 };
});
const legacyHover = () =>
  legacy.evaluate(() => {
    const ta = document.querySelector("textarea.editor");
    return {
      attr: ta.getAttribute("data-link-hover"),
      title: ta.getAttribute("title"),
      cursor: getComputedStyle(ta).cursor,
    };
  });
await legacy.mouse.move(legacyPoint.x, legacyPoint.y);
await legacy.waitForTimeout(150);
const legacyBare = await legacyHover();
await legacy.keyboard.down("Control");
await legacy.waitForTimeout(150);
const legacyCtrl = await legacyHover();
await legacy.keyboard.up("Control");
await legacy.waitForTimeout(150);
const legacyReleased = await legacyHover();
check(
  "LK11-legacy-renderer-swaps-its-cursor",
  legacyBare.cursor !== "pointer" &&
    legacyCtrl.attr === "http://localhost:8080/" &&
    legacyCtrl.cursor === "pointer" &&
    legacyReleased.cursor !== "pointer",
  { legacyBare, legacyCtrl, legacyReleased },
);
await legacy.close();

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
