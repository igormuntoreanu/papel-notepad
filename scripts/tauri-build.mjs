#!/usr/bin/env node
/**
 * Build V1: the static bundle, then the Tauri (WebView2) shell around it.
 *
 * Two steps in one command so the exe can never wrap a stale bundle: the
 * shell embeds `dist-desktop/client` at compile time, which means a forgotten
 * `npm run build:desktop` silently ships last week's UI.
 *
 * The Tauri CLI is spawned with `process.execPath` and a cwd of the shell's
 * app directory, matching what runs from a terminal but without depending on
 * npm script shell behaviour (see TECHNICAL.md §8 for the Windows spawn trap).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

/** npm package entry, not the platform binary the package wraps. */
const CLI_ENTRY = ["node_modules", "@tauri-apps", "cli", "tauri.js"];
/** App directory: the CLI resolves `src-tauri` relative to its cwd. */
const APP_DIR = ["shells", "tauri"];

/**
 * `dlltool` is not optional on this host.
 *
 * The installed toolchain is `x86_64-pc-windows-gnu`, which has no MinGW, and
 * crates linking through `windows-link` use `raw-dylib`: rustc therefore has to
 * synthesize import libraries and fails with `error calling dlltool` when the
 * binary is absent. A MinGW-w64 `dlltool` (LLVM-MinGW's is compatible) is
 * enough. Look it up and put it on PATH rather than making the build depend on
 * how the developer's shell was configured.
 */
export function findDlltoolDir({ env = process.env, searchRoots } = {}) {
  for (const entry of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (entry && existsSync(join(entry, "dlltool.exe"))) return entry;
  }
  const roots = searchRoots ?? [
    join(env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages"),
    "C:\\msys64\\mingw64\\bin",
    "C:\\llvm-mingw\\bin",
    "C:\\Program Files\\LLVM-MinGW\\bin",
  ];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    if (existsSync(join(root, "dlltool.exe"))) return root;
    // WinGet keeps portable packages at <Packages>/<Id>/<tool>-<version>/bin.
    let entries = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgDir = join(root, entry.name);
      let nested = [];
      try {
        nested = readdirSync(pkgDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const inner of nested) {
        if (!inner.isDirectory()) continue;
        const bin = join(pkgDir, inner.name, "bin");
        if (existsSync(join(bin, "dlltool.exe"))) return bin;
      }
    }
  }
  return null;
}

/**
 * Link flags for the `x86_64-pc-windows-gnu` toolchain this machine has.
 *
 * Without them, crates that generate import libraries fail with
 * `error calling dlltool 'dlltool.exe': program not found`. `rust-lld` plus
 * self-contained libs stand in for MinGW's linker, and the result needs no
 * MinGW runtime DLLs beside the exe — the same trick `desktop/build.ps1` uses
 * for the native shell.
 *
 * Returns `null` on any other host, where the defaults are already correct.
 */
export function windowsGnuLinkFlags() {
  const version = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  if (!/host: x86_64-pc-windows-gnu/.test(version)) return null;
  const sysroot = execFileSync("rustc", ["--print", "sysroot"], { encoding: "utf8" }).trim();
  const lld = join(sysroot, "lib", "rustlib", "x86_64-pc-windows-gnu", "bin", "rust-lld.exe");
  if (!existsSync(lld)) return null;
  return `-Clink-self-contained=y -Clinker=${lld}`;
}

function main(argv) {
  const root = projectRoot();
  if (!existsSync(join(root, ...CLI_ENTRY))) {
    console.error("[tauri] @tauri-apps/cli is missing — run `npm ci` first.");
    process.exit(2);
  }

  const staticBuild = spawnSync(
    process.execPath,
    [join(root, "scripts", "build-static.mjs"), "desktop"],
    { cwd: root, stdio: "inherit" },
  );
  if (staticBuild.status !== 0) process.exit(staticBuild.status ?? 1);

  const env = { ...process.env };
  const linkFlags = windowsGnuLinkFlags();
  if (linkFlags) env.RUSTFLAGS = [process.env.RUSTFLAGS, linkFlags].filter(Boolean).join(" ");

  const dlltoolDir = findDlltoolDir({ env });
  if (dlltoolDir) {
    env.PATH = [dlltoolDir, process.env.PATH].filter(Boolean).join(delimiter);
  } else if (linkFlags) {
    console.warn(
      "[tauri] dlltool.exe not found. Install LLVM-MinGW (winget install MartinStorsjo.LLVM-MinGW.UCRT) or MinGW-w64.",
    );
  }

  // `--no-bundle`: V1 ships as a folder-portable zip, not an installer.
  const result = spawnSync(
    process.execPath,
    [join(root, ...CLI_ENTRY), "build", "--no-bundle", ...argv],
    { cwd: join(root, ...APP_DIR), stdio: "inherit", env },
  );
  if (result.error) {
    console.error("[tauri] failed to start the CLI:", result.error.message);
    process.exit(2);
  }
  process.exit(result.status ?? 1);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
