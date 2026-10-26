/**
 * `FileSystemDirectoryHandle` over the desktop bridge.
 *
 * `folder-sync.ts` is written against the File System Access API and the app
 * depends on its whole surface: `getFileHandle(...).createWritable()`,
 * `removeEntry`, `keys()`, `entries()`, `getFile()`, and the permission pair.
 * Rather than teach every caller about a second platform, this adapter presents
 * that same shape and lets the bridge do the I/O. Nothing here needs a live
 * browser handle, so it also runs under `node --test`.
 */
import type { DesktopBridge, DesktopDir } from "./bridge.ts";

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Mirrors `createWritable()` closely enough for `writeFolderFile`. */
export interface DesktopWritable {
  write(data: Uint8Array | string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export class DesktopFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  private readonly dir: DesktopDirectoryHandle;

  constructor(dir: DesktopDirectoryHandle, name: string) {
    this.dir = dir;
    this.name = name;
  }

  async getFile(): Promise<File> {
    const bytes = await this.dir.bridge.readFile(this.dir.id, this.name);
    // A missing file is an empty one here: `listNoteFiles` only calls this for
    // names the directory just reported, and a race should not throw.
    const view = new Uint8Array(bytes ?? new Uint8Array());
    return new File([view.buffer as ArrayBuffer], this.name);
  }

  async createWritable(): Promise<DesktopWritable> {
    const chunks: Uint8Array[] = [];
    const dir = this.dir;
    const name = this.name;
    return {
      async write(data: Uint8Array | string) {
        chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
      },
      async close() {
        await dir.bridge.writeFile(dir.id, name, concat(chunks));
        chunks.length = 0;
      },
      async abort() {
        chunks.length = 0;
      },
    };
  }

  /** `renameFolderFile` prefers this over write-new + delete-old. */
  async move(newName: string): Promise<void> {
    if (newName === this.name) return;
    const bytes = await this.dir.bridge.readFile(this.dir.id, this.name);
    await this.dir.bridge.writeFile(this.dir.id, newName, bytes ?? new Uint8Array());
    await this.dir.bridge.removeFile(this.dir.id, this.name);
  }

  async remove(): Promise<void> {
    await this.dir.bridge.removeFile(this.dir.id, this.name);
  }
}

export class DesktopDirectoryHandle {
  readonly kind = "directory" as const;
  readonly bridge: DesktopBridge;
  readonly dir: DesktopDir;

  constructor(bridge: DesktopBridge, dir: DesktopDir) {
    this.bridge = bridge;
    this.dir = dir;
  }

  get id(): string {
    return this.dir.id;
  }

  get name(): string {
    return this.dir.name;
  }

  async getFileHandle(name: string, _options?: { create?: boolean }): Promise<DesktopFileHandle> {
    return new DesktopFileHandle(this, name);
  }

  async removeEntry(name: string): Promise<void> {
    await this.bridge.removeFile(this.id, name);
  }

  async *keys(): AsyncGenerator<string> {
    yield* await this.bridge.listFiles(this.id);
  }

  async *entries(): AsyncGenerator<[string, DesktopFileHandle]> {
    for (const name of await this.bridge.listFiles(this.id)) {
      yield [name, new DesktopFileHandle(this, name)];
    }
  }

  /**
   * A portable folder is granted for the life of the process once picked; there
   * is no per-origin permission model to re-ask. `verifyFolderPermission` in
   * `folder-sync.ts` calls these and gets the browser's happy path.
   */
  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

/** What `folder-sync.ts` accepts: the browser handle or the desktop one. */
export type FolderDir = FileSystemDirectoryHandle | DesktopDirectoryHandle;

export function isDesktopDir(dir: FolderDir): dir is DesktopDirectoryHandle {
  return dir instanceof DesktopDirectoryHandle;
}

/**
 * The avatar that survives IndexedDB.
 *
 * A live handle cannot be stored on desktop (the adapter holds functions), so
 * the folder is remembered as `{ id, name }` and rebuilt by `loadFolderHandle`.
 */
export interface StoredDesktopDir {
  __papelDesktopDir: DesktopDir;
}

export function storedDesktopDir(dir: DesktopDir): StoredDesktopDir {
  return { __papelDesktopDir: dir };
}

export function readStoredDesktopDir(value: unknown): DesktopDir | null {
  if (value === null || typeof value !== "object") return null;
  const stored = (value as Partial<StoredDesktopDir>).__papelDesktopDir;
  if (!stored || typeof stored.id !== "string" || typeof stored.name !== "string") return null;
  return stored;
}
