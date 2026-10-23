import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  type ArchiveBlock,
  type ArchiveNote,
  type PapelArchive,
} from "@/lib/quire/backup";
import { bootEngine, createSession, type Session } from "@/lib/quire/engine";
import { loadPersisted, type Persisted, type Prefs, type SortMode, type StoredBlock, type StoredNote } from "@/lib/quire/persist";
import { base64ToBytes, bytesToBase64, copyBytes, langLabel, SKINS, type SkinId } from "@/lib/quire/text";

export type NoteMeta = {
  id: string;
  title: string;
  wrap: boolean;
  edited: number;
  /** Extension the sheet was opened from (no dot), so Save can write it back. */
  sourceExt?: string;
};
export type OutlineItem = { id: number; kind: string; mime: string };
export type Place = { block_id: number; start: number; end: number };
export type Loaded = { notes: NoteMeta[]; order: string[]; activeId: string | null; prefs: Prefs };

export type CardInfo = {
  text: string;
  preview: string;
  words: number;
  lines: number;
  lang: string;
  code: boolean;
  image: string | null;
  images: number;
  dirty: boolean;
};

export const sessions = new Map<string, Session>();
export const urls = new Map<string, string>();
let loadedCache: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

export function outlineOf(session: Session): OutlineItem[] {
  return JSON.parse(session.outline()) as OutlineItem[];
}

export function imageUrl(noteId: string, imageId: number, session: Session): string {
  const key = `${noteId}:${imageId}`;
  const hit = urls.get(key);
  if (hit) return hit;
  const bytes = session.image_of(imageId);
  const mime = session.mime_of(imageId) || "image/png";
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
  urls.set(key, url);
  return url;
}

export function dropUrls(noteId: string, imageId?: number) {
  for (const [key, url] of urls) {
    if (imageId === undefined ? key.startsWith(`${noteId}:`) : key === `${noteId}:${imageId}`) {
      URL.revokeObjectURL(url);
      urls.delete(key);
    }
  }
}

function nextTitle(titles: string[]): string {
  if (!titles.includes("Untitled")) return "Untitled";
  let n = 2;
  while (titles.includes(`Untitled ${n}`)) n += 1;
  return `Untitled ${n}`;
}

export function blankNote(titles: string[]): NoteMeta {
  const id = crypto.randomUUID();
  sessions.set(id, createSession());
  return { id, title: nextTitle(titles), wrap: true, edited: Date.now() };
}

/** Deep-copies a live session (content only; caller owns id/order/meta). */
export function duplicateSession(sourceId: string): Session | null {
  const source = sessions.get(sourceId);
  if (!source) return null;
  const session = createSession();
  if (!fromPapel(session, new TextEncoder().encode(toPapel(source)))) return null;
  session.mark_dirty();
  return session;
}

const SORTS: SortMode[] = ["manual", "recent", "title"];

export async function ensureLoaded(): Promise<Loaded> {
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
          const pending: [number, number[]][] = [];
          for (const block of stored.blocks) {
            if (block.kind === "text") {
              const blockId = session.restore_text(block.text);
              if (block.marks?.length) pending.push([blockId, block.marks]);
            } else session.restore_image(block.mime, new Uint8Array(block.bytes));
          }
          session.restore_end(stored.language, stored.eol, stored.encoding);
          for (const [blockId, marks] of pending) session.restore_marks(blockId, Uint32Array.from(marks));
          sessions.set(id, session);
          notes.push({
            id,
            title: stored.title,
            wrap: stored.wrap,
            edited: stored.edited ?? Date.now(),
            sourceExt: stored.sourceExt,
          });
          if (stored.dirty) session.mark_dirty();
          order.push(id);
        }
      }
      const skin = SKINS.some((s) => s.id === prefs?.skin) ? (prefs!.skin as SkinId) : "paper";
      loadedCache = {
        notes,
        order,
        activeId: doc?.activeId && order.includes(doc.activeId) ? doc.activeId : (order[0] ?? null),
        prefs: {
          skin,
          zoom: prefs?.zoom && prefs.zoom >= 12 && prefs.zoom <= 28 ? prefs.zoom : 16,
          autocorrect: prefs?.autocorrect ?? true,
          sort: prefs?.sort && SORTS.includes(prefs.sort) ? prefs.sort : "manual",
          lastBackup: typeof prefs?.lastBackup === "string" ? prefs.lastBackup : undefined,
          folderName: typeof prefs?.folderName === "string" ? prefs.folderName : undefined,
        },
      };
      return loadedCache;
    })();
  }
  return loading;
}

