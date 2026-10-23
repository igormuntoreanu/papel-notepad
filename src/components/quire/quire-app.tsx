import { useEffect, useRef, useState } from "react";
import { createSession } from "@/lib/quire/engine";
import { toggleBullets } from "@/lib/quire/blocks";
import { MIN_QUERY, searchNotes } from "@/lib/quire/fuzzy";
import { FLAG, rangeHas, readMarks, type FlagName } from "@/lib/quire/marks";
import { savePersisted, type Prefs, type SortMode } from "@/lib/quire/persist";
import { installTextures } from "@/lib/quire/textures";
import { canOpenFile, download, FILE_ACCEPT, fileStamp, langFromFilename, langLabel, safeName, SKINS, type SkinId } from "@/lib/quire/text";
import { Board, type CardActions } from "./board";
import { HeaderStrip } from "./header-strip";
import { Sheet, type FindState, type SheetActions, type StyleState } from "./sheet";
import { StatusBar } from "./status-bar";
import {
  blankNote,
  cardInfo,
  dropUrls,
  ensureLoaded,
  forgetCard,
  fromPapel,
  imageUrl,
  outlineOf,
  sessions,
  snapshot,
  toPapel,
  type NoteMeta,
  type Place,
} from "./store";

type Ask = { title: string; body: string; confirm: string; tone?: "danger"; run: () => void };
type Sel = { blockId: number; start: number; end: number };

