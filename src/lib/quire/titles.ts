/** Next blank-sheet title: Untitled, Untitled 2, Untitled 3, … */
export function nextUntitled(titles: string[]): string {
  if (!titles.includes("Untitled")) return "Untitled";
  let n = 2;
  while (titles.includes(`Untitled ${n}`)) n += 1;
  return `Untitled ${n}`;
}

/** Title for a duplicated sheet: "nota1" → "nota1 copy", then "nota1 copy 2", … */
export function copyTitle(title: string, titles: string[]): string {
  const base = `${title} copy`;
  if (!titles.includes(base)) return base;
  let n = 2;
  while (titles.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * Ensures a title is unique among open sheets.
 * Collisions become `name (2)`, `name (3)`, …
 * Pass titles of every *other* sheet (exclude the one being renamed).
 */
export function uniqueTitle(wanted: string, taken: string[]): string {
  const base = wanted.trim() || "Untitled";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/**
 * Title taken from the sheet's own first non-empty line.
 * Whitespace collapses so a long line becomes a single readable card title, and the
 * result is capped so it still fits the sheet header and card.
 */
export function titleFromFirstLine(text: string, limit = 60): string {
  const line = text.split("\n").find((entry) => entry.trim().length > 0);
  if (!line) return "";
  const collapsed = line.trim().replace(/\s+/g, " ");
  return collapsed.slice(0, limit).trim();
}

/** Filename stem: strip a trailing extension if present. */
export function titleFromFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base || "Untitled";
  return base.slice(0, dot) || base;
}
