import { useEffect, useRef, useState, type ReactNode } from "react";

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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={className ?? "tool"}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {label}
      </button>
      {open && (
        <div className="popover" data-align={align ?? "start"} role="menu" onClick={() => setOpen(false)}>
          {items}
        </div>
      )}
    </div>
  );
}
