/**
 * Ink palette, addressed by the ids stored in marks (ids are stable; do not renumber).
 *
 * `bright` inks fail contrast on the light skins (roughly 1.5-2.2:1 on white or cream),
 * so the editor only offers them while a dark skin (Blueprint, Terminal) is active.
 * Documents that already carry them still render; the choice is just not offered.
 * Orange and red stay dark enough to remain legible, so they are not flagged.
 */
export const INKS = [
  { id: 0, name: "Black", color: "var(--ink)", bright: false },
  { id: 1, name: "Wax red", color: "#9c3b2e", bright: false },
  { id: 2, name: "Blue", color: "#1e4f8c", bright: false },
  { id: 3, name: "Green", color: "#2f5a2c", bright: false },
  { id: 4, name: "Pencil", color: "#5a544c", bright: false },
  { id: 5, name: "Dark orange", color: "#cc5a1e", bright: true },
  { id: 6, name: "Red", color: "#d81f26", bright: true },
  { id: 7, name: "Matrix green", color: "#00d83d", bright: true },
  { id: 8, name: "Silver neon", color: "#a7b0bc", bright: true },
  { id: 9, name: "Gold", color: "#d9a521", bright: true },
] as const;

export const HIGHLIGHTERS = [
  { id: 0, name: "None", color: "transparent" },
  { id: 1, name: "Yellow", color: "#f0d44a" },
  { id: 2, name: "Pink", color: "#ef8fa8" },
  { id: 3, name: "Green", color: "#9ed47a" },
  { id: 4, name: "Blue", color: "#8ebef0" },
] as const;

export const FLAG = { bold: 1, italic: 2, underline: 4, strike: 8 } as const;
export type FlagName = keyof typeof FLAG;

export type Mark = { start: number; end: number; flags: number; ink: number; hl: number };

export function readMarks(flat: ArrayLike<number>): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i + 4 < flat.length; i += 5) {
    out.push({
      start: flat[i] ?? 0,
      end: flat[i + 1] ?? 0,
      flags: flat[i + 2] ?? 0,
      ink: flat[i + 3] ?? 0,
      hl: flat[i + 4] ?? 0,
    });
  }
  return out;
}

export function flattenMarks(marks: Mark[]): number[] {
  return marks.flatMap((m) => [m.start, m.end, m.flags, m.ink, m.hl]);
}

/** True when every character in `start..end` carries `flag`. */
export function rangeHas(marks: Mark[], start: number, end: number, flag: number): boolean {
  if (end <= start) return false;
  let cursor = start;
  for (const m of marks) {
    if (m.end <= cursor || !(m.flags & flag)) continue;
    if (m.start > cursor) return false;
    cursor = m.end;
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

/** Renders text into HTML, layering style marks and temporary search hits. */
export function paint(
  text: string,
  marks: Mark[] = [],
  /**
   * Temporary highlights: the current Find match and/or every match of the strip search.
   * They are painted, never stored — clearing the query repaints the plain text.
   */
  hits?: ArrayLike<{ start: number; end: number }> | null,
): string {
  const len = text.length;
  const points = new Set<number>([0, len]);
  const styled = marks
    .map((m) => ({ ...m, start: Math.min(m.start, len), end: Math.min(m.end, len) }))
    .filter((m) => m.end > m.start);
  for (const m of styled) {
    points.add(m.start);
    points.add(m.end);
  }
  const found = hits
    ? Array.from({ length: hits.length }, (_, i) => hits[i]!)
        .map((h) => ({ start: Math.min(h.start, len), end: Math.min(h.end, len) }))
        .filter((h) => h.end > h.start)
        .sort((a, b) => a.start - b.start)
    : [];
  for (const h of found) {
    points.add(h.start);
    points.add(h.end);
  }
  if (styled.length === 0 && found.length === 0) return esc(text);
  const cuts = [...points].sort((a, b) => a - b);
  let html = "";
  let mi = 0;
  let fi = 0;
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    while (mi < styled.length && styled[mi]!.end <= a) mi += 1;
    const mk = styled[mi] && styled[mi]!.start <= a ? styled[mi] : undefined;
    const body = esc(text.slice(a, b));
    const classes: string[] = [];
    if (mk) {
      if (mk.flags & FLAG.bold) classes.push("sb");
      if (mk.flags & FLAG.italic) classes.push("si");
      if (mk.flags & FLAG.underline) classes.push("su");
      if (mk.flags & FLAG.strike) classes.push("ss");
      if (mk.ink) classes.push(`ink${mk.ink}`);
      if (mk.hl) classes.push(`hl${mk.hl}`);
    }
    while (fi < found.length && found[fi]!.end <= a) fi += 1;
    if (found[fi] && found[fi]!.start <= a) classes.push("find-hit");
    html += classes.length ? `<span class="${classes.join(" ")}">${body}</span>` : body;
  }
  return html;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
