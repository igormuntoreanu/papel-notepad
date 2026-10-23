import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { Session } from "@/lib/quire/engine";
import { correctionAt } from "@/lib/quire/autocorrect";
import { continueBullet } from "@/lib/quire/blocks";
import { paint, readMarks } from "@/lib/quire/marks";
import { diffText } from "@/lib/quire/text";
import type { Place } from "./store";

/**
 * Notes up to this size repaint their highlight on every keystroke. That covers
 * roughly sixteen pages of prose, comfortably past the ten-page target.
 *
 * The repaint is linear in note size: measured at ~0.9 µs per character, so
 * 50k costs about 36 ms of blocking work and 250k about 227 ms — several
 * dropped frames per key. Above the limit the words stay live and the colours
 * wait for a pause.
 */
const EXACT_LIMIT = 50_000;
/**
 * A large note still gets its colours once when opened, and again when the
 * field loses focus — but only up to this size. Past it a repaint costs
 * seconds, which is worse than leaving the note plain.
 */
const COLOUR_LIMIT = 500_000;

export function TextBlock({
  noteId,
  blockId,
  session,
  wrap,
  grow,
  tick,
  focusRef,
  autocorrect,
  findHit,
  onSelection,
  onEdited,
  onImage,
}: {
  noteId: string;
  blockId: number;
  session: Session;
  wrap: boolean;
  grow: boolean;
  tick: number;
  focusRef: MutableRefObject<Place | null>;
  autocorrect: boolean;
  /** Current Find match in this block — kept painted while Find stays focused. */
  findHit?: { start: number; end: number } | null;
  onSelection: (start: number, end: number) => void;
  onEdited: () => void;
  onImage: (file: File) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const prev = useRef(session.text_of(blockId));
  const lastAt = useRef(0);
  const composing = useRef(false);
  const fresh = useRef(false);
  /** Above EXACT_LIMIT the overlay has already shown its colours for a block. */
  const exactShown = useRef<{ block: number; done: boolean }>({ block: -1, done: false });

  const paintExact = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.innerHTML = paint(
      ta.value,
      session.highlight(blockId),
      readMarks(session.marks(blockId)),
      findHit && findHit.end > findHit.start ? findHit : null,
    );
    fit(ta, wrap);
  };

  const paintNow = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    const size = ta.value.length;
    if (size > EXACT_LIMIT) {
      // Large note: the words stay live, the colours wait. Above COLOUR_LIMIT a
      // repaint costs seconds, so it is not even offered automatically.
      if (exactShown.current.block !== blockId) exactShown.current = { block: blockId, done: false };
      if (!exactShown.current.done && size <= COLOUR_LIMIT) {
        exactShown.current.done = true;
        paintExact();
        return;
      }
      pre.textContent = ta.value;
      fit(ta, wrap);
      return;
    }
    paintExact();
  };

  /** Leaving the field is the one moment colour can come back for a large note. */
  const paintOnBlur = () => {
    const ta = taRef.current;
    if (!ta) return;
    const size = ta.value.length;
    if (size > EXACT_LIMIT && size <= COLOUR_LIMIT) paintExact();
  };

  const report = () => {
    const ta = taRef.current;
    if (ta) onSelection(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
  };
  const reportRef = useRef(report);
  reportRef.current = report;

  // React's onSelect misses selection changes Chrome reports on the textarea itself
  // (script, touch handles, select-all), so listen natively as well.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const onChange = () => {
      if (document.activeElement === ta) reportRef.current();
    };
    ta.addEventListener("selectionchange", onChange);
    document.addEventListener("selectionchange", onChange);
    return () => {
      ta.removeEventListener("selectionchange", onChange);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const next = session.text_of(blockId);
    if (ta.value !== next) {
      ta.value = next;
      prev.current = next;
      paintNow();
    } else if (!fresh.current) {
      paintNow();
    }
    fresh.current = false;
    const focus = focusRef.current;
    if (focus && focus.block_id === blockId) {
      // preventScroll stays ON. The editor stretches to fill the sheet, so on a
      // phone "scroll the focused element into view" reveals its bottom edge —
      // that is the jump to the bottom people see after tapping New sheet.
      // The caret is placed by hand instead, which we can do precisely.
      // Keep Find focused when a findHit is active so typing the query still works;
      // the match stays visible via the overlay `.find-hit` class.
      if (!findHit || findHit.end <= findHit.start) {
        ta.focus({ preventScroll: true });
      }
      const pos = Math.min(focus.start, ta.value.length);
      const end = Math.min(focus.end, ta.value.length);
      try {
        ta.setSelectionRange(pos, end);
      } catch {
        /* some browsers refuse setSelectionRange when not focused */
      }
      revealCaret(ta);
      focusRef.current = null;
      onSelection(pos, end);
    } else if (findHit && findHit.end > findHit.start) {
      // Re-paint when the Find highlight moves without a focus handoff.
      paintNow();
    }
  }, [tick, wrap, blockId, findHit?.start, findHit?.end]);

  function sync(coalesce: boolean, typed?: string | null) {
    const ta = taRef.current;
    if (!ta || composing.current) return;
    const next = ta.value;
    const was = prev.current;
    if (next === was) {
      paintNow();
      return;
    }
    const d = diffText(was, next);
    session.edit(blockId, d.start, d.end, d.inserted, coalesce);
    prev.current = next;
    if (autocorrect && typed && typed.length === 1 && session.effective_language(blockId) === "plain") {
      const caret = ta.selectionStart ?? 0;
      const fix = correctionAt(ta.value, caret);
      if (fix) {
        session.edit(blockId, fix.start, fix.end, fix.replacement, false);
        const fixed = session.text_of(blockId);
        const shift = fix.replacement.length - (fix.end - fix.start);
        ta.value = fixed;
        prev.current = fixed;
        ta.setSelectionRange(caret + shift, caret + shift);
      }
    }
    paintNow();
    // sync() already painted this text; the re-render it triggers can skip painting again.
    fresh.current = true;
    report();
    onEdited();
  }

  return (
    <div className={grow ? "block grow" : "block"} data-note={noteId}>
      <pre ref={preRef} className="hl" aria-hidden="true" />
      <textarea
        ref={taRef}
        className="editor"
        aria-label="Note"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        defaultValue={prev.current}
        onFocus={report}
        onBlur={paintOnBlur}
        onSelect={report}
        onKeyUp={report}
        onClick={report}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          sync(false);
        }}
        onInput={(e) => {
          const native = e.nativeEvent as InputEvent;
          if (native.isComposing || composing.current) return;
          const now = performance.now();
          const burst = now - lastAt.current < 700;
          lastAt.current = now;
          const small =
            native.inputType === "insertText" ||
            native.inputType === "deleteContentBackward" ||
            native.inputType === "deleteContentForward";
          sync(burst && small, native.inputType === "insertText" ? native.data : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ta = e.currentTarget;
            const at = ta.selectionStart ?? 0;
            if (at !== (ta.selectionEnd ?? at)) return;
            // `ta.value` is the block text already: reading it here avoids a
            // full copy out of WASM on every Enter press.
            const text = ta.value;
            const change = continueBullet(text, at);
            if (!change) return;
            e.preventDefault();
            session.edit(blockId, change.start, change.end, change.insert, false);
            const next = text.slice(0, change.start) + change.insert + text.slice(change.end);
            const pos = change.start + change.insert.length;
            ta.value = next;
            prev.current = next;
            ta.setSelectionRange(pos, pos);
            paintNow();
            report();
            onEdited();
            return;
          }
          if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart ?? 0;
            const end = ta.selectionEnd ?? start;
            session.edit(blockId, start, end, "\t", false);
            const next = session.text_of(blockId);
            ta.value = next;
            prev.current = next;
            ta.setSelectionRange(start + 1, start + 1);
            paintNow();
            report();
            onEdited();
          }
        }}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (!file) return;
              e.preventDefault();
              const ta = e.currentTarget;
              const start = ta.selectionStart ?? 0;
              const end = ta.selectionEnd ?? start;
              if (start !== end) {
                session.edit(blockId, start, end, "", false);
                const next = session.text_of(blockId);
                ta.value = next;
                prev.current = next;
              }
              onSelection(start, start);
              onImage(file);
              return;
            }
          }
        }}
      />
    </div>
  );
}

/** Brings the top of the editor into view without letting the page scroll. */
function revealCaret(ta: HTMLTextAreaElement) {
  const sheet = ta.closest(".sheet");
  if (!sheet) return;
  const box = ta.getBoundingClientRect();
  const view = sheet.getBoundingClientRect();
  if (box.top < view.top || box.top > view.bottom - 24) {
    sheet.scrollTop += box.top - view.top - 12;
  }
}

function fit(ta: HTMLTextAreaElement, wrap: boolean) {
  ta.style.height = "0px";
  if (!wrap) {
    ta.style.width = "0px";
    ta.style.width = `${Math.max(ta.scrollWidth, ta.parentElement?.clientWidth ?? 0)}px`;
  } else {
    ta.style.width = "100%";
  }
  ta.style.height = `${ta.scrollHeight}px`;
}