export function snapshot(notes: NoteMeta[], order: string[], activeId: string | null): Persisted {
  return {
    activeId,
    order,
    notes: order
      .map((id): StoredNote | null => {
        const meta = notes.find((n) => n.id === id);
        const session = sessions.get(id);
        if (!meta || !session) return null;
        const blocks: StoredBlock[] = outlineOf(session).map((item) => {
          if (item.kind === "image") {
            return { kind: "image", mime: item.mime || "image/png", bytes: copyBytes(session.image_of(item.id)) };
          }
          const marks = session.marks(item.id);
          return marks.length
            ? { kind: "text", text: session.text_of(item.id), marks: [...marks] }
            : { kind: "text", text: session.text_of(item.id) };
        });
        return {
          id,
          title: meta.title,
          wrap: meta.wrap,
          edited: meta.edited,
          dirty: session.is_dirty(),
          sourceExt: meta.sourceExt,
          language: session.language(),
          eol: session.eol(),
          encoding: session.encoding(),
          blocks,
        };
      })
      .filter((n): n is StoredNote => n !== null),
  };
}

/** Serialises a note to the .papel JSON format (v3 adds table blocks). */
export function toPapel(session: Session): string {
  const blocks = outlineOf(session).map((item) => {
    if (item.kind === "image") {
      return { type: "image", mime: item.mime || "image/png", data: bytesToBase64(session.image_of(item.id)) };
    }
    if (item.kind === "table") {
      const table = JSON.parse(session.table_json(item.id)) as { cols: number; cells: unknown[] };
      return { type: "table", cols: table.cols, cells: table.cells };
    }
    const marks = session.marks(item.id);
    return marks.length
      ? { type: "text", text: session.text_of(item.id), marks: [...marks] }
      : { type: "text", text: session.text_of(item.id) };
  });
  return JSON.stringify({
    format: "papel",
    version: 3,
    language: session.language(),
    eol: session.eol(),
    encoding: session.encoding(),
    blocks,
  });
}

type PapelFile = {
  language?: string;
  eol?: string;
  encoding?: string;
  blocks?: Array<{
    type: string;
    text?: string;
    mime?: string;
    data?: string;
    marks?: number[];
    cols?: number;
    cells?: unknown[];
  }>;
};

/** Loads .papel / .quire JSON into a session. Returns false when the file is not valid JSON. */
export function fromPapel(session: Session, bytes: Uint8Array): boolean {
  let parsed: PapelFile;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as PapelFile;
  } catch {
    return false;
  }
  session.restore_begin();
  const pending: [number, number[]][] = [];
  for (const block of parsed.blocks ?? []) {
    if (block.type === "image" && block.data) {
      session.restore_image(block.mime || "image/png", base64ToBytes(block.data));
    } else if (block.type === "table" && Array.isArray(block.cells)) {
      session.restore_table(JSON.stringify({ cols: block.cols ?? 1, cells: block.cells }));
    } else {
      const id = session.restore_text(block.text ?? "");
      if (Array.isArray(block.marks) && block.marks.length) pending.push([id, block.marks]);
    }
  }
  session.restore_end(parsed.language || "auto", parsed.eol || "lf", parsed.encoding || "utf-8");
  for (const [id, marks] of pending) session.restore_marks(id, Uint32Array.from(marks.map((n) => Number(n) >>> 0)));
  return true;
}

