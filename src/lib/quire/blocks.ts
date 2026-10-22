/**
 * Table and bullet inserts as plain text.
 *
 * Papel's document is text: there are no block kinds for tables or lists, and
 * `.txt` has to keep opening anywhere. So both features are authored as
 * characters — a monospace table that lines up with the editor font, and a
 * `• ` prefix on the selected lines — which keeps one undo step per action and
 * costs nothing on the typing path.
 */

/** Marker a bullet line starts with. */
export const BULLET = "• ";
/** Interior width of a table cell, in monospace cells. */
const CELL = 9;
/** Picker ceiling; keeps one insert from producing an unreadable wall. */
const MAX = 20;

export type TextChange = { start: number; end: number; insert: string };

function shape(n: number): number {
  return Math.max(1, Math.min(MAX, Math.floor(Number.isFinite(n) ? n : 1)));
}

function rule(cols: number): string {
  const cell = "-".repeat(CELL);
  return "+" + Array.from({ length: cols }, () => cell).join("+") + "+";
}

function emptyRow(cols: number): string {
  const cell = " ".repeat(CELL);
  return "|" + Array.from({ length: cols }, () => cell).join("|") + "|";
}

/**
 * A `rows` × `cols` table skeleton, every cell empty.
 *
 * ASCII on purpose: the box-drawing characters (`┌ ─ │`) are missing from IBM
 * Plex Mono, so they fall back to another font whose advance differs and the
 * grid drifts out of alignment. `+ - |` are one cell wide everywhere, and they
 * survive round-trips through `.txt` and any other editor.
 */
export function tableSkeleton(rows: number, cols: number): string {
  const r = shape(rows);
  const c = shape(cols);
  const lines = [rule(c)];
  for (let row = 0; row < r; row += 1) {
    lines.push(emptyRow(c));
    lines.push(rule(c));
  }
  return lines.join("\n");
}

/** Start offset of the line containing `at`. */
function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
}

/**
 * Adds `• ` to every non-empty line the selection touches, or removes it when
 * they all already have one. A caret alone on an empty line starts a list.
 */
export function toggleBullets(text: string, start: number, end: number): TextChange & { allBulleted: boolean } {
  const from = lineStart(text, start);
  const stop = text.indexOf("\n", Math.max(end, start));
  const to = stop === -1 ? text.length : stop;
  const lines = text.slice(from, to).split("\n");
  const marked = lines.filter((line) => line.trim().length > 0);
  const allBulleted = marked.length > 0 && marked.every((line) => line.startsWith(BULLET));

  const next = lines.map((line) => {
    if (line.startsWith(BULLET)) return allBulleted ? line.slice(BULLET.length) : line;
    if (!line.trim() && lines.length > 1) return line;
    return BULLET + line;
  });

  return { start: from, end: to, insert: next.join("\n"), allBulleted };
}

/**
 * What Enter should insert to carry a bullet on to the next line. `null` means
 * "not a bullet line"; a caret on an empty bullet ends the list instead.
 */
export function continueBullet(text: string, caret: number): TextChange | null {
  const from = lineStart(text, caret);
  const before = text.slice(from, caret);
  const filled = /^(\s*)• \S/.exec(before);
  if (filled) return { start: caret, end: caret, insert: `\n${filled[1]}${BULLET}` };
  if (/^\s*• $/.test(before)) return { start: from, end: caret, insert: "" };
  return null;
}
