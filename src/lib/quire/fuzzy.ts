export type SearchDoc = { id: string; title: string; text: string };
export type SearchHit = { id: string; score: number; snippet: string };

export const MIN_QUERY = 3;

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function words(text: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = [];
  const re = /[\p{L}\p{N}_'-]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ word: m[0].toLowerCase(), at: m.index });
  return out;
}

/** Bounded Levenshtein distance; returns `max + 1` once the distance is known to exceed `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

function snippetAt(text: string, at: number, size = 90): string {
  const flat = text.replace(/\s+/g, " ");
  const ratio = text.length ? flat.length / text.length : 1;
  const pos = Math.round(at * ratio);
  const start = Math.max(0, pos - 30);
  const end = Math.min(flat.length, start + size);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/**
 * Typo-tolerant search over note titles and bodies. Every query word must match
 * a title or body by substring, a close spelling, or (titles only) a subsequence.
 */
export function searchNotes(query: string, docs: SearchDoc[]): SearchHit[] {
  const terms = tokens(query);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const title = doc.title.toLowerCase();
    const body = doc.text.toLowerCase();
    let bodyWords: { word: string; at: number }[] | null = null;
    let score = 0;
    let firstAt = -1;
    let ok = true;
    for (const term of terms) {
      let best = 0;
      if (title.includes(term)) best = Math.max(best, title.startsWith(term) ? 6 : 5);
      const at = body.indexOf(term);
      if (at >= 0) {
        best = Math.max(best, 4);
        if (firstAt < 0) firstAt = at;
      }
      if (best === 0 && term.length >= 3) {
        bodyWords ??= words(doc.text);
        const max = term.length >= 6 ? 2 : 1;
        for (const w of [...words(doc.title), ...bodyWords]) {
          const d = distance(term, w.word.slice(0, term.length + max), max);
          if (d <= max) {
            best = Math.max(best, 3 - d);
            if (firstAt < 0 && bodyWords.includes(w)) firstAt = w.at;
            if (best === 3) break;
          }
        }
      }
      if (best === 0 && isSubsequence(term, title)) best = 0.5;
      if (best === 0) {
        ok = false;
        break;
      }
      score += best;
    }
    if (!ok) continue;
    hits.push({ id: doc.id, score, snippet: firstAt >= 0 ? snippetAt(doc.text, firstAt) : "" });
  }
  return hits.sort((a, b) => b.score - a.score);
}
