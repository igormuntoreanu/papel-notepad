/**
 * The adapter is the whole point of the desktop bridge: `folder-sync.ts` keeps
 * using File System Access semantics, and the shells get ordinary file I/O. If
 * these behaviours drift, folder autosave silently stops writing notes — which
 * looks like data loss to a user, so they are asserted directly.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DESKTOP_BRIDGE_VERSION, type DesktopBridge } from "./bridge.ts";
import {
  DesktopDirectoryHandle,
  isDesktopDir,
  readStoredDesktopDir,
  storedDesktopDir,
} from "./fs-adapter.ts";

const DIR = { id: "dir-1", name: "Notes" };

/** In-memory stand-in for a shell's file I/O. */
function fakeBridge() {
  const files = new Map<string, Uint8Array>();
  const key = (dirId: string, name: string) => `${dirId}/${name}`;
  const bridge: DesktopBridge = {
    version: DESKTOP_BRIDGE_VERSION,
    appVersion: async () => "0.0.0-test",
    minimize: async () => {},
    toggleMaximize: async () => {},
    isMaximized: async () => false,
    close: async () => {},
    pickDirectory: async () => DIR,
    resolveDirectory: async (id) => (id === DIR.id ? DIR : null),
    readFile: async (dirId, name) => files.get(key(dirId, name)) ?? null,
    writeFile: async (dirId, name, bytes) => {
      files.set(key(dirId, name), bytes.slice());
    },
    removeFile: async (dirId, name) => {
      files.delete(key(dirId, name));
    },
    listFiles: async (dirId) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${dirId}/`))
        .map((k) => k.slice(dirId.length + 1)),
    saveFile: async () => true,
  };
  return { bridge, files };
}

describe("DesktopDirectoryHandle", () => {
  it("writes through createWritable only on close", async () => {
    const { bridge, files } = fakeBridge();
    const dir = new DesktopDirectoryHandle(bridge, DIR);
    const file = await dir.getFileHandle("a.txt", { create: true });
    const writable = await file.createWritable();

    await writable.write("hello ");
    await writable.write(new TextEncoder().encode("world"));
    assert.equal(files.size, 0, "nothing reaches the disk before close");

    await writable.close();
    assert.equal(new TextDecoder().decode(files.get("dir-1/a.txt")), "hello world");
  });

  it("drops buffered bytes when the write is aborted", async () => {
    const { bridge, files } = fakeBridge();
    const dir = new DesktopDirectoryHandle(bridge, DIR);
    const file = await dir.getFileHandle("a.txt", { create: true });
    const writable = await file.createWritable();
    await writable.write("half a note");
    await writable.abort();
    await writable.close();
    assert.equal(files.get("dir-1/a.txt")?.byteLength, 0);
  });

  it("lists files and enumerates them like a real handle", async () => {
    const { bridge, files } = fakeBridge();
    files.set("dir-1/one.papel", new Uint8Array([1]));
    files.set("dir-1/two.txt", new Uint8Array([2]));
    const dir = new DesktopDirectoryHandle(bridge, DIR);

    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    assert.deepEqual(names.sort(), ["one.papel", "two.txt"]);

    const seen: string[] = [];
    for await (const [name, handle] of dir.entries()) {
      seen.push(`${name}:${handle.kind}`);
    }
    assert.deepEqual(seen.sort(), ["one.papel:file", "two.txt:file"]);
  });

  it("renames by copying bytes then deleting the old name", async () => {
    const { bridge, files } = fakeBridge();
    files.set("dir-1/old.papel", new TextEncoder().encode("note"));
    const dir = new DesktopDirectoryHandle(bridge, DIR);
    const file = await dir.getFileHandle("old.papel");
    await file.move("new.papel");

    assert.equal(files.has("dir-1/old.papel"), false);
    assert.equal(new TextDecoder().decode(files.get("dir-1/new.papel")), "note");
  });

  it("reports granted permission so verifyFolderPermission takes the happy path", async () => {
    const { bridge } = fakeBridge();
    const dir = new DesktopDirectoryHandle(bridge, DIR);
    assert.equal(await dir.queryPermission(), "granted");
    assert.equal(await dir.requestPermission(), "granted");
    assert.equal(isDesktopDir(dir), true);
  });
});

describe("stored directory records", () => {
  it("survives structured clone because it holds only strings", () => {
    const stored = storedDesktopDir(DIR);
    const roundTripped = structuredClone(stored);
    assert.deepEqual(readStoredDesktopDir(roundTripped), DIR);
  });

  it("ignores anything that is not a stored directory", () => {
    assert.equal(readStoredDesktopDir(null), null);
    assert.equal(readStoredDesktopDir({}), null);
    assert.equal(readStoredDesktopDir({ __papelDesktopDir: { id: 1 } }), null);
  });
});
