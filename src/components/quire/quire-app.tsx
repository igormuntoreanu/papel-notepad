import {
  Braces,
  Clock,
  FilePlus,
  FolderOpen,
  Hash,
  ImagePlus,
  Menu,
  Moon,
  Plus,
  Redo2,
  Save,
  Search,
  Sun,
  Undo2,
  WrapText,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { bootEngine, createSession, type Session } from "@/lib/quire/engine";
import { loadPersisted, savePersisted, type Persisted, type Prefs, type StoredBlock } from "@/lib/quire/persist";
import {
  base64ToBytes,
  bytesToBase64,
  copyBytes,
  diffText,
  download,
  fileStamp,
  langFromFilename,
  langLabel,
  LANGUAGES,
  paint,
  safeName,
  SKINS,
  type SkinId,
} from "@/lib/quire/text";

type NoteMeta = { id: string; title: string; wrap: boolean };
type OutlineItem = { id: number; kind: string; mime: string };
type Place = { block_id: number; start: number; end: number };
type Ask = { title: string; body: string; confirm: string; tone?: "danger"; run: () => void };
type Loaded = { notes: NoteMeta[]; order: string[]; activeId: string | null; prefs: Prefs };

const sessions = new Map<string, Session>();
const urls = new Map<string, string>();
let loadedCache: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

function outlineOf(session: Session): OutlineItem[] {
  return JSON.parse(session.outline()) as OutlineItem[];
}

function imageUrl(noteId: string, imageId: number, session: Session): string {
  const key = `${noteId}:${imageId}`;
  const hit = urls.get(key);
  if (hit) return hit;
  const bytes = session.image_of(imageId);
  const mime = session.mime_of(imageId) || "image/png";
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
  urls.set(key, url);
  return url;
}

function nextTitle(titles: string[]): string {
  if (!titles.includes("Untitled")) return "Untitled";
  let n = 2;
  while (titles.includes(`Untitled ${n}`)) n += 1;
  return `Untitled ${n}`;
}

function blankNote(titles: string[]): NoteMeta {
  const id = crypto.randomUUID();
  sessions.set(id, createSession());
  return { id, title: nextTitle(titles), wrap: true };
}

async function ensureLoaded() {
  if (loadedCache) return loadedCache;
  if (!loading) {
    loading = (async () => {
      await bootEngine();
      const { doc, prefs } = await loadPersisted();
      const notes: NoteMeta[] = [];
      const order: string[] = [];
      if (doc && doc.notes.length > 0) {
        const byId = new Map(doc.notes.map((n) => [n.id, n]));
        const ids = doc.order.length ? doc.order : doc.notes.map((n) => n.id);
        for (const id of ids) {
          const stored = byId.get(id);
          if (!stored) continue;
          const session = createSession();
          session.restore_begin();
          for (const block of stored.blocks) {
            if (block.kind === "text") session.restore_text(block.text);
            else session.restore_image(block.mime, new Uint8Array(block.bytes));
          }
          session.restore_end(stored.language, stored.eol, stored.encoding);
          sessions.set(id, session);
          notes.push({ id, title: stored.title, wrap: stored.wrap });
          order.push(id);
        }
      }
      if (notes.length === 0) {
        const note = blankNote([]);
        notes.push(note);
        order.push(note.id);
      }
      const mode =
        prefs?.mode ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day");
      loadedCache = {
        notes,
        order,
        activeId: doc?.activeId && order.includes(doc.activeId) ? doc.activeId : order[0]!,
        prefs: {
          skin: prefs?.skin ?? "paper",
          mode,
          zoom: prefs?.zoom && prefs.zoom >= 12 && prefs.zoom <= 28 ? prefs.zoom : 16,
        },
      };
      return loadedCache;
    })();
  }
  return loading;
}

function snapshot(notes: NoteMeta[], order: string[], activeId: string | null): Persisted {
  return {
    activeId,
    order,
    notes: order
      .map((id) => {
        const meta = notes.find((n) => n.id === id);
        const session = sessions.get(id);
        if (!meta || !session) return null;
        const blocks: StoredBlock[] = outlineOf(session).map((item) => {
          if (item.kind === "image") {
            return { kind: "image", mime: item.mime || "image/png", bytes: copyBytes(session.image_of(item.id)) };
          }
          return { kind: "text", text: session.text_of(item.id) };
        });
        return {
          id,
          title: meta.title,
          wrap: meta.wrap,
          language: session.language(),
          eol: session.eol(),
          encoding: session.encoding(),
          blocks,
        };
      })
      .filter((n): n is Persisted["notes"][number] => n !== null),
  };
}

export function QuireApp() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [skin, setSkin] = useState<SkinId>("paper");
  const [mode, setMode] = useState<"day" | "night">("day");
  const [zoom, setZoom] = useState(16);
  const [tick, setTick] = useState(0);
  const [caret, setCaret] = useState({ blockId: 0, pos: 0 });
  const [drawer, setDrawer] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoVal, setGotoVal] = useState("");
  const [message, setMessage] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const focusRef = useRef<Place | null>(null);
  const anchor = useRef<Place | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef(notes);
  const orderRef = useRef(order);
  const activeRef = useRef(activeId);
  const caretRef = useRef(caret);
  notesRef.current = notes;
  orderRef.current = order;
  activeRef.current = activeId;
  caretRef.current = caret;

  const session = activeId ? sessions.get(activeId) ?? null : null;
  const note = notes.find((n) => n.id === activeId) ?? null;
  const skinMeta = SKINS.find((s) => s.id === skin) ?? SKINS[0];

  useEffect(() => {
    let cancel = false;
    void ensureLoaded()
      .then((data) => {
        if (cancel || !data) return;
        setNotes(data.notes);
        setOrder(data.order);
        setActiveId(data.activeId);
        setSkin(data.prefs.skin);
        setMode(data.prefs.mode);
        setZoom(data.prefs.zoom);
        const s = data.activeId ? sessions.get(data.activeId) : null;
        if (s) setCaret({ blockId: s.first_text_id(), pos: 0 });
        setReady(true);
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
      const prefs: Prefs = { skin, mode, zoom };
      void savePersisted(snapshot(notes, order, activeId), prefs).catch(() => {
        setMessage("Could not autosave this sheet.");
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [ready, notes, order, activeId, skin, mode, zoom, tick]);

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
  }, [tick]);

  useEffect(() => {
    const current = notes.find((n) => n.id === activeId);
    const dirty = session?.is_dirty() ? "*" : "";
    document.title = current ? `${dirty}${current.title} — Papel` : "Papel";
  }, [notes, activeId, tick, session]);

  function bump(next?: Place | null) {
    if (next) focusRef.current = next;
    setTick((n) => n + 1);
  }

  function edited() {
    setTick((n) => n + 1);
  }

  function activate(id: string) {
    setActiveId(id);
    setSelectedImage(null);
    setDrawer(false);
    const s = sessions.get(id);
    if (s) setCaret({ blockId: s.first_text_id(), pos: 0 });
    anchor.current = null;
  }

  function createNote() {
    const note = blankNote(notesRef.current.map((n) => n.title));
    setNotes((list) => [...list, note]);
    setOrder((list) => [...list, note.id]);
    activate(note.id);
    bump();
  }

  function closeNote(id: string) {
    const s = sessions.get(id);
    const meta = notesRef.current.find((n) => n.id === id);
    const run = () => {
      sessions.delete(id);
      for (const [key, url] of urls) {
        if (key.startsWith(`${id}:`)) {
          URL.revokeObjectURL(url);
          urls.delete(key);
        }
      }
      const nextOrder = orderRef.current.filter((item) => item !== id);
      const nextNotes = notesRef.current.filter((item) => item.id !== id);
      setNotes(nextNotes);
      setOrder(nextOrder);
      if (activeRef.current === id) {
        const fallback = nextOrder[0] ?? null;
        setActiveId(fallback);
        if (fallback) {
          const fs = sessions.get(fallback);
          if (fs) setCaret({ blockId: fs.first_text_id(), pos: 0 });
        }
      }
      setTick((n) => n + 1);
    };
    if (s?.is_dirty()) {
      setAsk({
        title: "Discard this sheet?",
        body: `${meta?.title ?? "This note"} has edits that were not saved to a file. Autosave on this device will drop it too.`,
        confirm: "Discard",
        tone: "danger",
        run,
      });
      return;
    }
    run();
  }

  function rename(id: string, title: string) {
    const next = title.trim() || "Untitled";
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, title: next } : n)));
    setRenaming(null);
  }

  function toggleWrap() {
    if (!activeId) return;
    setNotes((list) => list.map((n) => (n.id === activeId ? { ...n, wrap: !n.wrap } : n)));
  }

  function saveNote(asText: boolean) {
    if (!session || !note) return;
    const items = outlineOf(session);
    const hasImage = items.some((item) => item.kind === "image");
    if (hasImage && asText) {
      setAsk({
        title: "Save text only?",
        body: "A plain text file cannot keep pasted images. The words are saved; the pictures stay on this sheet.",
        confirm: "Save text",
        run: () => writeText(),
      });
      return;
    }
    if (hasImage) writeQuire();
    else writeText();

    function writeText() {
      if (!session || !note) return;
      try {
        const bytes = session.export_bytes();
        download(safeName(note.title, "txt"), bytes, "text/plain");
        session.mark_clean();
        setMessage(`Saved ${safeName(note.title, "txt")}`);
        setTick((n) => n + 1);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Could not encode this file.");
      }
    }
    function writeQuire() {
      if (!session || !note) return;
      const file = {
        format: "papel",
        version: 1,
        language: session.language(),
        eol: session.eol(),
        encoding: session.encoding(),
        blocks: items.map((item) =>
          item.kind === "image"
            ? { type: "image", mime: item.mime || "image/png", data: bytesToBase64(session.image_of(item.id)) }
            : { type: "text", text: session.text_of(item.id) },
        ),
      };
      download(safeName(note.title, "papel"), JSON.stringify(file), "application/json");
      session.mark_clean();
      setMessage(`Saved ${safeName(note.title, "papel")}`);
      setTick((n) => n + 1);
    }
  }

  async function openFiles(files: FileList | File[]) {
    const list = [...files];
    let first: string | null = null;
    for (const file of list) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = crypto.randomUUID();
      const session = createSession();
      if (file.name.toLowerCase().endsWith(".papel") || file.name.toLowerCase().endsWith(".quire")) {
        let parsed: {
          language?: string;
          eol?: string;
          encoding?: string;
          blocks?: Array<{ type: string; text?: string; mime?: string; data?: string }>;
        };
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes)) as typeof parsed;
        } catch {
          setMessage(`${file.name} is not a Papel file.`);
          continue;
        }
        session.restore_begin();
        for (const block of parsed.blocks ?? []) {
          if (block.type === "image" && block.data) session.restore_image(block.mime || "image/png", base64ToBytes(block.data));
          else session.restore_text(block.text ?? "");
        }
        session.restore_end(parsed.language || "auto", parsed.eol || "lf", parsed.encoding || "utf-8");
      } else {
        session.open_bytes(bytes);
        const hinted = langFromFilename(file.name);
        if (hinted && hinted !== "plain") session.force_language(hinted);
      }
      sessions.set(id, session);
      const meta = { id, title: file.name, wrap: true };
      setNotes((curr) => [...curr, meta]);
      setOrder((curr) => [...curr, id]);
      first = first ?? id;
    }
    if (first) activate(first);
  }

  async function insertImageFile(file: File) {
    if (!session || !activeId) return;
    if (!file.type.startsWith("image/")) {
      setMessage("That file is not an image.");
      return;
    }
    if (file.size > 12_000_000) {
      setMessage("Images over 12 MB are refused.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blockId = caretRef.current.blockId || session.first_text_id();
    const at = caretRef.current.pos;
    const before = new Set(outlineOf(session).filter((i) => i.kind === "image").map((i) => i.id));
    const next = session.insert_image_caret(blockId, at, file.type, bytes);
    if (!next) {
      setMessage("Could not place that image.");
      return;
    }
    const added = outlineOf(session).find((i) => i.kind === "image" && !before.has(i.id));
    if (added) imageUrl(activeId, added.id, session);
    focusRef.current = next;
    setCaret({ blockId: next.block_id, pos: next.start });
    setMessage("Image pasted onto the sheet.");
    setTick((n) => n + 1);
  }

  function insertDate() {
    if (!session) return;
    const blockId = caretRef.current.blockId || session.first_text_id();
    const at = caretRef.current.pos;
    const stamp = fileStamp();
    session.edit(blockId, at, at, stamp, false);
    const pos = at + stamp.length;
    const next = { block_id: blockId, start: pos, end: pos };
    focusRef.current = next;
    setCaret({ blockId, pos });
    setTick((n) => n + 1);
  }

  function runFormat() {
    if (!session) return;
    const msg = session.format_all();
    const ok = msg.startsWith("ok:");
    const text = msg.slice(ok ? 3 : 4);
    setMessage(text);
    if (ok && text !== "Already formatted.") bump();
  }

  function doUndo(redo: boolean) {
    if (!session) return;
    const next = redo ? session.redo() : session.undo();
    if (!next) return;
    anchor.current = null;
    setCaret({ blockId: next.block_id, pos: next.start });
    bump(next);
  }

  function findMove(back: boolean) {
    if (!session || !query) {
      setMessage("Type something to find.");
      return;
    }
    const block = anchor.current?.block_id || caretRef.current.blockId || session.first_text_id();
    const pos = anchor.current ? (back ? anchor.current.start : anchor.current.end) : caretRef.current.pos;
    let hit = session.find(query, matchCase, block, pos, back);
    if (!hit) {
      const ids = outlineOf(session).filter((i) => i.kind === "text");
      const edge = back ? ids[ids.length - 1] : ids[0];
      if (edge) {
        const from = back ? session.text_of(edge.id).length : 0;
        hit = session.find(query, matchCase, edge.id, from, back);
      }
    }
    const count = session.find_count(query, matchCase);
    if (!hit || count === 0) {
      anchor.current = null;
      setMessage("No matches.");
      return;
    }
    anchor.current = hit;
    setCaret({ blockId: hit.block_id, pos: hit.start });
    setMessage(`${count} found`);
    bump(hit);
  }

  function replaceOne() {
    if (!session || !query) return;
    const hit = anchor.current;
    if (!hit) {
      findMove(false);
      return;
    }
    session.edit(hit.block_id, hit.start, hit.end, repl, false);
    anchor.current = { block_id: hit.block_id, start: hit.start, end: hit.start + repl.length };
    setCaret({ blockId: hit.block_id, pos: hit.start });
    bump(anchor.current);
    findMove(false);
  }

  function replaceAll() {
    if (!session || !query) return;
    const count = session.replace_all(query, repl, matchCase);
    anchor.current = null;
    setMessage(count ? `Replaced ${count}.` : "No matches.");
    bump();
  }

  function jumpLine() {
    if (!session) return;
    const line = Number.parseInt(gotoVal, 10);
    if (!Number.isFinite(line)) return;
    const next = session.line_to_caret(line);
    setCaret({ blockId: next.block_id, pos: next.start });
    setGotoOpen(false);
    bump(next);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const field = el?.tagName === "INPUT" || (el?.tagName === "TEXTAREA" && !el.classList.contains("editor"));
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        setFindOpen(false);
        setGotoOpen(false);
        setDrawer(false);
        setAsk(null);
        return;
      }
      if (field && !(meta && ["s", "f", "n", "o", "h"].includes(e.key.toLowerCase()))) return;
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveNote(false);
      } else if (meta && e.key.toLowerCase() === "o") {
        e.preventDefault();
        fileRef.current?.click();
      } else if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNote();
      } else if (meta && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findRef.current?.focus(), 0);
      } else if (meta && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFindOpen(true);
      } else if (meta && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setGotoOpen(true);
      } else if (e.key === "F5") {
        e.preventDefault();
        insertDate();
      } else if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo(false);
      } else if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
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

  function onDragStart(id: string, event: { button: number; clientY: number; target: EventTarget | null }) {
    if (event.button !== 0) return;
    const startY = event.clientY;
    const start = orderRef.current.slice();
    const from = start.indexOf(id);
    let dragging = false;
    const move = (ev: globalThis.PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!dragging && Math.abs(dy) < 8) return;
      dragging = true;
      const shift = Math.round(dy / 44);
      const to = Math.max(0, Math.min(start.length - 1, from + shift));
      if (to === from) return;
      const copy = start.slice();
      const [item] = copy.splice(from, 1);
      if (!item) return;
      copy.splice(to, 0, item);
      setOrder(copy);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const metrics = session ? session.metrics(caret.blockId || session.first_text_id(), caret.pos) : [1, 1, 1, 0];
  const langSetting = session?.language() ?? "auto";
  const effective = session ? session.effective_language(caret.blockId || session.first_text_id()) : "plain";
  const langText = langSetting === "auto" ? `Auto · ${langLabel(effective)}` : langLabel(langSetting);

  if (failed) {
    return (
      <div className="desk" data-skin="paper" data-mode="day">
        <main className="stage">
          <div className="sheet-frame" data-edge="torn">
            <div className="sheet">
              <div className="empty">
                <h2>The sheet did not open</h2>
                <p>{failed}</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="desk" data-skin={skin} data-mode={mode}>
        <header className="toolbar">
          <span className="brand-name">Papel</span>
        </header>
        <div className="body">
          <main className="stage">
            <div className="sheet-frame" data-edge={skinMeta.edge}>
              <div className="sheet">
                <p className="boot-line">Opening a fresh sheet…</p>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className="desk"
      data-skin={skin}
      data-mode={mode}
      data-drawer={drawer ? "open" : "closed"}
      style={{ ["--editor-size" as string]: `${zoom}px` }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void openFiles(e.dataTransfer.files);
      }}
    >
      <header className="toolbar">
        <button type="button" className="tool rail-only" aria-label="Notes" onClick={() => setDrawer(true)}>
          <Menu />
        </button>
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Papel</span>
        </span>
        <button type="button" className="tool" onClick={createNote} aria-label="New note">
          <FilePlus />
          <span className="rail-only">New</span>
        </button>
        <button type="button" className="tool" aria-label="Open" onClick={() => fileRef.current?.click()}>
          <FolderOpen />
        </button>
        <button type="button" className="tool" aria-label="Save" onClick={() => saveNote(false)} disabled={!session}>
          <Save />
        </button>
        <button type="button" className="tool" aria-label="Save text only" onClick={() => saveNote(true)} disabled={!session}>
          <span>Text</span>
        </button>
        <button type="button" className="tool" aria-label="Undo" disabled={!session?.can_undo()} onClick={() => doUndo(false)}>
          <Undo2 />
        </button>
        <button type="button" className="tool" aria-label="Redo" disabled={!session?.can_redo()} onClick={() => doUndo(true)}>
          <Redo2 />
        </button>
        <button type="button" className="tool" aria-label="Autoformat" onClick={runFormat} disabled={!session}>
          <Braces />
        </button>
        <button
          type="button"
          className="tool"
          aria-label="Find and replace"
          aria-pressed={findOpen}
          onClick={() => {
            setFindOpen((v) => !v);
            window.setTimeout(() => findRef.current?.focus(), 0);
          }}
        >
          <Search />
        </button>
        <button type="button" className="tool" aria-label="Go to line" aria-pressed={gotoOpen} onClick={() => setGotoOpen((v) => !v)}>
          <Hash />
        </button>
        <button type="button" className="tool" aria-label="Insert date and time" onClick={insertDate} disabled={!session}>
          <Clock />
        </button>
        <button type="button" className="tool" aria-label="Insert image" onClick={() => imageRef.current?.click()} disabled={!session}>
          <ImagePlus />
        </button>
        <button
          type="button"
          className={note?.wrap ? "tool is-on" : "tool"}
          aria-pressed={note?.wrap ?? false}
          aria-label="Word wrap"
          onClick={toggleWrap}
          disabled={!note}
        >
          <WrapText />
        </button>
        <span className="spacer" />
        <DropMenu
          label="Skin"
          align="end"
          items={
            <div>
              {SKINS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === skin ? "skin-card is-on" : "skin-card"}
                  onClick={() => setSkin(item.id)}
                >
                  <span className="swatch" data-skin={item.id} aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <em>{item.blurb}</em>
                  </span>
                </button>
              ))}
            </div>
          }
        />
        <button
          type="button"
          className="tool"
          aria-label={mode === "day" ? "Switch to night" : "Switch to day"}
          onClick={() => setMode((m) => (m === "day" ? "night" : "day"))}
        >
          {mode === "day" ? <Moon /> : <Sun />}
        </button>
      </header>

      {findOpen && (
        <div className="findbar">
          <input
            ref={findRef}
            aria-label="Find"
            placeholder="Find"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              anchor.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findMove(e.shiftKey);
              }
            }}
          />
          <input
            aria-label="Replace"
            placeholder="Replace"
            value={repl}
            onChange={(e) => setRepl(e.target.value)}
          />
          <button type="button" className={matchCase ? "tool is-on" : "tool"} aria-pressed={matchCase} onClick={() => setMatchCase((v) => !v)}>
            Aa
          </button>
          <button type="button" className="tool" onClick={() => findMove(true)}>
            Prev
          </button>
          <button type="button" className="tool" onClick={() => findMove(false)}>
            Next
          </button>
          <button type="button" className="tool" onClick={replaceOne}>
            Replace
          </button>
          <button type="button" className="tool" onClick={replaceAll}>
            All
          </button>
          {message && <span className="find-count">{message}</span>}
        </div>
      )}
      {gotoOpen && (
        <form
          className="findbar goto"
          onSubmit={(e) => {
            e.preventDefault();
            jumpLine();
          }}
        >
          <input
            aria-label="Line number"
            inputMode="numeric"
            placeholder="Line"
            value={gotoVal}
            autoFocus
            onChange={(e) => setGotoVal(e.target.value)}
          />
          <button type="submit" className="tool">
            Go
          </button>
        </form>
      )}

      <div className="body">
        <button type="button" className="scrim" aria-label="Close notes" onClick={() => setDrawer(false)} />
        <nav className="rail" aria-label="Open notes">
          <div className="rail-scroll">
            {order.map((id) => {
              const meta = notes.find((n) => n.id === id);
              if (!meta) return null;
              const dirty = sessions.get(id)?.is_dirty() ?? false;
              const active = id === activeId;
              return (
                <div
                  key={id}
                  className={active ? "tab is-active" : "tab"}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest(".tab-x")) return;
                    onDragStart(id, e);
                  }}
                >
                  {renaming === id ? (
                    <input
                      aria-label="Note name"
                      defaultValue={meta.title}
                      autoFocus
                      onBlur={(e) => rename(id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(id, e.currentTarget.value);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="tab-title" onClick={() => activate(id)} onDoubleClick={() => setRenaming(id)}>
                      {meta.title}
                    </button>
                  )}
                  {dirty && <span className="dirty" aria-label="Unsaved" />}
                  <button type="button" className="tab-x" aria-label={`Close ${meta.title}`} onClick={() => closeNote(id)}>
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className="tool" onClick={createNote}>
            <Plus />
            New sheet
          </button>
        </nav>
        <main className="stage">
          <div className="sheet-frame" data-edge={skinMeta.edge}>
            <div className="sheet">
              {session && note && activeId ? (
                <div className="page" data-pattern={skinMeta.pattern} data-wrap={note.wrap ? "on" : "off"}>
                  {outlineOf(session).map((item, index, all) =>
                    item.kind === "image" ? (
                      <button
                        key={item.id}
                        type="button"
                        className={selectedImage === item.id ? "picture is-selected" : "picture"}
                        onClick={() => setSelectedImage(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" || e.key === "Delete") {
                            e.preventDefault();
                            const next = session.delete_image(item.id);
                            const url = urls.get(`${activeId}:${item.id}`);
                            if (url) URL.revokeObjectURL(url);
                            urls.delete(`${activeId}:${item.id}`);
                            setSelectedImage(null);
                            if (next) setCaret({ blockId: next.block_id, pos: next.start });
                            bump(next);
                          }
                        }}
                      >
                        <img src={imageUrl(activeId, item.id, session)} alt="" />
                      </button>
                    ) : (
                      <TextBlock
                        key={item.id}
                        noteId={activeId}
                        blockId={item.id}
                        session={session}
                        wrap={note.wrap}
                        grow={index === all.length - 1}
                        tick={tick}
                        focusRef={focusRef}
                        onCaret={(pos) => {
                          setSelectedImage(null);
                          setCaret({ blockId: item.id, pos });
                        }}
                        onEdited={edited}
                        onImage={(file) => void insertImageFile(file)}
                        onStructure={(next) => {
                          if (next) setCaret({ blockId: next.block_id, pos: next.start });
                          bump(next);
                        }}
                      />
                    ),
                  )}
                </div>
              ) : (
                <div className="empty">
                  <h2>A blank sheet</h2>
                  <p>Open a file, or start a sheet. Tabs sit down the side. Night and day are a separate switch from the skin.</p>
                  <button type="button" className="btn primary" onClick={createNote}>
                    New sheet
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <footer className="status">
        <span>
          Ln {metrics[0]}, Col {metrics[1]}
        </span>
        <span>{metrics[3]} chars</span>
        <DropMenu
          label={langText}
          items={
            <>
              {LANGUAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === langSetting ? "menu-item is-on" : "menu-item"}
                  onClick={() => {
                    session?.set_language(item.id);
                    setTick((n) => n + 1);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </>
          }
        />
        <DropMenu
          label={session?.encoding_label() ?? "UTF-8"}
          items={
            <>
              {[
                ["utf-8", "UTF-8"],
                ["utf-8-bom", "UTF-8 BOM"],
                ["utf-16le", "UTF-16 LE"],
                ["windows-1252", "Windows-1252"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    const result = session?.set_encoding(id) ?? "";
                    if (result.startsWith("err:")) setMessage(result.slice(4));
                    else setMessage(label);
                    setTick((n) => n + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </>
          }
        />
        <DropMenu
          label={session?.eol_label() ?? "LF"}
          items={
            <>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  session?.set_eol("lf");
                  setTick((n) => n + 1);
                }}
              >
                Unix (LF)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  session?.set_eol("crlf");
                  setTick((n) => n + 1);
                }}
              >
                Windows (CRLF)
              </button>
            </>
          }
        />
        <span>{Math.round((zoom / 16) * 100)}%</span>
        {!findOpen && message && <span className="status-msg">{message}</span>}
      </footer>

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          if (e.target.files) void openFiles(e.target.files);
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
              <button type="button" className="btn" onClick={() => setAsk(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn primary"
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

function DropMenu({ label, items, align }: { label: string; items: ReactNode; align?: "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="tool" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="popover" data-align={align ?? "start"} role="menu" onClick={() => setOpen(false)}>
          {items}
        </div>
      )}
    </div>
  );
}

function TextBlock({
  noteId,
  blockId,
  session,
  wrap,
  grow,
  tick,
  focusRef,
  onCaret,
  onEdited,
  onImage,
  onStructure,
}: {
  noteId: string;
  blockId: number;
  session: Session;
  wrap: boolean;
  grow: boolean;
  tick: number;
  focusRef: MutableRefObject<Place | null>;
  onCaret: (pos: number) => void;
  onEdited: () => void;
  onImage: (file: File) => void;
  onStructure: (caret: Place | null | undefined) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const prev = useRef(session.text_of(blockId));
  const lastAt = useRef(0);
  const composing = useRef(false);

  const paintNow = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.innerHTML = paint(ta.value, session.highlight(blockId));
    fit(ta, wrap);
  };

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const next = session.text_of(blockId);
    if (ta.value !== next) {
      ta.value = next;
      prev.current = next;
    }
    paintNow();
    const focus = focusRef.current;
    if (focus && focus.block_id === blockId) {
      ta.focus();
      const pos = Math.min(focus.start, ta.value.length);
      const end = Math.min(focus.end, ta.value.length);
      ta.setSelectionRange(pos, end);
      focusRef.current = null;
      onCaret(pos);
    }
  }, [tick, wrap, blockId]);

  function sync(coalesce: boolean) {
    const ta = taRef.current;
    if (!ta || composing.current) return;
    const next = ta.value;
    const was = prev.current;
    if (next === was) {
      paintNow();
      return;
    }
    const d = diffText(was, next);
    session.edit(blockId, d.start, d.end, d.inserted, coalesce);
    prev.current = next;
    paintNow();
    onCaret(ta.selectionStart ?? 0);
    onEdited();
  }

  return (
    <div className={grow ? "block grow" : "block"} data-note={noteId}>
      <pre ref={preRef} className="hl" aria-hidden="true" />
      <textarea
        ref={taRef}
        className="editor"
        aria-label="Note"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        defaultValue={prev.current}
        onFocus={(e) => onCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyUp={(e) => onCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => onCaret(e.currentTarget.selectionStart ?? 0)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          sync(false);
        }}
        onInput={(e) => {
          const native = e.nativeEvent as InputEvent;
          if (native.isComposing || composing.current) return;
          const now = performance.now();
          const burst = now - lastAt.current < 700;
          lastAt.current = now;
          const small =
            native.inputType === "insertText" ||
            native.inputType === "deleteContentBackward" ||
            native.inputType === "deleteContentForward";
          sync(burst && small);
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart ?? 0;
            const end = ta.selectionEnd ?? start;
            session.edit(blockId, start, end, "\t", false);
            const next = session.text_of(blockId);
            ta.value = next;
            prev.current = next;
            ta.setSelectionRange(start + 1, start + 1);
            paintNow();
            onCaret(start + 1);
            onEdited();
          }
        }}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (!file) return;
              e.preventDefault();
              const ta = e.currentTarget;
              const start = ta.selectionStart ?? 0;
              const end = ta.selectionEnd ?? start;
              if (start !== end) {
                session.edit(blockId, start, end, "", false);
                const next = session.text_of(blockId);
                ta.value = next;
                prev.current = next;
              }
              onCaret(start);
              onImage(file);
              return;
            }
          }
        }}
      />
    </div>
  );
}

function fit(ta: HTMLTextAreaElement, wrap: boolean) {
  ta.style.height = "0px";
  if (!wrap) {
    ta.style.width = "0px";
    ta.style.width = `${Math.max(ta.scrollWidth, ta.parentElement?.clientWidth ?? 0)}px`;
  } else {
    ta.style.width = "100%";
  }
  ta.style.height = `${ta.scrollHeight}px`;
}