export function QuireApp() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "focus">("board");
  const [skin, setSkin] = useState<SkinId>("paper");
  const [zoom, setZoom] = useState(16);
  const [autocorrect, setAutocorrect] = useState(true);
  const [sort, setSort] = useState<SortMode>("manual");
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<Sel>({ blockId: 0, start: 0, end: 0 });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [line, setLine] = useState("");
  const [findStatus, setFindStatus] = useState("");
  const [message, setMessage] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [langFilter, setLangFilter] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const focusRef = useRef<Place | null>(null);
  const anchor = useRef<Place | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef(notes);
  const orderRef = useRef(order);
  const activeRef = useRef(activeId);
  const selRef = useRef(sel);
  notesRef.current = notes;
  orderRef.current = order;
  activeRef.current = activeId;
  selRef.current = sel;

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
      const prefs: Prefs = { skin, zoom, autocorrect, sort };
      void savePersisted(snapshot(notes, order, activeId), prefs).catch(() => {
        setMessage("Could not autosave this sheet.");
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [ready, notes, order, activeId, skin, zoom, autocorrect, sort, tick]);

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
    const id = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(id);
  }, [message]);

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

  function createNote() {
    const fresh = blankNote(notesRef.current.map((n) => n.title));
    setNotes((list) => [...list, fresh]);
    setOrder((list) => [...list, fresh.id]);
    activate(fresh.id);
  }

  function closeNote(id: string) {
    const s = sessions.get(id);
    const meta = notesRef.current.find((n) => n.id === id);
    const run = () => {
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
        title: "Discard this sheet?",
        body: `${meta?.title ?? "This sheet"} has edits that were not saved to a file. Autosave on this device will drop it too.`,
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

  /** `.papel` is the only format Papel writes: text, images, styles, tables. */
  function saveNote(id: string | null) {
    const s = id ? sessions.get(id) : null;
    const meta = notesRef.current.find((n) => n.id === id);
    if (!s || !meta) return;
    const name = safeName(meta.title, "papel");
    download(name, toPapel(s), "application/json");
    s.mark_clean();
    setMessage(`Saved ${name}`);
    setTick((n) => n + 1);
  }

  async function openFiles(files: FileList | File[]) {
    let first: string | null = null;
    for (const file of [...files]) {
      if (!canOpenFile(file.name)) {
        setMessage(`${file.name}: not a type Papel can open.`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = crypto.randomUUID();
      const s = createSession();
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".papel") || lower.endsWith(".quire")) {
        if (!fromPapel(s, bytes)) {
          setMessage(`${file.name} is not a Papel file.`);
          continue;
        }
      } else {
        s.open_bytes(bytes);
        const hinted = langFromFilename(file.name);
        if (hinted && hinted !== "plain") s.force_language(hinted);
      }
      sessions.set(id, s);
      const meta: NoteMeta = { id, title: file.name, wrap: true, edited: file.lastModified || Date.now() };
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
    const blockId = selRef.current.blockId || session.first_text_id();
    const at = selRef.current.start;
    const before = new Set(outlineOf(session).filter((i) => i.kind === "image").map((i) => i.id));
    const next = session.insert_image_caret(blockId, at, file.type, bytes);
    if (!next) {
      setMessage("Could not place that image.");
      return;
    }
    const added = outlineOf(session).find((i) => i.kind === "image" && !before.has(i.id));
    if (added) imageUrl(activeId, added.id, session);
    setSel({ blockId: next.block_id, start: next.start, end: next.start });
    setMessage("Image pasted onto the sheet.");
    touch(activeId);
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

  function insertDate() {
    if (!session) return;
    const { blockId: b, start, end } = selRef.current;
    const blockId = b || session.first_text_id();
    const stamp = fileStamp();
    session.edit(blockId, start, end, stamp, false);
    const pos = start + stamp.length;
    setSel({ blockId, start: pos, end: pos });
    touch(activeId);
    bump({ block_id: blockId, start: pos, end: pos });
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

  function runFormat() {
    if (!session) return;
    const msg = session.format_all();
    const ok = msg.startsWith("ok:");
    const text = msg.slice(ok ? 3 : 4);
    setMessage(text);
    if (ok && text !== "Already formatted.") {
      touch(activeId);
      bump();
    }
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
      setFindStatus("Type something to find.");
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
      setFindStatus("No matches.");
      return;
    }
    const place = { block_id: hit.block_id, start: hit.start, end: hit.end };
    anchor.current = place;
    setSel({ blockId: hit.block_id, start: hit.start, end: hit.end });
    setFindStatus(`${count} found`);
    bump(place);
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
    setSel({ blockId: next.block_id, start: next.start, end: next.start });
    bump({ block_id: next.block_id, start: next.start, end: next.end });
  }

  function openFind() {
    setFindOpen(true);
    window.setTimeout(() => findRef.current?.focus(), 0);
  }

  function applyStyle(kind: string, value: number) {
    const { blockId, start, end } = selRef.current;
    if (!session || end <= start) {
      setMessage("Select some text first.");
      return;
    }
    if (session.apply_style(blockId, start, end, kind, value)) touch(activeId);
    bump({ block_id: blockId, start, end });
  }

  function toggleFlag(flag: FlagName) {
    if (!session) return;
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
      <div className="desk" data-skin="paper">
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
  if (langFilter) visible = visible.filter((id) => infoFor(id)?.lang === langFilter);
  if (!hits && sort === "recent") visible.sort((a, b) => (metaById.get(b)?.edited ?? 0) - (metaById.get(a)?.edited ?? 0));
  if (!hits && sort === "title") visible.sort((a, b) => (metaById.get(a)?.title ?? "").localeCompare(metaById.get(b)?.title ?? ""));
  const canReorder = sort === "manual" && !hits && !langFilter;
  const langs = [...new Set(order.map((id) => infoFor(id)?.lang).filter((l): l is string => Boolean(l)))].sort();
  const unsaved = order.filter((id) => sessions.get(id)?.is_dirty()).length;
  const hint =
    trimmed && trimmed.length < MIN_QUERY && !committed
      ? `Type ${MIN_QUERY}+ letters or press Go`
      : hits
        ? `${visible.length} ${visible.length === 1 ? "match" : "matches"}`
        : "";

  const cardActions: CardActions = {
    open: (id) => activate(id),
    rename,
    save: (id) => saveNote(id),
    close: closeNote,
    move: moveNote,
    reorder,
  };

  const blockId = sel.blockId || session?.first_text_id() || 0;
  const metrics = session ? session.metrics(blockId, sel.start) : [1, 1, 1, 0];
  const langSetting = session?.language() ?? "auto";
  const effective = session ? session.effective_language(blockId) : "plain";
  const langText = langSetting === "auto" ? `Auto · ${langLabel(effective)}` : langLabel(langSetting);
  const marksNow = session && sel.end > sel.start ? readMarks(session.marks(blockId)) : [];
  const at = marksNow.find((m) => m.start <= sel.start && m.end > sel.start);
  const styles: StyleState = {
    hasSelection: sel.end > sel.start,
    active: {
      bold: rangeHas(marksNow, sel.start, sel.end, FLAG.bold),
      italic: rangeHas(marksNow, sel.start, sel.end, FLAG.italic),
      underline: rangeHas(marksNow, sel.start, sel.end, FLAG.underline),
      strike: rangeHas(marksNow, sel.start, sel.end, FLAG.strike),
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
      setFindStatus("");
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
    format: runFormat,
    find: () => (findOpen ? setFindOpen(false) : openFind()),
    date: insertDate,
    image: () => imageRef.current?.click(),
    wrap: toggleWrap,
    save: () => saveNote(activeId),
    table: insertTable,
    bullets: toggleBulletList,
    close: () => activeId && closeNote(activeId),
    deleteImage,
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
          if (!trimmed) setLangFilter("");
        }}
        searchRef={searchRef}
        hint={hint}
        langs={langs}
        lang={langFilter}
        setLang={setLangFilter}
        sort={sort}
        setSort={setSort}
        onNew={createNote}
        onOpen={() => fileRef.current?.click()}
        skin={skin}
        setSkin={setSkin}
        autocorrect={autocorrect}
        setAutocorrect={setAutocorrect}
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
                No sheet fits {applied ? <>“{applied}”</> : "this filter"}
                {langFilter ? ` in ${langFilter}` : ""}. Try fewer letters, or clear the filters.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery("");
                  setCommitted("");
                  setLangFilter("");
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
                onImage={(file) => void insertImageFile(file)}
                styles={styles}
                find={find}
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

      <StatusBar
        view={view}
        session={session}
        metrics={metrics}
        langText={langText}
        zoom={zoom}
        message={message}
        total={order.length}
        unsaved={unsaved}
        shown={visible.length}
        onChanged={() => bump()}
        onMessage={setMessage}
      />

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
                className={ask.tone === "danger" ? "btn danger" : "btn primary"}
                autoFocus
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


