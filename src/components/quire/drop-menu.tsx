import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const MARGIN = 8;
/** Rough height used only to decide whether to flip above the trigger. */
const ESTIMATE = 280;

/**
 * A trigger plus a popover.
 *
 * The popover is portalled out of the component tree and positioned against the
 * viewport. That is not decoration: menus used to be absolutely positioned
 * children of the header row and of cards, which are separate stacking contexts
 * (`z-index: 1` on their content), so a `z-index` on the popover could not lift
 * it above the next row or the next card — Paper/Ink/Carbon rendered behind the
 * Sort field, and a card's menu behind the card below it.
 *
 * The portal target is the `.desk` element rather than `body` so the popover
 * still inherits the active skin's CSS variables (paper colour, grain, ink).
 */
export function DropMenu({
  label,
  items,
  align,
  className,
  ariaLabel,
  title,
}: {
  label: ReactNode;
  items: ReactNode;
  align?: "end" | "up" | "up-end";
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const flipUp =
      align === "up" || align === "up-end" || (align !== "end" && below < ESTIMATE && above > below);
    const toEnd = align === "end" || align === "up-end";

    const next: CSSProperties = { position: "fixed" };
    if (flipUp) next.bottom = vh - rect.top + GAP;
    else next.top = rect.bottom + GAP;
    if (toEnd) next.right = Math.max(MARGIN, vw - rect.right);
    else next.left = Math.max(MARGIN, rect.left);
    setStyle(next);
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onResize = () => place();
    // Any scroll outside the menu moves the trigger away from the fixed
    // popover, so the menu closes instead of drifting. Scrolling inside the
    // menu itself is its own business.
    const onScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const host =
    typeof document === "undefined"
      ? null
      : (buttonRef.current?.closest(".desk") ?? document.body);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className ?? "tool"}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {label}
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={popoverRef}
            className="popover"
            style={style}
            role="menu"
            onClick={() => setOpen(false)}
          >
            {items}
          </div>,
          host,
        )}
    </>
  );
}
