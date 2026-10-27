import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import type { Session } from "@/lib/quire/engine";
import { correctionAt } from "@/lib/quire/autocorrect";
import { continueList, indentList, renumberLists } from "@/lib/quire/lists";
import type { BlockLook } from "@/lib/quire/typefaces";
import { parseDelimited } from "@/lib/quire/blocks";
import { paint, readMarks } from "@/lib/quire/marks";
import { diffText } from "@/lib/quire/text";
import type { Place } from "./store";

/** A rectangular selection: anchor and focus as line + character column. */
type Box = { aLine: number; aCol: number; fLine: number; fCol: number };

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
  look,
  onPasteTable,
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
  /** Face and paragraph style for this block; absent means the paper default. */
  look?: BlockLook;
  /** Grid-shaped clipboard text (Excel/CSV) becomes a table instead of a paste. */
  onPasteTable: (rows: string[][]) => void;
  onSelection: (start: number, end: number) => void;
  onEdited: () => void;
  onImage: (file: File) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const prev = useRef(session.text_of(blockId));
  const lastAt = useRef(0);
  const composing = useRef(false);
  /** Set by Ctrl+Shift+V so the next paste stays text instead of becoming a table. */
  const plainPaste = useRef(false);
  const fresh = useRef(false);
  /** Above EXACT_LIMIT the overlay has already shown its colours for a block. */
  const exactShown = useRef<{ block: number; done: boolean }>({ block: -1, done: false });

  const paintExact = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.innerHTML = paint(
      ta.value,
      // No syntax spans: sheets are plain text by decision, so no code colouring is
      // requested from the engine even when a file arrived with a language hint.
      [],
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

  /** A rectangular (column) selection, in whole lines and character columns. */
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<Box | null>(null);

  const boxText = (rect: Box): string => {
    const ta = taRef.current;
    if (!ta) return "";
    const lines = ta.value.split("\n");
    const [first, last] = [Math.min(rect.aLine, rect.fLine), Math.max(rect.aLine, rect.fLine)];
    const [left, right] = [Math.min(rect.aCol, rect.fCol), Math.max(rect.aCol, rect.fCol)];
    const out: string[] = [];
    for (let line = first; line <= last; line += 1) out.push((lines[line] ?? "").slice(left, right));
    return out.join("\n");
  };

  /** Removes the rectangle, from the last line up so offsets stay valid. */
  const deleteBox = () => {
    const ta = taRef.current;
    if (!ta || !box) return;
    const lines = ta.value.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1;
    }
    const [first, last] = [Math.min(box.aLine, box.fLine), Math.max(box.aLine, box.fLine)];
    const [left, right] = [Math.min(box.aCol, box.fCol), Math.max(box.aCol, box.fCol)];
    const cuts: { start: number; end: number }[] = [];
    for (let line = first; line <= last; line += 1) {
      const length = (lines[line] ?? "").length;
      const start = starts[line]! + Math.min(left, length);
      const end = starts[line]! + Math.min(right, length);
      if (end > start) cuts.push({ start, end });
    }
    cuts.sort((a, b) => b.start - a.start);
    for (const cut of cuts) session.edit(blockId, cut.start, cut.end, "", false);
    const next = session.text_of(blockId);
    ta.value = next;
    prev.current = next;
    setBox(null);
    onEdited();
    fit(ta, wrap);
    paintExact();
  };
  return (
    <div
      className={grow ? "block grow" : "block"}
      data-note={noteId}
      data-font={look?.font ?? undefined}
      data-style={look?.style ?? undefined}
      data-align={look?.align ?? undefined}
    >
      <pre ref={preRef} className="hl" aria-hidden="true" />
      {box && taRef.current && (
        // Alt+drag selection: a rectangle over the text, independent of line ends.
        <div className="block-rect" aria-hidden="true" style={boxPixels(taRef.current, box)} />
      )}
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
        onMouseDown={(e) => {
          if (!e.altKey) {
            if (box) setBox(null);
            return;
          }
          // Column geometry needs unwrapped lines; with wrap on, Alt+drag stays a
          // normal selection.
          if (wrap) return;
          e.preventDefault();
          const point = pointAt(e.currentTarget, e.clientX, e.clientY);
          const next = { aLine: point.line, aCol: point.col, fLine: point.line, fCol: point.col };
          drag.current = next;
          setBox(next);
        }}
        onMouseMove={(e) => {
          if (!drag.current || (e.buttons & 1) === 0) return;
          const point = pointAt(e.currentTarget, e.clientX, e.clientY);
          const next = { ...drag.current, fLine: point.line, fCol: point.col };
          drag.current = next;
          setBox(next);
        }}
        onMouseUp={() => {
          drag.current = null;
        }}
        onCopy={(e) => {
          if (!box) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", boxText(box));
        }}
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
          // The box selection owns Delete/Backspace and Escape while it is painted.
          if (box && (e.key === "Delete" || e.key === "Backspace")) {
            e.preventDefault();
            deleteBox();
            return;
          }
          if (box && e.key === "Escape") {
            setBox(null);
            return;
          }
          // Ctrl+Shift+V asks for a plain paste even when the clipboard is a grid.
          if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "v" || e.key === "V")) {
            plainPaste.current = true;
            window.setTimeout(() => {
              plainPaste.current = false;
            }, 700);
          }
          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ta = e.currentTarget;
            const at = ta.selectionStart ?? 0;
            if (at !== (ta.selectionEnd ?? at)) return;
            // `ta.value` is the block text already: reading it here avoids a
            // full copy out of WASM on every Enter press.
            const text = ta.value;
            // Lists handle bullets and numbers: same level, next number.
            const change = continueList(text, at);
            if (!change) return;
            e.preventDefault();
            // The new item can push later numbers along (1., 2. becomes 1., 2., 3.), so
            // the whole block is renumbered and replaced as one undo step.
            const grown = text.slice(0, change.start) + change.insert + text.slice(change.end);
            const caretLine = (text.slice(0, change.start).match(/\n/g) ?? []).length + 1;
            const next = renumberLists(grown.split("\n")).join("\n");
            session.edit(blockId, 0, text.length, next, false);
            const lines = next.split("\n");
            const pos = lines.slice(0, caretLine).reduce((sum, line) => sum + line.length + 1, 0) + (lines[caretLine]?.length ?? 0);
            ta.value = next;
            prev.current = next;
            ta.setSelectionRange(pos, pos);
            paintNow();
            report();
            onEdited();
            return;
          }
          if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ta = e.currentTarget;
            const start = ta.selectionStart ?? 0;
            const end = ta.selectionEnd ?? start;
            // On list lines Tab nests one level and Shift+Tab lifts one; the whole
            // block is rewritten so parents keep their numbers.
            const moved = indentList(ta.value, start, end, e.shiftKey ? -1 : 1);
            if (moved) {
              e.preventDefault();
              session.edit(blockId, moved.start, moved.end, moved.insert, false);
              const next = session.text_of(blockId);
              ta.value = next;
              prev.current = next;
              const pos = Math.max(0, start + (e.shiftKey ? -2 : 2));
              ta.setSelectionRange(Math.min(pos, next.length), Math.min(pos, next.length));
              paintNow();
              report();
              onEdited();
              return;
            }
            if (e.shiftKey) return;
            e.preventDefault();
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
          // Grid-shaped text (Excel/Sheets cells, CSV) becomes a table; anything else --
          // including Ctrl+Shift+V plain text, where the clipboard has no grid -- pastes
          // as text through the normal path.
          const plain = e.clipboardData?.getData("text/plain") ?? "";
          if (plainPaste.current) {
            plainPaste.current = false;
          } else if (plain) {
            const rows = parseDelimited(plain);
            if (rows) {
              e.preventDefault();
              onPasteTable(rows);
              return;
            }
          }
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
  // With wrap off the textarea is wider than its block, so the block scrolls. The
  // highlight overlay is absolutely positioned and would otherwise stay the width of the
  // scroll viewport, letting painted marks drift away from the glyphs they mark.
  const pre = ta.parentElement?.querySelector("pre");
  if (pre instanceof HTMLElement) pre.style.width = ta.style.width;
}

