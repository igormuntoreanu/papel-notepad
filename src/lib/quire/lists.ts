/**
 * Lists as plain text.
 *
 * A list item is a line that starts with a marker — `•`, `1.`, `1)`, `a.` — and nesting
 * is expressed by two spaces of indentation per level, with the marker rewritten to the
 * path of that level (`1.1.`, `1.1.1.`). Keeping lists as characters means `.txt` keeps
 * opening anywhere, one undo step per action, and no new block kind in the document.
 */

export type ListKind = "bullet" | "dot" | "paren" | "letter";
export type TextChange = { start: number; end: number; insert: string };

/** Two spaces per nesting level. */
export const LIST_INDENT = "  ";
export const MAX_LEVEL = 3;

const BULLET_GLYPHS = ["•", "◦", "▪"] as const;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

export type ListItem = {
  kind: ListKind;
  level: number;
  /** Numeric path for dot/paren, e.g. [1, 2] for `1.2.`. Empty for bullets. */
  path: number[];
  /** Parent letter for the letter style (level 2+). */
  letter?: string;
  text: string;
};

/** Marker text for an item, without the leading indentation. */
export function listMarker(kind: ListKind, level: number, path: number[], letter?: string): string {
  if (kind === "bullet") return `${BULLET_GLYPHS[Math.min(level, MAX_LEVEL) - 1] ?? "•"} `;
  if (kind === "letter") {
    if (level === 1) return `${letter ?? "a"}. `;
    return `${letter ?? "a"}.${path.join(".")}. `;
  }
  const joined = path.join(".");
  return kind === "dot" ? `${joined}. ` : `${joined}) `;
}

const BULLET_RE = /^([•◦▪])\s+(.*)$/;
const DOT_RE = /^(\d+(?:\.\d+)*)\.\s+(.*)$/;
const PAREN_RE = /^(\d+(?:\.\d+)*)\)\s+(.*)$/;
const LETTER_RE = /^([a-z])\.\s+(.*)$/;
const LETTER_DEEP_RE = /^([a-z])\.(\d+(?:\.\d+)*)\.\s+(.*)$/;

/** Reads one line as a list item, or null when it is plain text. */
export function parseListItem(line: string): { indent: string; item: ListItem } | null {
  const indentMatch = /^[ \t]*/.exec(line);
  const indent = indentMatch ? indentMatch[0] : "";
  const body = line.slice(indent.length);
  const level = Math.floor(indent.length / LIST_INDENT.length) + 1;

  const bullet = BULLET_RE.exec(body);
  if (bullet) return { indent, item: { kind: "bullet", level, path: [], text: bullet[2] ?? "" } };

  const dot = DOT_RE.exec(body);
  if (dot) {
    const path = (dot[1] ?? "").split(".").map((part) => Number(part) || 1);
    return { indent, item: { kind: "dot", level, path, text: dot[2] ?? "" } };
  }

  const paren = PAREN_RE.exec(body);
  if (paren) {
    const path = (paren[1] ?? "").split(".").map((part) => Number(part) || 1);
    return { indent, item: { kind: "paren", level, path, text: paren[2] ?? "" } };
  }

  const deepLetter = LETTER_DEEP_RE.exec(body);
  if (deepLetter) {
    const path = (deepLetter[2] ?? "").split(".").map((part) => Number(part) || 1);
    return {
      indent,
      item: { kind: "letter", level, path, letter: deepLetter[1], text: deepLetter[3] ?? "" },
    };
  }

  const letter = LETTER_RE.exec(body);
  if (letter) return { indent, item: { kind: "letter", level, path: [], letter: letter[1], text: letter[2] ?? "" } };

  return null;
}

/** Number of a list item's level, from its leading indentation. */
export function listLevel(indent: string): number {
  return Math.min(MAX_LEVEL, Math.floor(indent.length / LIST_INDENT.length) + 1);
}

