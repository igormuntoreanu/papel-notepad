import { useEffect, useRef, useState } from "react";
import { createSession, type Session } from "@/lib/quire/engine";
import { toggleBullets } from "@/lib/quire/blocks";
import { MIN_QUERY, searchNotes } from "@/lib/quire/fuzzy";
import { FLAG, rangeHas, readMarks, type FlagName } from "@/lib/quire/marks";
import { savePersisted, type Prefs, type SortMode } from "@/lib/quire/persist";
import { ARCHIVE_EXT, archiveFileName, formatLastBackup, mergeArchive, parseArchive, zipBackupFileName } from "@/lib/quire/backup";
import {
  canPickFolder,
  folderEntryCount,
  type FolderDir,
  loadFolderHandle,
  pickSyncFolder,
  removeFolderFile,
  renameFolderFile,
  uniqueFileName,
  verifyFolderPermission,
  writeFolderFile,
} from "@/lib/quire/folder-sync";
import { defaultSaveExt, extFromFilename, isRich as richFlags, saveExtensions } from "@/lib/quire/save-type";
import { installTextures } from "@/lib/quire/textures";
import {
  canOpenFile,
  download,
  FILE_ACCEPT,
  fileStamp,
  langFromFilename,
  mimeForExtension,
  safeName,
  SKINS,
  type DateStampStyle,
  type SkinId,
} from "@/lib/quire/text";
import { copyTitle, titleFromFilename, uniqueTitle } from "@/lib/quire/titles";
import { buildZip } from "@/lib/quire/zip";
import { Board, type CardActions } from "./board";
import { HeaderStrip } from "./header-strip";
import { Sheet, type FindState, type SheetActions, type StyleState } from "./sheet";
import type { CellTarget } from "./table-block";
import type { BlockLook } from "@/lib/quire/typefaces";
import {
  blankNote,
  buildArchive,
  cardInfo,
  dropUrls,
  duplicateSession,
  ensureLoaded,
  forgetCard,
  fromPapel,
  imageUrl,
  outlineOf,
  sessionFromArchiveNote,
  sessions,
  snapshot,
  toPapel,
  type NoteMeta,
  type Place,
} from "./store";

type Ask = { title: string; body: string; confirm: string; tone?: "danger"; run: () => void };
type Sel = { blockId: number; start: number; end: number };

function sessionRich(session: Session): boolean {
  const outline = outlineOf(session);
  return richFlags({
    hasImage: outline.some((item) => item.kind === "image"),
    hasTable: outline.some((item) => item.kind === "table"),
    hasMarks: session.has_marks(),
  });
}

