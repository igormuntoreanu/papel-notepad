/**
 * Turns clipboard `text/html` into plain text plus bold, italic, underline, and strike ranges.
 * Fonts, sizes, and colours from Word/PDF are discarded; Papel stays monospace.
 *
 * Pure string walk so unit tests run under `node --test` without a DOM.
 */

export type StyleRun = {
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

export type HtmlPaste = { text: string; runs: StyleRun[] };

const BLOCK = new Set([
  "p",
  "div",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "section",
  "article",
  "header",
  "footer",
  "blockquote",
  "pre",
]);

const SKIP = new Set(["script", "style", "noscript", "meta", "link", "title", "head"]);

type Frame = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; tag: string };

function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
}

function tagBold(tag: string, attrs: string, inherited: boolean): boolean {
  if (tag === "b" || tag === "strong") return true;
  if (/font-weight\s*:\s*(bold|[7-9]00)/i.test(attrs)) return true;
  if (/font-weight\s*:\s*(normal|400)/i.test(attrs)) return false;
  return inherited;
}

function tagItalic(tag: string, attrs: string, inherited: boolean): boolean {
  if (tag === "i" || tag === "em" || tag === "cite") return true;
  if (/font-style\s*:\s*italic/i.test(attrs)) return true;
  if (/font-style\s*:\s*normal/i.test(attrs)) return false;
  return inherited;
}

function tagUnderline(tag: string, attrs: string, inherited: boolean): boolean {
  if (tag === "u" || tag === "ins") return true;
  if (/text-decoration(?:-line)?\s*:\s*[^;]*underline/i.test(attrs)) return true;
  if (/text-decoration(?:-line)?\s*:\s*none/i.test(attrs)) return false;
  return inherited;
}

function tagStrike(tag: string, attrs: string, inherited: boolean): boolean {
  if (tag === "s" || tag === "del" || tag === "strike") return true;
  if (/text-decoration(?:-line)?\s*:\s*[^;]*line-through/i.test(attrs)) return true;
  if (/text-decoration(?:-line)?\s*:\s*none/i.test(attrs)) return false;
  return inherited;
}

/**
 * Parse HTML clipboard markup into text and style runs.
 * Adjacent runs with the same flags are merged.
 */
