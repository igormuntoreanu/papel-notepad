#!/usr/bin/env node
/**
 * Build the browser app for a static host: GitHub Pages or a desktop shell.
 *
 * Both modes reuse the `PAPEL_PAGES` / `PAPEL_DESKTOP` switch read by
 * `vite.config.ts`, so the desktop bundles cannot drift from the web app: the
 * shells ship the exact `dist/client` output a browser would receive.
 *
 * Why a script instead of an inline `PAPEL_DESKTOP=1 vite build`:
 * npm scripts do not pass `VAR=value` prefixes through `cmd.exe`, and
 * `scripts/with-app-env.mjs` spawns without a shell (documented as broken on
 * Windows in TECHNICAL.md §8). Spawning Vite's JS entry with `process.execPath`
 * keeps the build cross-platform and independent of both.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

/** Vite's own entry point — not the `.bin` shim, which is platform-specific. */
const VITE_ENTRY = ["node_modules", "vite", "bin", "vite.js"];

const MODES = {
  desktop: {
    /** Desktop shells serve the bundle at the origin root over a custom scheme. */
    env: { PAPEL_DESKTOP: "1", VITE_DESKTOP: "1", VITE_AUTH_ENABLED: "false" },
    outputDir: ["dist-desktop", "client"],
  },
  pages: {
    /** GitHub project sites live under `/<repo>/`, so the base is a subpath. */
    env: { PAPEL_PAGES: "1", PAPEL_PAGES_BASE: "/papel-notepad/" },
    outputDir: ["dist", "client"],
  },
};

/** Vite always writes here first; the desktop mode then copies it elsewhere. */
const VITE_OUTPUT = ["dist", "client"];

/**
 * Environment additions for `mode`, or `null` for an unknown mode.
 * Pure so the flag contract can be asserted without running Vite.
 */
export function staticFlags(mode) {
  const config = MODES[mode];
  return config ? { ...config.env } : null;
}

/**
 * Directory `mode` publishes from, relative to the workspace root.
 * `null` for an unknown mode.
 */
export function outputDirFor(mode) {
  const config = MODES[mode];
  return config ? config.outputDir.join("/") : null;
}

/** Whether the build must be copied out of Vite's default directory. */
export function needsCopy(mode) {
  return mode === "desktop";
}

function fail(message) {
  console.error(`[build-static] ${message}`);
  process.exit(2);
}

function main(argv) {
  const [mode, ...rest] = argv;
  if (!mode) fail(`usage: node scripts/build-static.mjs <${Object.keys(MODES).join("|")}>`);

  const flags = staticFlags(mode);
  if (!flags) fail(`unknown mode "${mode}" (expected ${Object.keys(MODES).join(" or ")})`);

  const root = projectRoot();
  const viteEntry = join(root, ...VITE_ENTRY);
  if (!existsSync(viteEntry)) fail(`${VITE_ENTRY.join("/")} is missing — run \`npm ci\` first.`);

  // A stale output would make a failed build look successful to the shells.
  const output = join(root, ...MODES[mode].outputDir);
  rmSync(output, { recursive: true, force: true });

  const result = spawnSync(process.execPath, [viteEntry, "build", ...rest], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...flags },
  });
  if (result.error) fail(`failed to start vite: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);

  if (needsCopy(mode)) {
    cpSync(join(root, ...VITE_OUTPUT), output, { recursive: true });
  }
  console.log(`[build-static] ${mode} output: ${outputDirFor(mode)}`);
}

// Imported by `scripts/build-static.test.mjs`; only run as a CLI.
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
