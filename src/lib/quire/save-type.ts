/**
 * Save extension rules (stage: folder-sync):
 * - New sheets (no sourceExt) → always `.papel`
 * - Opened plain files (txt, py, js, json, xml, …) → keep that extension
 * - Opened `.papel` / `.quire` → `.papel`
 */

/** Anything a plain text file cannot keep. */
export type RichFlags = {
  hasImage: boolean;
  hasMarks: boolean;
  hasTable: boolean;
};

export function isRich(flags: RichFlags): boolean {
  return flags.hasImage || flags.hasMarks || flags.hasTable;
}

const KEEP_PLAIN = new Set([
  "txt",
  "py",
  "js",
  "mjs",
  "cjs",
  "json",
  "xml",
  "html",
  "htm",
  "css",
  "md",
  "markdown",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "sql",
  "abap",
]);

/** Extension without dot for folder sync / Save. */
export function defaultSaveExt(opts: {
  /** Extension the sheet was opened from, without the dot. */
  sourceExt?: string | null;
}): string {
  const fromFile = opts.sourceExt?.toLowerCase().replace(/^\./, "");
  if (fromFile && fromFile !== "papel" && fromFile !== "quire" && KEEP_PLAIN.has(fromFile)) {
    return fromFile === "mjs" || fromFile === "cjs" ? "js" : fromFile === "htm" ? "html" : fromFile === "markdown" ? "md" : fromFile;
  }
  return "papel";
}

/** Extensions offered in the save menu: default first. */
export function saveExtensions(opts: { sourceExt?: string | null; rich?: boolean }): string[] {
  const primary = defaultSaveExt(opts);
  if (primary === "papel") return ["papel"];
  // Opened plain file: keep original; offer .papel if the sheet grew rich content.
  if (opts.rich) return [primary, "papel"];
  return [primary];
}

export function extFromFilename(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return base.slice(dot + 1).toLowerCase();
}
