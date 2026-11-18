/**
 * The Ctrl/Cmd-hover affordance for links.
 *
 * A link is plain text (see `links.ts`), so the browser has no idea it is clickable and
 * shows the ordinary I-beam. Making the *styled run* a pointer in CSS would be wrong: it
 * would promise a click that only works with the modifier held, and it would fire on any
 * hand-underlined blue text. So the pointer appears only while the modifier is down and the
 * pointer is actually over a URL — the same predicate the click uses.
 *
 * The modifier is read from each mouse event (`ctrlKey`/`metaKey`) *and* tracked from
 * keydown/keyup, because neither alone is enough: hold Ctrl without moving and no
 * mousemove arrives to turn the pointer on; release Ctrl over a stationary mouse and none
 * arrives to turn it off. `blur` covers the window losing focus mid-gesture, which would
 * otherwise leave a stuck pointer.
 */
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

/** Maps viewport coordinates to the URL under them, or null. */
type HitTest = (x: number, y: number) => string | null;

/** Paints (or clears) the affordance for `url`. */
type Apply = (url: string | null) => void;

export type LinkHover = {
  /** Wire to the editor's `onMouseMove`. */
  move: (e: ReactMouseEvent) => void;
  /** Wire to the editor's `onMouseLeave`: the pointer can leave without another mousemove. */
  leave: () => void;
};

export function useLinkHover(hitTest: HitTest, apply: Apply): LinkHover {
  // The callbacks close over session/block state, so keep the latest ones reachable from
  // the window listeners registered once.
  const hit = useRef(hitTest);
  const set = useRef(apply);
  hit.current = hitTest;
  set.current = apply;
  const point = useRef<{ x: number; y: number } | null>(null);
  const shown = useRef<string | null>(null);

  function refresh(modifier: boolean) {
    const p = point.current;
    const url = modifier && p ? hit.current(p.x, p.y) : null;
    if (url === shown.current) return;
    shown.current = url;
    set.current(url);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") refresh(e.type === "keydown");
    };
    const onBlur = () => refresh(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      shown.current = null;
      set.current(null);
    };
  }, []);

  return {
    move: (e) => {
      point.current = { x: e.clientX, y: e.clientY };
      refresh(e.ctrlKey || e.metaKey);
    },
    leave: () => {
      point.current = null;
      refresh(false);
    },
  };
}

/** The attribute both renderers set while a link is hovered with the modifier down. */
export const LINK_HOVER_ATTR = "data-link-hover";

/** Writes the hover affordance and the native tooltip, or clears both. */
export function paintLinkHover(el: HTMLElement | null, url: string | null): void {
  if (!el) return;
  if (!url) {
    if (el.hasAttribute(LINK_HOVER_ATTR)) {
      delete el.dataset.linkHover;
      el.removeAttribute("title");
    }
    return;
  }
  if (el.dataset.linkHover !== url) el.dataset.linkHover = url;
  if (el.title !== url) el.title = url;
}
