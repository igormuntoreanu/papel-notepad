import type { SkinId } from "@/lib/quire/text";

export type StoredBlock =
  | { kind: "text"; text: string; marks?: number[] }
  | { kind: "image"; mime: string; bytes: ArrayBuffer };

export type StoredNote = {
  id: string;
  title: string;
  wrap: boolean;
  edited?: number;
  language: string;
  eol: string;
  encoding: string;
  blocks: StoredBlock[];
};

export type Persisted = {
  notes: StoredNote[];
  order: string[];
  activeId: string | null;
};

export type SortMode = "manual" | "recent" | "title";

export type Prefs = {
  skin: SkinId;
  zoom: number;
  autocorrect: boolean;
  sort: SortMode;
};

const DB = "papel";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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

export async function loadPersisted(): Promise<{ doc: Persisted | null; prefs: Partial<Prefs> | null }> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const doc = (await request(store.get("doc"))) as Persisted | undefined;
  const prefs = (await request(store.get("prefs"))) as Partial<Prefs> | undefined;
  db.close();
  return { doc: doc ?? null, prefs: prefs ?? null };
}

export async function savePersisted(doc: Persisted, prefs: Prefs): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.put(doc, "doc");
  store.put(prefs, "prefs");
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
