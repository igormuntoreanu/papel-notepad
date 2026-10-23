export const INKS = [
  { id: 0, name: "Black", color: "var(--ink)" },
  { id: 1, name: "Wax red", color: "#9c3b2e" },
  { id: 2, name: "Blue", color: "#1e4f8c" },
  { id: 3, name: "Green", color: "#2f5a2c" },
  { id: 4, name: "Pencil", color: "#5a544c" },
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

const KIND = ["", "k", "t", "s", "c", "n", "f", "g", "a", "b", "m"];

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

/** Renders text into HTML, layering syntax spans (triples) and style marks. */
export function paint(
  text: string,
  spans: ArrayLike<number>,
  marks: Mark[] = [],
  /** Current Find match — painted even when the textarea is not focused. */
  findHit?: { start: number; end: number } | null,
): string {
  const len = text.length;
  const points = new Set<number>([0, len]);
  const syn: { s: number; e: number; cls: string }[] = [];
  for (let i = 0; i + 2 < spans.length; i += 3) {
    const s = Math.min(spans[i] ?? 0, len);
    const e = Math.min(spans[i + 1] ?? 0, len);
    const cls = KIND[spans[i + 2] ?? 0] ?? "";
    if (e > s && cls) {
      syn.push({ s, e, cls });
      points.add(s);
      points.add(e);
    }
  }
  const styled = marks
    .map((m) => ({ ...m, start: Math.min(m.start, len), end: Math.min(m.end, len) }))
    .filter((m) => m.end > m.start);
  for (const m of styled) {
    points.add(m.start);
    points.add(m.end);
  }
  const hit =
    findHit && findHit.end > findHit.start
      ? { start: Math.min(findHit.start, len), end: Math.min(findHit.end, len) }
      : null;
  if (hit && hit.end > hit.start) {
    points.add(hit.start);
    points.add(hit.end);
  }
  if (syn.length === 0 && styled.length === 0 && !hit) return esc(text);
  const cuts = [...points].sort((a, b) => a - b);
  let html = "";
  let si = 0;
  let mi = 0;
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    while (si < syn.length && syn[si]!.e <= a) si += 1;
    while (mi < styled.length && styled[mi]!.end <= a) mi += 1;
    const sy = syn[si] && syn[si]!.s <= a ? syn[si] : undefined;
    const mk = styled[mi] && styled[mi]!.start <= a ? styled[mi] : undefined;
    const body = esc(text.slice(a, b));
    const classes: string[] = [];
    if (sy) classes.push(sy.cls);
    if (mk) {
      if (mk.flags & FLAG.bold) classes.push("sb");
      if (mk.flags & FLAG.italic) classes.push("si");
      if (mk.flags & FLAG.underline) classes.push("su");
      if (mk.flags & FLAG.strike) classes.push("ss");
      if (mk.ink) classes.push(`ink${mk.ink}`);
      if (mk.hl) classes.push(`hl${mk.hl}`);
    }
    if (hit && hit.start <= a && hit.end > a) classes.push("find-hit");
    html += classes.length ? `<span class="${classes.join(" ")}">${body}</span>` : body;
  }
  return html;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
