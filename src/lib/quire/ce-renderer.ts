/**
 * The contenteditable per-line renderer is the DEFAULT editor as of 0.4.0. It aligns each
 * line independently (Word-style), applies per-line paragraph styles, and aligns table cells
 * per cell - none of which the legacy single-`<textarea>` renderer can express.
 *
 * Opt back into the legacy textarea renderer (e.g. to A/B a regression) with `?ce=0` or
 * `localStorage.setItem("papel-ce", "0")` and a reload.
 */
export function ceRendererOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (new URLSearchParams(window.location.search).get("ce") === "0") return false;
    if (window.localStorage.getItem("papel-ce") === "0") return false;
    return true;
  } catch {
    return true;
  }
}