/** Renumbers every list line in a block, keeping its shape. */
export function renumberLists(lines: string[]): string[] {
  const paths: number[][] = [];
  const letters: string[] = [];
  const counters = new Map<string, number>();

  return lines.map((line) => {
    const parsed = parseListItem(line);
    if (!parsed) {
      paths.length = 0;
      letters.length = 0;
      counters.clear();
      return line;
    }
    const { item } = parsed;
    const level = listLevel(parsed.indent);
    paths.length = Math.max(0, level - 1);
    letters.length = Math.max(0, level - 1);
    const parentKey = paths.map((part) => part.join(".")).join("/");
    const key = `${item.kind}|${level}|${parentKey}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);

    let path: number[] = [];
    let letter: string | undefined;
    if (item.kind === "letter" && level === 1) {
      letter = LETTERS[(next - 1) % LETTERS.length] ?? "a";
      letters.push(letter);
    } else {
      path = [...(paths[level - 2] ?? []), next];
      paths.push(path);
      if (item.kind === "letter") letter = letters[level - 2];
    }
    return parsed.indent + listMarker(item.kind, level, path, letter) + item.text;
  });
}

/** Adds, changes or removes markers across the selected lines. */
export function applyListStyle(
  text: string,
  start: number,
  end: number,
  kind: ListKind,
): { start: number; end: number; insert: string; removed: boolean } {
  const from = lineStart(text, start);
  const stop = text.indexOf("\n", Math.max(end, start));
  const to = stop === -1 ? text.length : stop;
  // Renumber the whole block, not just the selection, so parents keep their numbers.
  const lines = text.split("\n");
  const firstLine = text.slice(0, from).split("\n").length - 1;
  const lastLine = firstLine + text.slice(from, to).split("\n").length - 1;
  const parsed = lines.map((line, index) => (index >= firstLine && index <= lastLine ? parseListItem(line) : null));

  const allSame =
    parsed.every((entry) => entry !== null && entry.item.kind === kind) && parsed.some(Boolean);
  const rewritten = lines.map((line, index) => {
    if (index < firstLine || index > lastLine) return line;
    if (allSame) {
      const entry = parsed[index]!;
      return entry.indent + entry.item.text;
    }
    const entry = parsed[index];
    if (entry) {
      const path = entry.item.path.length ? entry.item.path : [1];
      return entry.indent + listMarker(kind, listLevel(entry.indent), path, entry.item.letter) + entry.item.text;
    }
    if (index < firstLine || index > lastLine) return line;
    // A plain line gets a placeholder marker; renumberLists gives it its number below.
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    return indent + listMarker(kind, listLevel(indent), [1], "a") + line.slice(indent.length);
  });
  const insert = renumberLists(rewritten).join("\n");
  return { start: 0, end: text.length, insert, removed: allSame };
}

/** Enter inside a list continues it: same kind and level, next number or the same glyph. */
export function continueList(text: string, caret: number): TextChange | null {
  const from = lineStart(text, caret);
  const before = text.slice(from, caret);
  const parsed = parseListItem(before);
  if (!parsed) return null;
  if (!parsed.item.text.trim()) {
    // Enter on an empty item ends the list rather than adding a marker.
    return { start: from, end: caret, insert: "" };
  }
  const level = listLevel(parsed.indent);
  const path = [...parsed.item.path];
  if (path.length) path[path.length - 1] = (path[path.length - 1] ?? 0) + 1;
  const marker = listMarker(parsed.item.kind, level, path, parsed.item.letter);
  return { start: caret, end: caret, insert: `\n${parsed.indent}${marker}` };
}

/** Tab / Shift+Tab on list lines: move the selection one nesting level. */
export function indentList(
  text: string,
  start: number,
  end: number,
  delta: 1 | -1,
): { start: number; end: number; insert: string } | null {
  const from = lineStart(text, start);
  const stop = text.indexOf("\n", Math.max(end, start));
  const to = stop === -1 ? text.length : stop;
  const lines = text.split("\n");
  const firstLine = text.slice(0, from).split("\n").length - 1;
  const lastLine = firstLine + text.slice(from, to).split("\n").length - 1;
  const isList = lines.some((line, index) => index >= firstLine && index <= lastLine && parseListItem(line) !== null);
  if (!isList) return null;

  const moved = lines.map((line, index) => {
    if (index < firstLine || index > lastLine) return line;
    if (delta > 0) {
      const level = parseListItem(line) ? listLevel(/^[ \t]*/.exec(line)?.[0] ?? "") : 0;
      return level >= MAX_LEVEL ? line : LIST_INDENT + line;
    }
    return line.startsWith(LIST_INDENT) ? line.slice(LIST_INDENT.length) : line.replace(/^\t/, "");
  });
  return { start: 0, end: text.length, insert: renumberLists(moved).join("\n") };
}

/** Start offset of the line containing `at`. */
function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
}