const cardCache = new Map<string, { stamp: string; info: CardInfo }>();

/** Card data for a note, cached until the note's stamp changes. */
export function cardInfo(id: string, stamp: string): CardInfo | null {
  const session = sessions.get(id);
  if (!session) return null;
  const hit = cardCache.get(id);
  if (hit && hit.stamp === stamp) return { ...hit.info, dirty: session.is_dirty() };
  const outline = outlineOf(session);
  const text = session.export_text();
  const images = outline.filter((i) => i.kind === "image");
  const setting = session.language();
  const effective = setting === "auto" ? session.effective_language(session.first_text_id()) : setting;
  const trimmed = text.replace(/^\s+/, "");
  const info: CardInfo = {
    text,
    preview: trimmed.split("\n").slice(0, 8).join("\n").slice(0, 420),
    words: (text.match(/\S+/g) ?? []).length,
    lines: text.length ? text.split("\n").length : 0,
    lang: langLabel(effective),
    code: effective !== "plain",
    image: images[0] ? imageUrl(id, images[0].id, session) : null,
    images: images.length,
    dirty: session.is_dirty(),
  };
  cardCache.set(id, { stamp, info });
  return info;
}

export function forgetCard(id: string) {
  cardCache.delete(id);
}

function blocksToArchive(session: Session): ArchiveBlock[] {
  return outlineOf(session).map((item) => {
    if (item.kind === "image") {
      return { kind: "image", mime: item.mime || "image/png", data: bytesToBase64(session.image_of(item.id)) };
    }
    if (item.kind === "table") {
      const table = JSON.parse(session.table_json(item.id)) as { cols: number; cells: unknown[] };
      return { kind: "table", cols: table.cols, cells: table.cells };
    }
    const marks = session.marks(item.id);
    return marks.length
      ? { kind: "text", text: session.text_of(item.id), marks: [...marks] }
      : { kind: "text", text: session.text_of(item.id) };
  });
}

/** Builds a full-board backup archive from the live sessions. */
export function buildArchive(
  notes: Array<{ id: string; title: string; wrap: boolean; edited: number; sourceExt?: string }>,
  order: string[],
): PapelArchive {
  const exportedAt = new Date().toISOString();
  const archived: ArchiveNote[] = [];
  for (const id of order) {
    const meta = notes.find((n) => n.id === id);
    const session = sessions.get(id);
    if (!meta || !session) continue;
    archived.push({
      id: meta.id,
      title: meta.title,
      wrap: meta.wrap,
      edited: meta.edited,
      dirty: session.is_dirty(),
      sourceExt: meta.sourceExt,
      language: session.language(),
      eol: session.eol(),
      encoding: session.encoding(),
      blocks: blocksToArchive(session),
    });
  }
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt,
    order: archived.map((n) => n.id),
    notes: archived,
  };
}

/** Loads an archive note into a live session. */
export function sessionFromArchiveNote(note: ArchiveNote): Session {
  const session = createSession();
  const papel = {
    format: "papel",
    version: 3,
    language: note.language,
    eol: note.eol,
    encoding: note.encoding,
    blocks: note.blocks.map((block) => {
      if (block.kind === "image") return { type: "image", mime: block.mime, data: block.data };
      if (block.kind === "table") return { type: "table", cols: block.cols, cells: block.cells };
      return block.marks?.length
        ? { type: "text", text: block.text, marks: block.marks }
        : { type: "text", text: block.text };
    }),
  };
  const ok = fromPapel(session, new TextEncoder().encode(JSON.stringify(papel)));
  if (!ok) {
    session.restore_begin();
    session.restore_text("");
    session.restore_end(note.language || "auto", note.eol || "lf", note.encoding || "utf-8");
  }
  if (note.dirty) session.mark_dirty();
  else session.mark_clean();
  return session;
}

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
