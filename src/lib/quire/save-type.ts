import { extForLanguage } from "./text.ts";

/** Anything a plain text file cannot keep. */
export type RichFlags = {
  hasImage: boolean;
  hasMarks: boolean;
  hasTable: boolean;
};

export function isRich(flags: RichFlags): boolean {
  return flags.hasImage || flags.hasMarks || flags.hasTable;
}

/**
 * Default save extension for a sheet.
 * - Rich content (images, styles, tables) → `.papel`
 * - Otherwise the extension the sheet was opened with, or the language's extension
 */
export function defaultSaveExt(opts: {
  rich: boolean;
  language: string;
  /** Extension the sheet was opened from, without the dot (e.g. `txt`, `py`). */
  sourceExt?: string | null;
}): string {
  if (opts.rich) return "papel";
  const fromFile = opts.sourceExt?.toLowerCase().replace(/^\./, "");
  if (fromFile && fromFile !== "papel" && fromFile !== "quire") return fromFile;
  return extForLanguage(opts.language);
}

/** Extensions offered in the save menu: default first. */
export function saveExtensions(opts: {
  rich: boolean;
  language: string;
  sourceExt?: string | null;
}): string[] {
  const primary = defaultSaveExt(opts);
  if (!opts.rich) return [primary];
  const text = (() => {
    const fromFile = opts.sourceExt?.toLowerCase().replace(/^\./, "");
    if (fromFile && fromFile !== "papel" && fromFile !== "quire") return fromFile;
    return extForLanguage(opts.language);
  })();
  return primary === text ? [primary] : [primary, text];
}

export function extFromFilename(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return base.slice(dot + 1).toLowerCase();
}
