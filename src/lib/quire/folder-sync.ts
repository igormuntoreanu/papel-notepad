/** Folder autosave via the File System Access API (Chrome / Edge). */

const HANDLE_KEY = "folderHandle";

type DirHandle = FileSystemDirectoryHandle;

type WindowWithFolderPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirHandle>;
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

/** Unique file names when two sheets share a title. */
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