/** Width of one character. The editor is monospace, so this is the column grid. */
function charWidthOf(ta: HTMLTextAreaElement): number {
  const style = getComputedStyle(ta);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 8;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText("0000000000").width / 10 || 8;
}

/** Turns a pointer position into a line and character column inside the textarea. */
function pointAt(ta: HTMLTextAreaElement, clientX: number, clientY: number): { line: number; col: number } {
  const box = ta.getBoundingClientRect();
  const style = getComputedStyle(ta);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.6;
  const width = charWidthOf(ta);
  const lines = ta.value.split("\n");
  const line = Math.min(lines.length - 1, Math.max(0, Math.floor((clientY - box.top + ta.scrollTop) / lineHeight)));
  const text = lines[line] ?? "";
  const col = Math.min(text.length, Math.max(0, Math.round((clientX - box.left + ta.scrollLeft) / width)));
  return { line, col };
}

/** Pixel rectangle for the painted box selection, in the block's coordinate space. */
function boxPixels(ta: HTMLTextAreaElement, rect: Box) {
  const style = getComputedStyle(ta);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.6;
  const width = charWidthOf(ta);
  const [first, last] = [Math.min(rect.aLine, rect.fLine), Math.max(rect.aLine, rect.fLine)];
  const [left, right] = [Math.min(rect.aCol, rect.fCol), Math.max(rect.aCol, rect.fCol)];
  return {
    left: left * width - ta.scrollLeft,
    top: first * lineHeight - ta.scrollTop,
    width: (right - left) * width,
    height: (last - first + 1) * lineHeight,
  };
}
