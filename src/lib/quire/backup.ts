export const ARCHIVE_FORMAT = "papel-archive";
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_EXT = "papel-archive";

export type ArchiveBlock =
  | { kind: "text"; text: string; marks?: number[]; font?: string; style?: string; align?: string }
  | { kind: "image"; mime: string; data: string }
  | { kind: "table"; cols: number; cells: unknown[] };

export type ArchiveNote = {
  id: string;
  title: string;
  wrap: boolean;
  edited?: number;
  dirty?: boolean;
  sourceExt?: string;
  language: string;
  eol: string;
  encoding: string;
  blocks: ArchiveBlock[];
};

export type PapelArchive = {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: string;
  order: string[];
  notes: ArchiveNote[];
};

function stampDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function archiveFileName(date = new Date()): string {
  return `papel-backup-${stampDay(date)}.${ARCHIVE_EXT}`;
}

/** Cross-browser backup download (contains the same archive JSON). */
export function zipBackupFileName(date = new Date()): string {
  return `papel-backup-${stampDay(date)}.zip`;
}

export function parseArchive(raw: string): PapelArchive | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PapelArchive>;
    if (parsed.format !== ARCHIVE_FORMAT || !Array.isArray(parsed.notes)) return null;
    return {
      format: ARCHIVE_FORMAT,
      version: Number(parsed.version) || 1,
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
      order: Array.isArray(parsed.order) ? parsed.order.map(String) : parsed.notes.map((n) => String(n.id)),
      notes: parsed.notes as ArchiveNote[],
    };
  } catch {
    return null;
  }
}

export type ImportResult = { imported: number; skipped: number; notes: ArchiveNote[] };

/** Picks archive notes that are not already on the board (by id). */
export function mergeArchive(archive: PapelArchive, existingIds: Set<string>): ImportResult {
  const notes: ArchiveNote[] = [];
  let imported = 0;
  let skipped = 0;
  const byId = new Map(archive.notes.map((n) => [n.id, n]));
  const ids = archive.order.length ? archive.order : archive.notes.map((n) => n.id);
  for (const id of ids) {
    const note = byId.get(id);
    if (!note) continue;
    if (existingIds.has(note.id)) {
      skipped += 1;
      continue;
    }
    notes.push(note);
    imported += 1;
  }
  return { imported, skipped, notes };
}

export function formatLastBackup(iso?: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
