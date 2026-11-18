/**
 * Minimal URL helpers: find the http(s) URLs in a block of text, find the one under a
 * caret, open it.
 *
 * Trailing sentence punctuation is stripped so "see https://a.com." still works, and the
 * spans are what the paste path turns into links (see `links.ts`).
 */

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)]+$/g, "");
}

/** One URL inside a string: half-open `[start, end)` character offsets. */
export type UrlSpan = { start: number; end: number; url: string };

/** Every http(s) URL in `text`, in order, with trailing punctuation excluded. */
export function urlSpans(text: string): UrlSpan[] {
  if (!text) return [];
  const out: UrlSpan[] = [];
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text))) {
    const start = match.index;
    const url = trimTrailingPunct(match[0] ?? "");
    if (url.length > 0) out.push({ start, end: start + url.length, url });
    // Avoid zero-length loops on odd engines.
    if (match.index === URL_RE.lastIndex) URL_RE.lastIndex += 1;
  }
  return out;
}

/** The http(s) URL that covers `pos`, or null. */
export function urlAt(text: string, pos: number): string | null {
  if (!text || pos < 0) return null;
  const at = Math.min(pos, text.length);
  for (const span of urlSpans(text)) {
    if (at >= span.start && at <= span.end) return span.url;
  }
  return null;
}

export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
