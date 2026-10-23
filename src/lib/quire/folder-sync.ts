/** Folder autosave via the File System Access API (Chrome / Edge). */

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

export function canPickFolder(): boolean {
  return typeof window !== "undefined" && typeof folderWindow().showDirectoryPicker === "function";
}

export async function saveFolderHandle(handle: DirHandle): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put(handle, HANDLE_KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadFolderHandle(): Promise<DirHandle | null> {
  const db = await openDb();
  const tx = db.transaction("kv", "readonly");
  const handle = (await request(tx.objectStore("kv").get(HANDLE_KEY))) as DirHandle | undefined;
  db.close();
  return handle ?? null;
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

export async function verifyFolderPermission(handle: DirHandle, ask: boolean): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  const withPerm = handle as DirHandle & {
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

export async function pickSyncFolder(): Promise<DirHandle | null> {
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
  dir: DirHandle,
  name: string,
  data: Uint8Array | string,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(typeof data === "string" ? data : data.slice());
  } finally {
    await writable.close();
  }
}

export async function removeFolderFile(dir: DirHandle, name: string): Promise<void> {
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
  dir: DirHandle,
  oldName: string,
  newName: string,
  data: Uint8Array | string,
): Promise<void> {
  if (oldName === newName) {
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

type DirIter = DirHandle & {
  keys?: () => AsyncIterableIterator<string>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

/** Counts entries in the sync folder (for empty-folder migrate). */
export async function folderEntryCount(dir: DirHandle): Promise<number> {
  const iter = dir as DirIter;
  if (typeof iter.keys !== "function") return 0;
  let n = 0;
  for await (const _ of iter.keys()) n += 1;
  return n;
}

/** Lists syncable note files in the folder. */
export async function listNoteFiles(
  dir: DirHandle,
): Promise<Array<{ name: string; file: File }>> {
  const iter = dir as DirIter;
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
    out.push({ name, file: await (handle as FileSystemFileHandle).getFile() });
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
