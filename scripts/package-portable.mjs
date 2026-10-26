#!/usr/bin/env node
/**
 * Package V1 (Tauri/WebView2) as the folder-portable artifact the plan promises:
 * unzip, run `Papel.exe`, no installer, no registry, no admin.
 *
 * Two files are load-bearing and both must travel together:
 *  - `Papel.exe` — the shell with the whole web bundle embedded;
 *  - `WebView2Loader.dll` — a sidecar the exe imports at runtime. Missing it
 *    produces a Windows "code execution cannot proceed" dialog before `main`.
 *
 * User data is created at `data/` beside the exe on first launch, so zipping the
 * folder after a test run would ship someone's notes. The package is built from
 * the release artifacts only, never from a directory the app has run in.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

const VARIANTS = {
  v1: {
    exe: "papel-shell-tauri.exe",
    releaseDir: ["shells", "tauri", "src-tauri", "target", "release"],
    name: "Papel",
    // WebView2 resolves this sidecar relative to the executable.
    sidecar: "WebView2Loader.dll",
  },
  v3: {
    exe: "papel-desktop.exe",
    releaseDir: ["desktop", "target", "release"],
    name: "Papel",
    // Fonts are embedded in the binary; nothing else travels with it.
    sidecar: null,
  },
};

const README = (version) => `Papel ${version} — portable (Windows)

Run Papel.exe. There is no installer, nothing is written to the registry, and
no administrator rights are needed.

Your sheets
  Notes are saved as ordinary files in the folder you pick on first launch.
  Papel also keeps its own state in the "data" folder next to Papel.exe, so the
  whole directory can be moved or copied to another machine or a USB stick and
  will carry the notes, the autosave and the window profile with it.

  To keep the data somewhere else, set PAPEL_DATA_DIR to a folder path before
  launching (for example %APPDATA%\\Papel).

First launch
  Windows may show "Windows protected your PC" because this build is not code
  signed. Choose "More info" then "Run anyway".

Uninstalling
  Delete the folder.
`;

function fail(message) {
  console.error(`[package] ${message}`);
  process.exit(2);
}

function readVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  void pkg;
  // The shell's own version is authoritative for a shell artifact.
  const conf = JSON.parse(readFileSync(join(root, "shells", "tauri", "src-tauri", "tauri.conf.json"), "utf8"));
  return conf.version ?? "0.1.0";
}

/** Compress with the OS tooling; Node ships no zip writer. */
function zip(sourceDir, zipPath) {
  rmSync(zipPath, { force: true });
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${sourceDir}/*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) fail("Compress-Archive failed");
}

function main(argv) {
  const variant = argv[0] ?? "v1";
  const config = VARIANTS[variant];
  if (!config) fail(`unknown variant "${variant}" (expected ${Object.keys(VARIANTS).join(" or ")})`);

  const root = projectRoot();
  const releaseDir = join(root, ...config.releaseDir);
  const exePath = join(releaseDir, config.exe);
  const dllPath = join(releaseDir, "WebView2Loader.dll");
  if (!existsSync(exePath)) fail(`${config.exe} is missing - build the ${variant} variant first.`);
  if (config.sidecar && !existsSync(dllPath)) {
    fail(`${config.sidecar} is missing from the release directory.`);
  }

  const version = readVersion(root);
  const outDir = join(root, "dist-portable", variant.toUpperCase());
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  copyFileSync(exePath, join(outDir, `${config.name}.exe`));
  if (config.sidecar) {
    copyFileSync(dllPath, join(outDir, config.sidecar));
  }
  writeFileSync(join(outDir, "README.txt"), README(version));

  const zipPath = join(root, "dist-portable", `papel-${version}-portable-${variant}.zip`);
  zip(outDir, zipPath);
  console.log(`[package] ${variant}: ${outDir}`);
  console.log(`[package] ${variant}: ${zipPath}`);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
