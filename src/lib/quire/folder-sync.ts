/**
 * Folder autosave.
 *
 * Two providers behind one surface: the File System Access API in Chrome/Edge,
 * and the desktop bridge in the portable shells (WebView2 and Electron do not
 * implement the FSA *picker*, so the shells supply folder I/O themselves).
 * Everything below `pickSyncFolder` speaks the same handle shape, so callers in
 * `quire-app.tsx` never branch on platform.
 */
// Relative, with extensions: this module is also loaded by `node --test`
// through type stripping, where the `@/` alias does not resolve.
import { desktopBridge } from "../desktop/bridge.ts";
import {
  DesktopDirectoryHandle,
  type FolderDir,
  isDesktopDir,
  readStoredDesktopDir,
  storedDesktopDir,
} from "../desktop/fs-adapter.ts";

export type { FolderDir };

const HANDLE_KEY = "folderHandle";

type DirHandle = FileSystemDirectoryHandle;

type WindowWithFolderPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirHandle>;
};

type FileHandleWithMove = FileSystemFileHandle & {
  move?: (name: string) => Promise<void>;
  remove?: () => Promise<void>;
};

function folderWindow(): WindowWithFolderPicker {
  return window as WindowWithFolderPicker;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("papel", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Whether the app can offer a sync folder at all. False here is what makes the
 * UI say "Folder sync needs Chrome or Edge" and blocks New/Open, so the desktop
 * bridge must be counted — it is a folder picker by any other name.
 */
export function canPickFolder(): boolean {
  if (typeof window === "undefined") return false;
  return typeof folderWindow().showDirectoryPicker === "function" || desktopBridge() !== null;
}

export async function saveFolderHandle(handle: FolderDir): Promise<void> {
  // A live handle does not survive structured clone on desktop (the adapter
  // carries functions), so only the address is stored; load rebuilds it.
  const value = isDesktopDir(handle) ? storedDesktopDir(handle.dir) : handle;
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put(value, HANDLE_KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadFolderHandle(): Promise<FolderDir | null> {
  const db = await openDb();
  const tx = db.transaction("kv", "readonly");
  const value = await request(tx.objectStore("kv").get(HANDLE_KEY));
  db.close();
  if (!value) return null;
  const desktopDir = readStoredDesktopDir(value);
  if (desktopDir) {
    const bridge = desktopBridge();
    if (!bridge) return null;
    // The folder may have been moved or deleted between sessions.
    const resolved = await bridge.resolveDirectory(desktopDir.id);
    return resolved ? new DesktopDirectoryHandle(bridge, resolved) : null;
  }
  return (value as DirHandle | undefined) ?? null;
}

export async function clearFolderHandle(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").delete(HANDLE_KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function verifyFolderPermission(handle: FolderDir, ask: boolean): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  const withPerm = handle as FolderDir & {
    queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof withPerm.queryPermission === "function") {
    if ((await withPerm.queryPermission(opts)) === "granted") return true;
    if (!ask || typeof withPerm.requestPermission !== "function") return false;
    return (await withPerm.requestPermission(opts)) === "granted";
  }
  return true;
}

export async function pickSyncFolder(): Promise<FolderDir | null> {
  const bridge = desktopBridge();
  if (bridge) {
    const dir = await bridge.pickDirectory();
    if (!dir) return null;
    const handle = new DesktopDirectoryHandle(bridge, dir);
    await saveFolderHandle(handle);
    return handle;
  }

  const pick = folderWindow().showDirectoryPicker;
  if (!pick) return null;
  try {
    const handle = await pick({ mode: "readwrite" });
    if (!(await verifyFolderPermission(handle, true))) return null;
    await saveFolderHandle(handle);
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

export async function writeFolderFile(
  dir: FolderDir,
  name: string,
  data: Uint8Array | string,
): Promise<void> {
  if (isDesktopDir(dir)) {
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
    return;
  }
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(typeof data === "string" ? data : data.slice());
  } finally {
    await writable.close();
  }
}

export async function removeFolderFile(dir: FolderDir, name: string): Promise<void> {
  if (isDesktopDir(dir)) {
    await dir.removeEntry(name);
    return;
  }
  try {
    const file = (await dir.getFileHandle(name)) as FileHandleWithMove;
    if (typeof file.remove === "function") {
      await file.remove();
      return;
    }
  } catch {
    /* missing is fine */
  }
  try {
    await dir.removeEntry(name);
  } catch {
    /* missing is fine */
  }
}

/** Rename on disk: prefer move(), else write-new + delete-old. */
export async function renameFolderFile(
  dir: FolderDir,
  oldName: string,
  newName: string,
  data: Uint8Array | string,
): Promise<void> {
  if (oldName === newName) {
    await writeFolderFile(dir, newName, data);
    return;
  }
  if (isDesktopDir(dir)) {
    const file = await dir.getFileHandle(oldName);
    await file.move(newName);
    await writeFolderFile(dir, newName, data);
    return;
  }
  try {
    const file = (await dir.getFileHandle(oldName)) as FileHandleWithMove;
    if (typeof file.move === "function") {
      await file.move(newName);
      await writeFolderFile(dir, newName, data);
      return;
    }
  } catch {
    /* fall through */
  }
  await writeFolderFile(dir, newName, data);
  if (oldName !== newName) await removeFolderFile(dir, oldName);
}

type DirEntryHandle = { kind: string; name: string; getFile(): Promise<File> };

type DirIter = {
  keys?: () => AsyncIterableIterator<string>;
  entries?: () => AsyncIterableIterator<[string, DirEntryHandle]>;
};

/** Counts entries in the sync folder (for empty-folder migrate). */
export async function folderEntryCount(dir: FolderDir): Promise<number> {
  const iter = dir as unknown as DirIter;
  if (typeof iter.keys !== "function") return 0;
  let n = 0;
  for await (const _ of iter.keys()) n += 1;
  return n;
}

/** Lists syncable note files in the folder. */
export async function listNoteFiles(
  dir: FolderDir,
): Promise<Array<{ name: string; file: File }>> {
  const iter = dir as unknown as DirIter;
  const out: Array<{ name: string; file: File }> = [];
  if (typeof iter.entries !== "function") return out;
  for await (const [name, handle] of iter.entries()) {
    if (handle.kind !== "file") continue;
    const lower = name.toLowerCase();
    if (
      !(
        lower.endsWith(".papel") ||
        lower.endsWith(".quire") ||
        lower.endsWith(".txt") ||
        lower.endsWith(".py") ||
        lower.endsWith(".js") ||
        lower.endsWith(".json") ||
        lower.endsWith(".xml")
      )
    ) {
      continue;
    }
    out.push({ name, file: await handle.getFile() });
  }
  return out;
}

/** Build a safe `Title.ext` that does not collide with `used` (lowercase keys). */
export function uniqueFileName(title: string, ext: string, used: Set<string>): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled";
  const stripped = base.replace(/\.[^.]+$/, "");
  let name = `${stripped}.${ext}`;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${stripped} (${n}).${ext}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}
