/**
 * The desktop contract.
 *
 * A portable build has no File System Access API: neither WebView2 nor Electron
 * implements `showDirectoryPicker`, and the app treats that as "no sync folder",
 * which disables New/Open entirely. Each shell therefore injects
 * `window.__PAPEL_DESKTOP__` before the page loads, and the browser app keeps a
 * single code path by talking to an adapter over this interface.
 *
 * The bridge is the only place shells differ; nothing below it knows which shell
 * it runs in. Bytes cross the boundary as `Uint8Array`; a shell that must encode
 * them (Tauri IPC, for instance) does so inside its own injected script.
 */

/** A directory the user granted: a durable id plus a display name. */
export interface DesktopDir {
  id: string;
  name: string;
}

export interface DesktopBridge {
  /** Contract revision. A shell and this file must agree, or we refuse to use it. */
  readonly version: number;

  /** Semver from the shell (matches tauri/Cargo version). */
  appVersion(): Promise<string>;

  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  close(): Promise<void>;

  /** Ask the user for a folder. `null` when they cancel. */
  pickDirectory(): Promise<DesktopDir | null>;

  /**
   * Re-open a folder by id from a previous session. `null` when it is gone
   * (moved, deleted, unplugged) — the caller then asks the user to pick again.
   */
  resolveDirectory(id: string): Promise<DesktopDir | null>;

  /** File bytes, or `null` when the file does not exist. */
  readFile(dirId: string, name: string): Promise<Uint8Array | null>;

  writeFile(dirId: string, name: string, bytes: Uint8Array): Promise<void>;

  /** Deleting a missing file is not an error. */
  removeFile(dirId: string, name: string): Promise<void>;

  /** Immediate children that are files. Names only; directories are skipped. */
  listFiles(dirId: string): Promise<string[]>;

  /**
   * Native save dialog. Resolves `true` when the user saved, `false` when they
   * cancelled. Used instead of the browser's download manager so a portable
   * build writes where the user says, not into Downloads.
   */
  saveFile(name: string, bytes: Uint8Array, mime: string): Promise<boolean>;
}

/** Bump when a method is added or its meaning changes. */
export const DESKTOP_BRIDGE_VERSION = 2;

declare global {
  interface Window {
    __PAPEL_DESKTOP__?: DesktopBridge;
  }
}

/**
 * The injected bridge, or `null` in a browser.
 *
 * Version-checked on purpose: a newer bundle running inside an older shell is a
 * real possibility for a portable app the user copies around, and silently
 * calling a method that does not exist would look like data loss.
 */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.__PAPEL_DESKTOP__;
  if (!bridge || typeof bridge !== "object") return null;
  if (bridge.version !== DESKTOP_BRIDGE_VERSION) {
    console.warn(
      `[papel] desktop bridge v${String(bridge.version)} does not match v${DESKTOP_BRIDGE_VERSION}; using browser file handling.`,
    );
    return null;
  }
  if (typeof bridge.pickDirectory !== "function" || typeof bridge.writeFile !== "function") return null;
  if (typeof bridge.appVersion !== "function" || typeof bridge.minimize !== "function") return null;
  return bridge;
}

/** UTF-8 bytes for either representation `download()` accepts. */
export function asBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}