export function QuireApp() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "focus">("board");
  const [skin, setSkin] = useState<SkinId>("sulphite");
  const [zoom, setZoom] = useState(16);
  const [autocorrect, setAutocorrect] = useState(true);
  const [sort, setSort] = useState<SortMode>("manual");
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  /** Chromium: true until a sync folder is linked with write permission. */
  const [folderGate, setFolderGate] = useState(false);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<Sel>({ blockId: 0, start: 0, end: 0 });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [line, setLine] = useState("");
  const [findStatus, setFindStatus] = useState("");
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [cellTarget, setCellTarget] = useState<CellTarget | null>(null);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const focusRef = useRef<Place | null>(null);
  const anchor = useRef<Place | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<FolderDir | null>(null);
  const folderOkRef = useRef(false);
  const notesRef = useRef(notes);
  const orderRef = useRef(order);
  const activeRef = useRef(activeId);
  const selRef = useRef(sel);
  notesRef.current = notes;
  orderRef.current = order;
  activeRef.current = activeId;
  selRef.current = sel;

  function notePayload(s: Session, meta: NoteMeta): { ext: string; data: string | Uint8Array } {
    const ext = defaultSaveExt({ sourceExt: meta.sourceExt });
    if (ext === "papel") return { ext, data: toPapel(s, meta.looks ?? {}) };
    return { ext, data: s.export_bytes() };
  }

  async function writeNoteToFolder(meta: NoteMeta, s: Session, prevDisk?: string): Promise<string | null> {
    const dir = folderRef.current;
    if (!dir || !folderOkRef.current) return null;
    const { ext, data } = notePayload(s, meta);
    const used = new Set(
      notesRef.current.filter((n) => n.id !== meta.id && n.diskName).map((n) => n.diskName!.toLowerCase()),
    );
    const name = uniqueFileName(meta.title, ext, used);
    try {
      if (prevDisk && prevDisk !== name) await renameFolderFile(dir, prevDisk, name, data);
      else await writeFolderFile(dir, name, data);
      s.mark_clean();
      return name;
    } catch {
      setMessage("Could not write to the sync folder.");
      return null;
    }
  }

  function setDiskName(id: string, diskName: string | undefined) {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, diskName } : n)));
  }

  async function linkFolder(handle: FolderDir) {
    folderRef.current = handle;
    folderOkRef.current = true;
    setFolderName(handle.name);
    setFolderGate(false);
    // Migrate: if folder is empty, push every open sheet once.
    try {
      const count = await folderEntryCount(handle);
      if (count === 0) {
        for (const id of orderRef.current) {
          const meta = notesRef.current.find((n) => n.id === id);
          const s = sessions.get(id);
          if (!meta || !s) continue;
          const disk = await writeNoteToFolder(meta, s);
          if (disk) setDiskName(id, disk);
        }
      } else {
        for (const id of orderRef.current) {
          const meta = notesRef.current.find((n) => n.id === id);
          const s = sessions.get(id);
          if (!meta || !s) continue;
          const disk = await writeNoteToFolder(meta, s, meta.diskName);
          if (disk) setDiskName(id, disk);
        }
      }
    } catch {
      setMessage("Could not sync sheets to the folder.");
    }
    setTick((n) => n + 1);
  }

  const session = activeId ? (sessions.get(activeId) ?? null) : null;
  const note = notes.find((n) => n.id === activeId) ?? null;
  const skinMeta = SKINS.find((s) => s.id === skin) ?? SKINS[0];
  // Cards refresh once typing pauses, so the side column does not repaint on every keystroke.
  const [cardTick, setCardTick] = useState(0);

  useEffect(() => {
    installTextures();
    let cancel = false;
    void ensureLoaded()
      .then((data) => {
        if (cancel) return;
        setNotes(data.notes);
        setOrder(data.order);
        setActiveId(data.activeId);
        setSkin(data.prefs.skin);
        setZoom(data.prefs.zoom);
        setAutocorrect(data.prefs.autocorrect);
        setSort(data.prefs.sort);
        setLastBackup(data.prefs.lastBackup ?? null);
        setFolderName(data.prefs.folderName ?? null);
        setReady(true);
        if (!canPickFolder()) {
          setFolderGate(false);
          return;
        }
        void loadFolderHandle().then(async (handle) => {
          if (cancel) return;
          if (!handle) {
            setFolderGate(true);
            return;
          }
          if (await verifyFolderPermission(handle, false)) {
            await linkFolder(handle);
          } else {
            folderRef.current = handle;
            folderOkRef.current = false;
            setFolderName(handle.name);
            setFolderGate(true);
          }
        });
      })
      .catch((err: unknown) => {
        if (!cancel) setFailed(err instanceof Error ? err.message : "The editor core failed to start.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const handle = window.setTimeout(() => {
      const prefs: Prefs = {
        skin,
        zoom,
        autocorrect,
        sort,
        lastBackup: lastBackup ?? undefined,
        folderName: folderName ?? undefined,
      };
      void savePersisted(snapshot(notes, order, activeId), prefs).catch(() => {
        setMessage("Could not autosave this sheet.");
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [ready, notes, order, activeId, skin, zoom, autocorrect, sort, lastBackup, folderName, tick]);

  useEffect(() => {
    if (!ready || !folderOkRef.current || !folderRef.current) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        for (const id of orderRef.current) {
          const meta = notesRef.current.find((n) => n.id === id);
          const s = sessions.get(id);
          if (!meta || !s) continue;
          const disk = await writeNoteToFolder(meta, s, meta.diskName);
          if (disk && disk !== meta.diskName) setDiskName(id, disk);
        }
      })();
    }, 700);
    return () => window.clearTimeout(handle);
  }, [ready, folderName, notes, order, tick]);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      for (const s of sessions.values()) {
        if (s.is_dirty()) {
          e.preventDefault();
          e.returnValue = "";
          return;
        }
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setCardTick(tick), 500);
    return () => window.clearTimeout(id);
  }, [tick]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(id);
  }, [message]);

  useEffect(() => {
    if (!alert) return;
    const id = window.setTimeout(() => setAlert(""), 6000);
    return () => window.clearTimeout(id);
  }, [alert]);

  function showAlert(text: string) {
    setAlert(text);
    setMessage(text);
  }

  useEffect(() => {
    const dirty = session?.is_dirty() ? "*" : "";
    document.title = view === "focus" && note ? `${dirty}${note.title} — Papel` : "Papel";
  }, [note, view, tick, session]);

  function bump(next?: Place | null) {
    if (next) focusRef.current = next;
    setTick((n) => n + 1);
  }

  function touch(id: string | null) {
    if (!id) return;
    const at = Date.now();
    setNotes((list) => {
      const meta = list.find((n) => n.id === id);
      if (!meta || at - meta.edited < 15_000) return list;
      return list.map((n) => (n.id === id ? { ...n, edited: at } : n));
    });
  }

  function edited() {
    touch(activeRef.current);
    setTick((n) => n + 1);
  }

  function activate(id: string, caretAtEnd = false) {
    const s = sessions.get(id);
    setActiveId(id);
    setView("focus");
    setSelectedImage(null);
    setMessage("");
    anchor.current = null;
    if (s) {
      const items = outlineOf(s).filter((i) => i.kind === "text");
      const target = caretAtEnd ? items[items.length - 1] : items[0];
      const blockId = target?.id ?? s.first_text_id();
      const pos = caretAtEnd ? s.text_of(blockId).length : 0;
      setSel({ blockId, start: pos, end: pos });
      focusRef.current = { block_id: blockId, start: pos, end: pos };
    }
    setTick((n) => n + 1);
  }

  function toBoard() {
    setView("board");
    setFindOpen(false);
    setSelectedImage(null);
  }

  function insertAfter(afterId: string, newId: string) {
    setOrder((list) => {
      const at = list.indexOf(afterId);
      if (at < 0) return [...list, newId];
      const copy = list.slice();
      copy.splice(at + 1, 0, newId);
      return copy;
    });
  }

  function createNote() {
    if (folderGate) {
      setMessage("Choose a folder first so sheets can be saved.");
      return;
    }
    const fresh = blankNote(notesRef.current.map((n) => n.title));
    setNotes((list) => [...list, fresh]);
    setOrder((list) => [...list, fresh.id]);
    activate(fresh.id);
    const s = sessions.get(fresh.id);
    if (s) {
      void writeNoteToFolder(fresh, s).then((disk) => {
        if (disk) setDiskName(fresh.id, disk);
      });
    }
  }

  /** Blank sheet placed under the given card. */
  function createNoteBelow(afterId: string) {
    if (folderGate) {
      setMessage("Choose a folder first so sheets can be saved.");
      return;
    }
    const fresh = blankNote(notesRef.current.map((n) => n.title));
    setNotes((list) => [...list, fresh]);
    insertAfter(afterId, fresh.id);
    activate(fresh.id);
    const s = sessions.get(fresh.id);
    if (s) {
      void writeNoteToFolder(fresh, s).then((disk) => {
        if (disk) setDiskName(fresh.id, disk);
      });
    }
  }

  /** Full copy of a sheet, placed under the original. */
  function duplicateNote(id: string) {
    if (folderGate) {
      setMessage("Choose a folder first so sheets can be saved.");
      return;
    }
    const meta = notesRef.current.find((n) => n.id === id);
    const copy = duplicateSession(id, meta?.looks ?? {});
    if (!meta || !copy) {
      showAlert("Could not duplicate that sheet.");
      return;
    }
    const session = copy.session;
    const freshId = crypto.randomUUID();
    sessions.set(freshId, session);
    const titles = notesRef.current.map((n) => n.title);
    const fresh: NoteMeta = {
      id: freshId,
      title: uniqueTitle(copyTitle(meta.title, titles), titles),
      wrap: meta.wrap,
      edited: Date.now(),
      sourceExt: meta.sourceExt,
      looks: copy.looks,
    };
    setNotes((list) => [...list, fresh]);
    insertAfter(id, freshId);
    activate(freshId);
    void writeNoteToFolder(fresh, session).then((disk) => {
      if (disk) setDiskName(freshId, disk);
    });
    setMessage(`Duplicated as ${fresh.title}`);
  }

  function closeNote(id: string) {
    const s = sessions.get(id);
    const meta = notesRef.current.find((n) => n.id === id);
    const run = () => {
      const disk = meta?.diskName;
      const dir = folderRef.current;
      if (disk && dir && folderOkRef.current) {
        void removeFolderFile(dir, disk);
      }
      sessions.delete(id);
      dropUrls(id);
      forgetCard(id);
      const nextOrder = orderRef.current.filter((item) => item !== id);
      setNotes((list) => list.filter((item) => item.id !== id));
      setOrder(nextOrder);
      if (activeRef.current === id) {
        setActiveId(nextOrder[0] ?? null);
        toBoard();
      }
      setTick((n) => n + 1);
    };
    if (s?.is_dirty()) {
      setAsk({
        title: "Close this sheet?",
        body: `${meta?.title ?? "This sheet"} will be removed from the board${meta?.diskName ? ` and ${meta.diskName} will be deleted from your folder` : ""}.`,
        confirm: "Close",
        tone: "danger",
        run,
      });
      return;
    }
    run();
  }

  function rename(id: string, title: string) {
    const taken = notesRef.current.filter((n) => n.id !== id).map((n) => n.title);
    const next = uniqueTitle(title.trim() || "Untitled", taken);
    const prev = notesRef.current.find((n) => n.id === id);
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, title: next } : n)));
    const s = sessions.get(id);
    if (prev && s) {
      const updated = { ...prev, title: next };
      void writeNoteToFolder(updated, s, prev.diskName).then((disk) => {
        if (disk) setDiskName(id, disk);
      });
    }
  }

  function moveNote(id: string, delta: number) {
    setOrder((list) => {
      const from = list.indexOf(id);
      const to = Math.max(0, Math.min(list.length - 1, from + delta));
      if (from < 0 || from === to) return list;
      const copy = list.slice();
      copy.splice(from, 1);
      copy.splice(to, 0, id);
      return copy;
    });
  }

  function reorder(id: string, beforeId: string) {
    setOrder((list) => {
      const from = list.indexOf(id);
      const to = list.indexOf(beforeId);
      if (from < 0 || to < 0 || from === to) return list;
      const copy = list.slice();
      copy.splice(from, 1);
      copy.splice(to, 0, id);
      return copy;
    });
  }

  function toggleWrap() {
    if (!activeId) return;
    setNotes((list) => list.map((n) => (n.id === activeId ? { ...n, wrap: !n.wrap } : n)));
  }

  /**
   * Download save. New sheets → `.papel`. Opened plain files keep their type.
   * Folder sync already keeps a live copy when a folder is linked.
   */
  function saveNote(id: string | null, requested?: string) {
    const s = id ? sessions.get(id) : null;
    const meta = notesRef.current.find((n) => n.id === id);
    if (!s || !meta) return;
    const rich = sessionRich(s);
    const ext = requested ?? defaultSaveExt({ sourceExt: meta.sourceExt });
    if (rich && ext !== "papel") {
      setAsk({
        title: "Save text only?",
        body: `A .${ext} file cannot keep pasted images, colors, highlights or tables. The words are saved; everything else stays on this sheet.`,
        confirm: "Save text",
        run: () => writeText(ext),
      });
      return;
    }
    if (ext === "papel") writePapel();
    else writeText(ext);

    function writeText(as: string) {
      if (!s || !meta) return;
      try {
        const name = safeName(meta.title, as);
        download(name, s.export_bytes(), mimeForExtension(as));
        s.mark_clean();
        setMessage(`Saved ${name}`);
        setTick((n) => n + 1);
      } catch (err) {
        showAlert(err instanceof Error ? err.message : "Could not encode this file.");
      }
    }
    function writePapel() {
      if (!s || !meta) return;
      const name = safeName(meta.title, "papel");
      download(name, toPapel(s, meta.looks ?? {}), "application/json");
      s.mark_clean();
      setMessage(`Saved ${name}`);
      setTick((n) => n + 1);
    }
  }

  /**
   * Applies a paragraph style or face to one text block. The look is presentation,
   * not content, so it lives on the note meta and is written into each .papel block;
   * it is deliberately not part of the core's undo history.
   */
  function setBlockLook(blockId: number, patch: BlockLook) {
    const id = activeRef.current;
    if (!id) return;
    setNotes((list) =>
      list.map((n) => {
        if (n.id !== id) return n;
        const looks = { ...(n.looks ?? {}) };
        const key = String(blockId);
        const next = { ...(looks[key] ?? {}), ...patch };
        if (!next.font) delete next.font;
        if (!next.style) delete next.style;
        if (next.font || next.style) looks[key] = next;
        else delete looks[key];
        return { ...n, looks: Object.keys(looks).length ? looks : undefined };
      }),
    );
    sessions.get(id)?.mark_dirty();
    edited();
  }
  async function importBackup(file: File) {
    const text = await file.text();
    const archive = parseArchive(text);
    if (!archive) {
      showAlert("That file is not a Papel backup.");
      return;
    }
    const existing = new Set(notesRef.current.map((n) => n.id));
    const { imported, skipped, notes: incoming } = mergeArchive(archive, existing);
    if (!incoming.length) {
      setMessage(`Imported 0, skipped ${skipped}`);
      return;
    }
    const metas: NoteMeta[] = [];
    const ids: string[] = [];
    for (const note of incoming) {
      const restored = sessionFromArchiveNote(note);
      sessions.set(note.id, restored.session);
      const taken = [...notesRef.current, ...metas].map((n) => n.title);
      metas.push({
        id: note.id,
        title: uniqueTitle(note.title, taken),
        wrap: note.wrap,
        edited: note.edited ?? Date.now(),
        sourceExt: note.sourceExt,
        looks: Object.keys(restored.looks).length ? restored.looks : undefined,
      });
      ids.push(note.id);
    }
    setNotes((curr) => [...curr, ...metas]);
    setOrder((curr) => [...curr, ...ids]);
    for (const meta of metas) {
      const s = sessions.get(meta.id);
      if (!s) continue;
      void writeNoteToFolder(meta, s).then((disk) => {
        if (disk) setDiskName(meta.id, disk);
      });
    }
    setMessage(`Imported ${imported}, skipped ${skipped}`);
    setTick((n) => n + 1);
  }

  async function openFiles(files: FileList | File[]) {
    if (folderGate) {
      setMessage("Choose a folder first so sheets can be saved.");
      return;
    }
    let first: string | null = null;
    const pending: NoteMeta[] = [];
    for (const file of [...files]) {
      if (!canOpenFile(file.name)) {
        showAlert(`${file.name}: not a type Papel can open.`);
        continue;
      }
      const stem = titleFromFilename(file.name);
      const taken = [...notesRef.current, ...pending].map((n) => n.title);
      const title = uniqueTitle(stem, taken);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = crypto.randomUUID();
      const s = createSession();
      const lower = file.name.toLowerCase();
      const sourceExt = extFromFilename(file.name) ?? undefined;
      const plainExt = sourceExt === "papel" || sourceExt === "quire" ? undefined : sourceExt;
      let importedLooks: Record<string, BlockLook> = {};
      if (lower.endsWith(".papel") || lower.endsWith(".quire")) {
        if (!fromPapel(s, bytes, importedLooks)) {
          showAlert(`${file.name} is not a Papel file.`);
          continue;
        }
      } else {
        s.open_bytes(bytes);
        const hinted = langFromFilename(file.name);
        if (hinted && hinted !== "plain") s.force_language(hinted);
      }
      s.mark_clean();
      sessions.set(id, s);
      const meta: NoteMeta = {
        id,
        title,
        wrap: true,
        edited: file.lastModified || Date.now(),
        sourceExt: plainExt,
        looks: Object.keys(importedLooks).length ? importedLooks : undefined,
      };
      pending.push(meta);
      first = first ?? id;
    }
    if (!pending.length) return;
    setNotes((curr) => [...curr, ...pending]);
    setOrder((curr) => [...curr, ...pending.map((n) => n.id)]);
    for (const meta of pending) {
      const s = sessions.get(meta.id);
      if (!s) continue;
      void writeNoteToFolder(meta, s).then((disk) => {
        if (disk) setDiskName(meta.id, disk);
      });
    }
    if (first) activate(first);
  }

  async function insertImageFile(file: File, from: "picker" | "paste" = "picker") {
    if (!session || !activeId) return;
    if (!file.type.startsWith("image/")) {
      showAlert("That file is not an image.");
      return;
    }
    if (file.size > 12_000_000) {
      showAlert("Images over 12 MB are refused.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blockId = selRef.current.blockId || session.first_text_id();
    const at = selRef.current.start;
    const before = new Set(outlineOf(session).filter((i) => i.kind === "image").map((i) => i.id));
    const next = session.insert_image_caret(blockId, at, file.type, bytes);
    if (!next) {
      showAlert("Could not place that image.");
      return;
    }
    const added = outlineOf(session).find((i) => i.kind === "image" && !before.has(i.id));
    if (added) imageUrl(activeId, added.id, session);
    setSel({ blockId: next.block_id, start: next.start, end: next.start });
    setMessage(from === "paste" ? "Image pasted onto the sheet." : "Image inserted");
    touch(activeId);
    bump({ block_id: next.block_id, start: next.start, end: next.end });
  }

  function deleteTable(tableId: number) {
    if (!session || !activeId) return;
    const next = session.delete_table(tableId);
    if (!next) return;
    touch(activeId);
    setSel({ blockId: next.block_id, start: next.start, end: next.start });
    bump({ block_id: next.block_id, start: next.start, end: next.end });
  }

  function deleteImage(imageId: number) {
    if (!session || !activeId) return;
    const next = session.delete_image(imageId);
    dropUrls(activeId, imageId);
    setSelectedImage(null);
    touch(activeId);
    if (next) {
      setSel({ blockId: next.block_id, start: next.start, end: next.start });
      bump({ block_id: next.block_id, start: next.start, end: next.end });
    } else bump();
  }

  function insertDate(style: DateStampStyle = "local") {
    if (!session) return;
    const { blockId: b, start, end } = selRef.current;
    const blockId = b || session.first_text_id();
    const stamp = fileStamp(style);
    const before = start > 0 ? session.text_of(blockId).slice(start - 1, start) : "";
    const insert = before && !/\s/.test(before) ? ` ${stamp}` : stamp;
    session.edit(blockId, start, end, insert, false);
    const pos = start + insert.length;
    setSel({ blockId, start: pos, end: pos });
    touch(activeId);
    bump({ block_id: blockId, start: pos, end: pos });
  }

  /** 1-based index of `hit` among all matches for the current query. */
  function findMatchIndex(query: string, matchCase: boolean, hit: Place): number {
    if (!session) return 0;
    let index = 0;
    for (const item of outlineOf(session).filter((i) => i.kind === "text")) {
      let from = 0;
      const len = session.text_of(item.id).length;
      while (from <= len) {
        const m = session.find(query, matchCase, item.id, from, false);
        if (!m || m.block_id !== item.id) break;
        index += 1;
        if (m.block_id === hit.block_id && m.start === hit.start && m.end === hit.end) return index;
        const next = m.end > from ? m.end : from + 1;
        if (next <= from) break;
        from = next;
      }
    }
    return index;
  }

  /** Inserts a monospace table skeleton as text: one edit, one undo step. */
  function insertTable(rows: number, cols: number) {
    if (!session) return;
    const after = selRef.current.blockId || session.first_text_id();
    const id = session.insert_table(after, cols, rows);
    setSel({ blockId: id, start: 0, end: 0 });
    touch(activeId);
    bump();
  }

  /** Adds or removes `• ` on the lines the selection covers. */
  function toggleBulletList() {
    if (!session) return;
    const { blockId: b, start, end } = selRef.current;
    const blockId = b || session.first_text_id();
    const change = toggleBullets(session.text_of(blockId), start, end);
    session.edit(blockId, change.start, change.end, change.insert, false);
    const pos = change.start + change.insert.length;
    setSel({ blockId, start: pos, end: pos });
    touch(activeId);
    bump({ block_id: blockId, start: pos, end: pos });
  }

  function doUndo(redo: boolean) {
    if (!session) return;
    const next = redo ? session.redo() : session.undo();
    if (!next) return;
    anchor.current = null;
    setSel({ blockId: next.block_id, start: next.start, end: next.start });
    bump({ block_id: next.block_id, start: next.start, end: next.end });
  }

  function findMove(back: boolean) {
    if (!session || !findQuery) {
      setFindStatus("—");
      return;
    }
    const cur = selRef.current;
    const block = anchor.current?.block_id || cur.blockId || session.first_text_id();
    const pos = anchor.current ? (back ? anchor.current.start : anchor.current.end) : back ? cur.start : cur.end;
    let hit = session.find(findQuery, matchCase, block, pos, back);
    if (!hit) {
      const ids = outlineOf(session).filter((i) => i.kind === "text");
      const edge = back ? ids[ids.length - 1] : ids[0];
      if (edge) {
        const from = back ? session.text_of(edge.id).length : 0;
        hit = session.find(findQuery, matchCase, edge.id, from, back);
      }
    }
    const count = session.find_count(findQuery, matchCase);
    if (!hit || count === 0) {
      anchor.current = null;
      setFindStatus("0/0");
      return;
    }
    const place = { block_id: hit.block_id, start: hit.start, end: hit.end };
    anchor.current = place;
    setSel({ blockId: hit.block_id, start: hit.start, end: hit.end });
    const index = findMatchIndex(findQuery, matchCase, place);
    setFindStatus(`${index}/${count}`);
    bump(place);
    // Refocus Find so Enter keeps searching; selection highlight lives on the overlay.
    window.setTimeout(() => findRef.current?.focus(), 0);
  }

  function replaceOne() {
    if (!session || !findQuery) return;
    const hit = anchor.current;
    if (!hit) {
      findMove(false);
      return;
    }
    session.edit(hit.block_id, hit.start, hit.end, repl, false);
    anchor.current = { block_id: hit.block_id, start: hit.start, end: hit.start + repl.length };
    touch(activeId);
    bump(anchor.current);
    findMove(false);
  }

  function replaceAll() {
    if (!session || !findQuery) return;
    const count = session.replace_all(findQuery, repl, matchCase);
    anchor.current = null;
    setFindStatus(count ? `Replaced ${count}.` : "No matches.");
    if (count) touch(activeId);
    bump();
  }

  function jumpLine() {
    if (!session) return;
    const n = Number.parseInt(line, 10);
    if (!Number.isFinite(n)) return;
    const next = session.line_to_caret(n);
    const total = session.metrics(session.first_text_id(), 0)[2] ?? 1;
    if (n > total) setFindStatus(`File has ${total} lines`);
    setSel({ blockId: next.block_id, start: next.start, end: next.start });
    bump({ block_id: next.block_id, start: next.start, end: next.end });
  }

  function openFind() {
    setFindOpen(true);
    window.setTimeout(() => findRef.current?.focus(), 0);
  }

  function applyStyle(kind: string, value: number) {
    if (!session) return;
    // A focused table cell takes the style, not the page text behind it.
    if (cellTarget) {
      const { tableId, row, col, start, end } = cellTarget;
      if (end <= start) {
        setMessage("Select some text first.");
        return;
      }
      if (session.table_style(tableId, row, col, start, end, kind, value)) {
        touch(activeId);
        bump();
      }
      return;
    }
    const { blockId, start, end } = selRef.current;
    if (end <= start) {
      setMessage("Select some text first.");
      return;
    }
    if (session.apply_style(blockId, start, end, kind, value)) touch(activeId);
    bump({ block_id: blockId, start, end });
  }

  function toggleFlag(flag: FlagName) {
    if (!session) return;
    if (cellTarget) {
      const runs = readMarks(session.table_marks(cellTarget.tableId, cellTarget.row, cellTarget.col));
      const on = rangeHas(runs, cellTarget.start, cellTarget.end, FLAG[flag]);
      applyStyle(flag, on ? 0 : 1);
      return;
    }
    const { blockId, start, end } = selRef.current;
    const on = rangeHas(readMarks(session.marks(blockId)), start, end, FLAG[flag]);
    applyStyle(flag, on ? 0 : 1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inEditor = el?.tagName === "TEXTAREA" && el.classList.contains("editor");
      const field = el?.tagName === "INPUT" || el?.tagName === "SELECT" || (el?.tagName === "TEXTAREA" && !inEditor);
      const meta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (ask) setAsk(null);
        else if (findOpen) setFindOpen(false);
        else if (view === "focus" && !field) toBoard();
        return;
      }
      if (meta && key === "n") {
        e.preventDefault();
        createNote();
        return;
      }
      if (meta && key === "o") {
        e.preventDefault();
        fileRef.current?.click();
        return;
      }
      if (meta && key === "f") {
        e.preventDefault();
        if (view === "focus") openFind();
        else searchRef.current?.focus();
        return;
      }
      if (view !== "focus") return;
      if (meta && key === "s") {
        e.preventDefault();
        saveNote(activeRef.current);
        return;
      }
      if (meta && (key === "h" || key === "g")) {
        e.preventDefault();
        openFind();
        return;
      }
      if (field) return;
      if (inEditor && meta && !e.altKey) {
        const flag: FlagName | null =
          key === "b" && !e.shiftKey
            ? "bold"
            : key === "i" && !e.shiftKey
              ? "italic"
              : key === "u" && !e.shiftKey
                ? "underline"
                : key === "x" && e.shiftKey
                  ? "strike"
                  : null;
        if (flag) {
          e.preventDefault();
          toggleFlag(flag);
          return;
        }
      }
      if (e.key === "F5") {
        e.preventDefault();
        insertDate();
      } else if (meta && key === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo(false);
      } else if (meta && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        doUndo(true);
      } else if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((z) => Math.min(28, z + 1));
      } else if (meta && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(12, z - 1));
      } else if (meta && e.key === "0") {
        e.preventDefault();
        setZoom(16);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (failed) {
    return (
      <div className="desk" data-skin="ink">
        <main className="desk-body">
          <div className="empty-sheet">
            <h2>The sheet did not open</h2>
            <p>{failed}</p>
          </div>
        </main>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="desk" data-skin={skin}>
        <main className="desk-body">
          <p className="boot-line">Opening a fresh sheet…</p>
        </main>
      </div>
    );
  }

  const metaById = new Map(notes.map((n) => [n.id, n]));
  const infoFor = (id: string) => cardInfo(id, id === activeId ? `a:${cardTick}` : `s:${metaById.get(id)?.edited ?? 0}`);
  const trimmed = query.trim();
  const applied = trimmed.length >= MIN_QUERY ? trimmed : committed;
  const hits = applied
    ? searchNotes(
        applied,
        order.map((id) => ({ id, title: metaById.get(id)?.title ?? "", text: infoFor(id)?.text ?? "" })),
      )
    : null;
  const snippets = new Map(hits?.filter((h) => h.snippet).map((h) => [h.id, h.snippet]) ?? []);
  let visible = hits ? hits.map((h) => h.id) : order.slice();
  if (!hits && sort === "recent") visible.sort((a, b) => (metaById.get(b)?.edited ?? 0) - (metaById.get(a)?.edited ?? 0));
  if (!hits && sort === "title") visible.sort((a, b) => (metaById.get(a)?.title ?? "").localeCompare(metaById.get(b)?.title ?? ""));
  const canReorder = sort === "manual" && !hits;
  const unsaved = order.filter((id) => sessions.get(id)?.is_dirty()).length;
  const hint =
    trimmed && trimmed.length < MIN_QUERY && !committed
      ? `Type ${MIN_QUERY}+ letters, or Enter`
      : hits
        ? `${visible.length} ${visible.length === 1 ? "match" : "matches"}`
        : "";

  const cardActions: CardActions = {
    open: (id) => activate(id),
    rename,
    save: (id) => saveNote(id),
    newBelow: createNoteBelow,
    duplicate: duplicateNote,
    close: closeNote,
    move: moveNote,
    reorder,
  };

  const blockId = sel.blockId || session?.first_text_id() || 0;
  const metrics = session ? session.metrics(blockId, sel.start) : [1, 1, 1, 0];
  // Which kind of block holds the caret: the toolbar shows Delete table only for one.
  const activeBlock = session ? outlineOf(session).find((item) => item.id === sel.blockId) : undefined;
  const richNow = session ? sessionRich(session) : false;
  const saveExts = note ? saveExtensions({ rich: richNow, sourceExt: note.sourceExt }) : ["papel"];
  const saveExt = saveExts[0] ?? "papel";
  const rest = cellTarget
    ? { start: cellTarget.start, end: cellTarget.end }
    : { start: sel.start, end: sel.end };
  const marksNow = cellTarget && session
    ? readMarks(session.table_marks(cellTarget.tableId, cellTarget.row, cellTarget.col))
    : session && sel.end > sel.start
      ? readMarks(session.marks(blockId))
      : [];
  const at = marksNow.find((m) => m.start <= rest.start && m.end > rest.start);
  const styles: StyleState = {
    hasSelection: rest.end > rest.start,
    active: {
      bold: rangeHas(marksNow, rest.start, rest.end, FLAG.bold),
      italic: rangeHas(marksNow, rest.start, rest.end, FLAG.italic),
      underline: rangeHas(marksNow, rest.start, rest.end, FLAG.underline),
      strike: rangeHas(marksNow, rest.start, rest.end, FLAG.strike),
    },
    ink: at?.ink ?? 0,
    hl: at?.hl ?? 0,
    toggle: toggleFlag,
    setInk: (ink) => applyStyle("ink", ink),
    setHl: (hl) => applyStyle("hl", hl),
    clear: () => applyStyle("clear", 0),
  };
  const find: FindState = {
    open: findOpen,
    query: findQuery,
    setQuery: (v) => {
      setFindQuery(v);
      anchor.current = null;
      // Mid-edit: reset cycle; show total until Enter picks match 1/N.
      if (!v) setFindStatus("—");
      else if (session) {
        const count = session.find_count(v, matchCase);
        setFindStatus(count ? `1/${count}` : "0/0");
      } else setFindStatus("—");
    },
    repl,
    setRepl,
    matchCase,
    setMatchCase,
    line,
    setLine,
    status: findStatus,
    inputRef: findRef,
    move: findMove,
    replaceOne,
    replaceAll,
    jump: jumpLine,
    close: () => setFindOpen(false),
  };
  const sheetActions: SheetActions = {
    back: toBoard,
    rename: (title) => activeId && rename(activeId, title),
    undo: () => doUndo(false),
    redo: () => doUndo(true),
    find: () => (findOpen ? setFindOpen(false) : openFind()),
    date: insertDate,
    image: () => imageRef.current?.click(),
    wrap: toggleWrap,
    save: (ext) => saveNote(activeId, ext),
    table: insertTable,
    bullets: toggleBulletList,
    close: () => activeId && closeNote(activeId),
    deleteImage,
    deleteTable,
    look: setBlockLook,
  };

  const boardStamp = [
    cardTick,
    visible.join(","),
    view === "focus" ? activeId : "",
    skinMeta.edge,
    canReorder,
    now,
    notes.map((n) => `${n.title}:${n.edited}`).join("|"),
    [...snippets.values()].join("|"),
    unsaved,
  ].join("?");

  const board = (compact: boolean) => (
    <Board
      stamp={`${compact}?${boardStamp}`}
      ids={visible}
      notes={metaById}
      info={infoFor}
      snippets={snippets}
      activeId={view === "focus" ? activeId : null}
      compact={compact}
      edge={skinMeta.edge}
      canReorder={canReorder}
      actions={cardActions}
      now={now}
    />
  );

  return (
    <div
      className="desk"
      data-skin={skin}
      data-view={view}
      style={{ ["--editor-size" as string]: `${zoom}px` }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void openFiles(e.dataTransfer.files);
      }}
    >
      <HeaderStrip
        view={view}
        current={view === "focus" && note ? note.title : "Board"}
        currentId={view === "focus" ? activeId : null}
        items={order.map((id) => ({
          id,
          title: metaById.get(id)?.title ?? "Untitled",
          dirty: sessions.get(id)?.is_dirty() ?? false,
        }))}
        onBoard={toBoard}
        onSwitch={(id) => activate(id)}
        query={query}
        setQuery={(v) => {
          setQuery(v);
          setCommitted("");
        }}
        onGo={() => {
          setCommitted(trimmed);
        }}
        searchRef={searchRef}
        hint={hint}
        sort={sort}
        setSort={setSort}
        onNew={createNote}
        onOpen={() => fileRef.current?.click()}
        skin={skin}
        setSkin={setSkin}
        autocorrect={autocorrect}
        setAutocorrect={setAutocorrect}
        lastBackup={formatLastBackup(lastBackup)}
        onExportAll={() => {
          const archive = buildArchive(notesRef.current, orderRef.current);
          const name = archiveFileName();
          download(name, JSON.stringify(archive), "application/json");
          const iso = archive.exportedAt;
          setLastBackup(iso);
          setMessage(`Exported ${archive.notes.length} sheets`);
        }}
        onExportZip={() => {
          const archive = buildArchive(notesRef.current, orderRef.current);
          const json = JSON.stringify(archive);
          const bytes = buildZip([
            { name: archiveFileName(), data: new TextEncoder().encode(json) },
          ]);
          download(zipBackupFileName(), bytes, "application/zip");
          setLastBackup(archive.exportedAt);
          setMessage(`Exported zip with ${archive.notes.length} sheets`);
        }}
        onImportBackup={() => backupRef.current?.click()}
        folderSupported={canPickFolder()}
        folderName={folderName}
        onPickFolder={() => {
          void pickSyncFolder()
            .then((handle) => {
              if (!handle) return;
              void linkFolder(handle).then(() => setMessage(`Syncing sheets to ${handle.name}`));
            })
            .catch(() => showAlert("Could not open that folder."));
        }}
        session={session}
        metrics={metrics}
        zoom={zoom}
        message={message}
        total={order.length}
        unsaved={unsaved}
        shown={visible.length}
        onChanged={() => bump()}
        onMessage={setMessage}
      />

      <main className="desk-body">
        {view === "board" ? (
          order.length === 0 ? (
            <div className="empty-sheet">
              <h2>A blank sheet.</h2>
              <p>Start a sheet, open a file, or drop one anywhere on the desk.</p>
              <button type="button" className="btn primary" onClick={createNote}>
                New sheet
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-sheet">
              <h2>Nothing matches.</h2>
              <p>
                No sheet fits {applied ? <>“{applied}”</> : "this filter"}. Try fewer letters, or clear the
                filters.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery("");
                  setCommitted("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            board(false)
          )
        ) : (
          <div className="focus">
            <aside className="side" aria-label="Sheets">
              {visible.length ? board(true) : <p className="side-empty">No sheet matches the search.</p>}
            </aside>
            {session && note ? (
              <Sheet
                note={note}
                session={session}
                edge={skinMeta.edge}
                pattern={skinMeta.pattern}
                tick={tick}
                focusRef={focusRef}
                autocorrect={autocorrect}
                selectedImage={selectedImage}
                setSelectedImage={setSelectedImage}
                onSelection={(b, start, end) =>
                  setSel((prev) =>
                    prev.blockId === b && prev.start === start && prev.end === end ? prev : { blockId: b, start, end },
                  )
                }
                onEdited={edited}
                onCellSelect={setCellTarget}
                onImage={(file) => void insertImageFile(file, "paste")}
                styles={styles}
                find={find}
                findHit={
                  findOpen && sel.end > sel.start
                    ? { blockId: sel.blockId, start: sel.start, end: sel.end }
                    : null
                }
                saveExt={saveExt}
                saveExts={saveExts}
                looks={note.looks ?? {}}
                activeBlockId={sel.blockId ?? null}
                activeKind={activeBlock ? activeBlock.kind : null}
                actions={sheetActions}
              />
            ) : (
              <div className="empty-sheet">
                <h2>A blank sheet.</h2>
                <button type="button" className="btn primary" onClick={createNote}>
                  New sheet
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept={FILE_ACCEPT}
        onChange={(e) => {
          if (e.target.files) void openFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={backupRef}
        type="file"
        hidden
        accept={`.${ARCHIVE_EXT},application/json`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importBackup(file);
          e.target.value = "";
        }}
      />
      <input
        ref={imageRef}
        type="file"
        hidden
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void insertImageFile(file);
          e.target.value = "";
        }}
      />

      {alert && (
        <div className="toast" role="alert">
          {alert}
        </div>
      )}

      {folderGate && canPickFolder() && (
        <div className="modal-back">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-gate-title"
          >
            <h2 id="folder-gate-title">Choose a folder for your sheets</h2>
            <p>
              Papel saves every note as a file on your computer. Pick a folder once — new sheets
              (like Untitled 2.papel) appear there automatically, and the app remembers this folder
              next time.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn primary"
                autoFocus
                onClick={() => {
                  void (async () => {
                    try {
                      if (folderRef.current && (await verifyFolderPermission(folderRef.current, true))) {
                        await linkFolder(folderRef.current);
                        setMessage(`Syncing sheets to ${folderRef.current.name}`);
                        return;
                      }
                      const handle = await pickSyncFolder();
                      if (handle) {
                        await linkFolder(handle);
                        setMessage(`Syncing sheets to ${handle.name}`);
                      }
                    } catch {
                      showAlert("Could not open that folder.");
                    }
                  })();
                }}
              >
                Choose folder…
              </button>
            </div>
          </div>
        </div>
      )}

      {ask && (
        <div className="modal-back" onMouseDown={() => setAsk(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="ask-title">{ask.title}</h2>
            <p>{ask.body}</p>
            <div className="modal-actions">
              <button type="button" className="btn primary" autoFocus onClick={() => setAsk(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className={ask.tone === "danger" ? "btn danger" : "btn"}
                onClick={() => {
                  const run = ask.run;
                  setAsk(null);
                  run();
                }}
              >
                {ask.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


