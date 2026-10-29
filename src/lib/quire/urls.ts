/**
 * Minimal URL helpers: find an http(s) URL under a caret, open it.
 * Trailing sentence punctuation is stripped so "see https://a.com." still works.
 */

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)]+$/g, "");
}

/** The http(s) URL that covers `pos`, or null. */
export function urlAt(text: string, pos: number): string | null {
  if (!text || pos < 0) return null;
  const at = Math.min(pos, text.length);
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text))) {
    const start = match.index;
    const raw = match[0] ?? "";
    const cleaned = trimTrailingPunct(raw);
    const end = start + cleaned.length;
    if (at >= start && at <= end) return cleaned;
    // Avoid zero-length loops on odd engines.
    if (match.index === URL_RE.lastIndex) URL_RE.lastIndex += 1;
  }
  return null;
}

export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