export function parseHtmlClipboard(html: string): HtmlPaste {
  if (!html.trim()) return { text: "", runs: [] };

  // Prefer the fragment Word puts in <!--StartFragment--> … <!--EndFragment-->.
  const frag = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i.exec(html);
  const source = frag?.[1] ?? html;

  const parts: string[] = [];
  const raw: StyleRun[] = [];
  let offset = 0;
  let pendingBreak = false;
  const stack: Frame[] = [{ bold: false, italic: false, underline: false, strike: false, tag: "" }];
  let i = 0;
  let skipping: string | null = null;

  const pushBreak = () => {
    if (parts.length === 0) return;
    if (parts[parts.length - 1]?.endsWith("\n")) return;
    parts.push("\n");
    offset += 1;
  };

  const pushText = (chunk: string) => {
    let text = decodeEntities(chunk).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
    // Collapse runs of spaces from Word's layout padding, keep newlines.
    text = text.replace(/[^\S\n]+/g, " ");
    if (!text || (text === " " && parts.length === 0)) return;
    if (pendingBreak) {
      pushBreak();
      pendingBreak = false;
    }
    const top = stack[stack.length - 1]!;
    const start = offset;
    parts.push(text);
    offset += text.length;
    if (top.bold || top.italic || top.underline || top.strike) {
      raw.push({
        start,
        end: offset,
        bold: top.bold,
        italic: top.italic,
        underline: top.underline,
        strike: top.strike,
      });
    }
  };

  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source[i] === "<") {
      const close = source.indexOf(">", i + 1);
      if (close === -1) break;
      const inner = source.slice(i + 1, close).trim();
      i = close + 1;
      if (!inner) continue;
      if (inner.startsWith("!")) continue;
      const isClose = inner.startsWith("/");
      const body = isClose ? inner.slice(1).trim() : inner;
      const selfClosing = !isClose && /\/\s*$/.test(body);
      const match = /^([a-zA-Z][\w:-]*)/.exec(body);
      if (!match) continue;
      const tag = match[1]!.toLowerCase();
      const bare = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
      const attrs = body.slice(match[0].length);

      if (skipping) {
        if (isClose && (bare === skipping || tag === skipping)) skipping = null;
        continue;
      }
      if (!isClose && SKIP.has(bare)) {
        skipping = bare;
        continue;
      }

      if (bare === "br" || (selfClosing && bare === "br")) {
        pushBreak();
        pendingBreak = false;
        continue;
      }

      if (isClose) {
        // Pop until matching tag.
        for (let s = stack.length - 1; s >= 1; s -= 1) {
          if (stack[s]!.tag === bare) {
            stack.length = s;
            break;
          }
        }
        if (BLOCK.has(bare)) pendingBreak = true;
        continue;
      }

      if (BLOCK.has(bare) && parts.length > 0) pendingBreak = true;
      const parent = stack[stack.length - 1]!;
      stack.push({
        tag: bare,
        bold: tagBold(bare, attrs, parent.bold),
        italic: tagItalic(bare, attrs, parent.italic),
        underline: tagUnderline(bare, attrs, parent.underline),
        strike: tagStrike(bare, attrs, parent.strike),
      });
      if (selfClosing) stack.pop();
      continue;
    }

    const next = source.indexOf("<", i);
    const chunk = next === -1 ? source.slice(i) : source.slice(i, next);
    i = next === -1 ? source.length : next;
    if (!skipping) pushText(chunk);
  }

  let text = parts.join("");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n+$/, "").replace(/^\n+/, "");
  const runs = mergeRuns(raw.filter((r) => r.end <= text.length && r.end > r.start));
  return { text, runs };
}

function mergeRuns(runs: StyleRun[]): StyleRun[] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: StyleRun[] = [];
  for (const run of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.end >= run.start &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.underline === run.underline &&
      last.strike === run.strike
    ) {
      last.end = Math.max(last.end, run.end);
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/** True when the HTML clipboard likely carries emphasis worth preserving. */
export function htmlHasEmphasis(html: string): boolean {
  if (!html) return false;
  return (
    /<\s*(b|strong|i|em|u|ins|s|del|strike)\b/i.test(html) ||
    /font-weight\s*:\s*(bold|[7-9]00)/i.test(html) ||
    /font-style\s*:\s*italic/i.test(html) ||
    /text-decoration(?:-line)?\s*:\s*[^;"]*(?:underline|line-through)/i.test(html)
  );
}

/**
 * Pull a rectangular cell grid out of clipboard HTML (Excel / Sheets / LibreOffice).
 * Returns null when there is no real `<table>` with at least two cells.
 */
export function parseHtmlTable(html: string): string[][] | null {
  if (!html.trim() || !/<\s*table\b/i.test(html)) return null;

  const frag = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i.exec(html);
  const source = frag?.[1] ?? html;
  const tableMatch = /<\s*table\b[^>]*>([\s\S]*?)<\s*\/\s*table\s*>/i.exec(source);
  if (!tableMatch?.[1]) return null;

  const rows: string[][] = [];
  const rowRe = /<\s*tr\b[^>]*>([\s\S]*?)<\s*\/\s*tr\s*>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
    const cells: string[] = [];
    const cellRe = /<\s*t[dh]\b[^>]*>([\s\S]*?)<\s*\/\s*t[dh]\s*>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      const raw = cellMatch[1]!
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\u00a0/g, " ");
      cells.push(decodeEntities(raw).replace(/\r\n?/g, "\n").trim());
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.length));
  if (width < 2 && rows.length < 2) return null;
  if (width < 1) return null;
  return rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
}
