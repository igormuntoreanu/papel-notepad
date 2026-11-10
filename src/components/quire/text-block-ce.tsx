import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
} from "react";
import type { Session } from "@/lib/quire/engine";
import { paint, readMarks, type Mark } from "@/lib/quire/marks";
import { diffText } from "@/lib/quire/text";
import { correctionAt } from "@/lib/quire/autocorrect";
import { parseDelimited } from "@/lib/quire/blocks";
import { htmlHasEmphasis, parseHtmlClipboard, parseHtmlTable } from "@/lib/quire/html-paste";
import { continueList, indentList, renumberLists } from "@/lib/quire/lists";
import { CODE_FONTS, CODE_STYLES, type BlockLook } from "@/lib/quire/typefaces";
import type { Place } from "./store";

/**
 * Per-line `contenteditable` text block (Phase 2 of the per-line-alignment migration).
 *
 * Unlike the textarea renderer, each line is its own element with its own `text-align`,
 * so alignment is per line (Word-style) and the native caret follows the aligned text.
 * The Rust core stays the source of truth for text, marks and per-line aligns; this
 * component renders the core and syncs native edits back to it.
 *
 * Editing model: the browser handles character typing natively (caret stays put). Any
 * edit that changes the LINE COUNT (Enter, Backspace/Delete across a newline, multi-line
 * paste) is followed by a re-render from the core, which rebuilds clean `.ce-line` divs,
 * applies the core's per-line aligns (so a new line inherits, a merge keeps the upper
 * line's), and restores the caret by character offset.
 *
 * Phase 2 scope: text, marks, per-line align, caret/selection, undo/redo, plain paste.
 * Phase 3 ports box select, rich paste variants, list auto-continue, autocorrect,
 * PageUp/Down and large-note virtualisation.
 */

/** Core align code (0/1/2) -> the `data-align` value CSS keys on. */
const ALIGN_ATTR = ["left", "center", "right"] as const;

function lineDivs(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".ce-line"));
}

/** The block's plain text: every line-level child's text, joined by "\n". */
function readText(root: HTMLElement): string {
  const out: string[] = [];
  const kids = Array.from(root.childNodes);
  for (let i = 0; i < kids.length; i += 1) {
    const child = kids[i]!;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      // A trailing root-level <br> is the browser's phantom line-break, not a line.
      if (el.tagName === "BR") {
        if (i === kids.length - 1 && out.length > 0) continue;
        out.push("");
        continue;
      }
      out.push(el.textContent ?? "");
    } else if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent ?? "";
      if (t.length) out.push(t);
    }
  }
  return out.join("\n");
}

/** Walk a line div's text nodes to a column; anchors to the div for empty lines. */
function textPosIn(div: HTMLElement, col: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let count = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (count + len >= col) return { node, offset: col - count };
    count += len;
  }
  return { node: div, offset: div.childNodes.length };
}

/** Character offset in the joined text -> a concrete caret position. */
function domPosAtOffset(root: HTMLElement, target: number): { node: Node; offset: number } | null {
  const lines = lineDivs(root);
  if (lines.length === 0) return null;
  let acc = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const div = lines[i]!;
    const len = (div.textContent ?? "").length;
    const last = i === lines.length - 1;
    if (target <= acc + len || last) {
      return textPosIn(div, Math.max(0, Math.min(target - acc, len)));
    }
    acc += len + 1; // +1 for the "\n" between lines
  }
  return null;
}

/** Column within a line div of a concrete DOM position. */
function columnIn(div: HTMLElement, node: Node, nodeOffset: number): number {
  if (node === div) {
    let col = 0;
    for (let i = 0; i < nodeOffset && i < div.childNodes.length; i += 1) {
      col += div.childNodes[i]!.textContent?.length ?? 0;
    }
    return col;
  }
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return count + nodeOffset;
    count += n.textContent?.length ?? 0;
  }
  return count;
}

/** A concrete DOM position -> character offset in the joined text. */
function offsetOfDomPos(root: HTMLElement, node: Node | null, nodeOffset: number): number {
  if (!node) return 0;
  let acc = 0;
  for (const div of lineDivs(root)) {
    if (div === node || div.contains(node)) return acc + columnIn(div, node, nodeOffset);
    acc += (div.textContent ?? "").length + 1;
  }
  return acc;
}

/** A rectangular (column) selection: anchor and focus as line + character column. */
type Box = { aLine: number; aCol: number; fLine: number; fCol: number };

/** Width of one character. The editor is monospace, so this is the column grid. */
function charWidthOf(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 8;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText("0000000000").width / 10 || 8;
}

/** Pointer position -> {line, col} in the (unwrapped) ce-root grid. The root's bounding
 *  rect already reflects sheet/block scroll, so no manual scroll maths is needed. */
function pointAtCE(root: HTMLElement, clientX: number, clientY: number, lines: string[]): { line: number; col: number } {
  const rect = root.getBoundingClientRect();
  const style = getComputedStyle(root);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.7;
  const width = charWidthOf(root);
  const line = Math.min(lines.length - 1, Math.max(0, Math.floor((clientY - rect.top) / lineHeight)));
  const col = Math.min((lines[line] ?? "").length, Math.max(0, Math.round((clientX - rect.left) / width)));
  return { line, col };
}

/** Pixel rectangle for the painted box selection, relative to the .block scroll box. */
function boxPixelsCE(root: HTMLElement, box: Box) {
  const block = root.parentElement;
  const style = getComputedStyle(root);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.7;
  const width = charWidthOf(root);
  const [first, last] = [Math.min(box.aLine, box.fLine), Math.max(box.aLine, box.fLine)];
  const [left, right] = [Math.min(box.aCol, box.fCol), Math.max(box.aCol, box.fCol)];
  const scrollLeft = block ? block.scrollLeft : 0;
  return {
    left: left * width - scrollLeft,
    top: first * lineHeight,
    width: (right - left) * width,
    height: (last - first + 1) * lineHeight,
  };
}

export function TextBlockCE({
  noteId,
  blockId,
  session,
  grow,
  tick,
  focusRef,
  autocorrect,
  findHit,
  look,
  onPasteTable,
  selectedAll,
  onSelectAll,
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
  findHit?: { start: number; end: number } | null;
  look?: BlockLook;
  onPasteTable: (rows: string[][]) => void;
  selectedAll?: boolean;
  onSelectAll: () => void;
  onClearSelectAll: () => void;
  onSelection: (start: number, end: number) => void;
  onEdited: () => void;
  onImage: (file: File) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const prev = useRef(session.text_of(blockId));
  /** Signature of the marks currently painted: a toolbar mark change repaints, typing does not. */
  const renderedMarks = useRef("");
  /** Signature of the find highlight painted, so navigating Find repaints. */
  const renderedFind = useRef("");
  const composing = useRef(false);
  const lastAt = useRef(0);
  /** Guards the input handler while we rewrite the DOM ourselves. */
  const suppress = useRef(false);
  /** Alt+drag column selection; while set, this block lays out unwrapped. */
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<Box | null>(null);

  function setSelection(root: HTMLElement, start: number, end: number) {
    const sel = window.getSelection();
    if (!sel) return;
    const a = domPosAtOffset(root, start);
    if (!a) return;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    if (end > start) {
      const b = domPosAtOffset(root, end);
      if (b) range.setEnd(b.node, b.offset);
      else range.collapse(true);
    } else {
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** Rebuild every line div from the core (text + marks + per-line align). */
  function renderLines(caretStart?: number | null, caretEnd?: number | null) {
    const root = rootRef.current;
    if (!root) return;
    const hadFocus = document.activeElement === root;
    const text = session.text_of(blockId);
    const flatMarks = session.marks(blockId);
    const marks = readMarks(flatMarks);
    renderedMarks.current = flatMarks.join(",");
    renderedFind.current = findHit && findHit.end > findHit.start ? `${findHit.start}:${findHit.end}` : "";
    const aligns = session.line_aligns(blockId);
    const styles = session.line_styles(blockId);
    const fonts = session.line_fonts(blockId);
    const lines = text.split("\n");
    const html: string[] = [];
    let lineStart = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const lt = lines[i]!;
      const lineEnd = lineStart + lt.length;
      const local: Mark[] = [];
      for (const m of marks) {
        if (m.end <= lineStart || m.start >= lineEnd) continue;
        local.push({
          ...m,
          start: Math.max(0, m.start - lineStart),
          end: Math.min(lt.length, m.end - lineStart),
        });
      }
      let hit: { start: number; end: number } | null = null;
      if (findHit && findHit.end > findHit.start && findHit.start < lineEnd && findHit.end > lineStart) {
        hit = { start: Math.max(0, findHit.start - lineStart), end: Math.min(lt.length, findHit.end - lineStart) };
      }
      const inner = lt.length === 0 ? "<br>" : paint(lt, [], local, hit);
      const align = ALIGN_ATTR[aligns[i] ?? 0] ?? "left";
      const styleId = CODE_STYLES[styles[i] ?? 0] ?? "body";
      const fontId = CODE_FONTS[fonts[i] ?? 0];
      const fontAttr = fontId ? ` data-font="${fontId}"` : "";
      html.push(`<div class="ce-line" data-align="${align}" data-style="${styleId}"${fontAttr}>${inner}</div>`);
      lineStart = lineEnd + 1; // +1 for the "\n"
    }
    suppress.current = true;
    root.innerHTML = html.join("");
    suppress.current = false;
    prev.current = text;
    if (caretStart != null) {
      if (hadFocus || document.activeElement === root) root.focus({ preventScroll: true });
      setSelection(root, caretStart, caretEnd ?? caretStart);
    }
  }

  /** Update only the per-line `data-align`/`data-style` attributes — cheap and caret-safe.
   *  A paragraph property (align or style) can change without touching text or marks, so
   *  this fast path reflects it without a full repaint (which would disturb the caret). */
  function syncPara() {
    const root = rootRef.current;
    if (!root) return;
    const aligns = session.line_aligns(blockId);
    const styles = session.line_styles(blockId);
    const fonts = session.line_fonts(blockId);
    lineDivs(root).forEach((d, i) => {
      d.setAttribute("data-align", ALIGN_ATTR[aligns[i] ?? 0] ?? "left");
      d.setAttribute("data-style", CODE_STYLES[styles[i] ?? 0] ?? "body");
      const fontId = CODE_FONTS[fonts[i] ?? 0];
      if (fontId) d.setAttribute("data-font", fontId);
      else d.removeAttribute("data-font");
    });
  }

  function currentSel(): { start: number; end: number } {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return { start: 0, end: 0 };
    const a = offsetOfDomPos(root, sel.anchorNode, sel.anchorOffset);
    const b = offsetOfDomPos(root, sel.focusNode, sel.focusOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  function report() {
    const { start, end } = currentSel();
    onSelection(start, end);
  }

  const reportRef = useRef(report);
  reportRef.current = report;

  // Report selection changes the browser fires outside our own handlers (mouse drag,
  // shift+arrow, programmatic), mirroring the textarea renderer's native listener.
  useEffect(() => {
    const onChange = () => {
      const root = rootRef.current;
      if (root && document.activeElement === root) reportRef.current();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  // First paint.
  useLayoutEffect(() => {
    renderLines(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External changes: undo/redo, align/mark commands, focus handoff, find, wrap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Whole-sheet select (Ctrl+A) spans separate line divs, so the browser paints no native
    // highlight; toggle a class and let CSS show the selection while `selectedAll` is set.
    root.classList.toggle("is-select-all", !!selectedAll);
    const focus = focusRef.current;
    if (focus && focus.block_id === blockId) {
      renderLines(focus.start, focus.end);
      root.focus({ preventScroll: true });
      focusRef.current = null;
      onSelection(focus.start, focus.end);
      return;
    }
    const coreText = session.text_of(blockId);
    if (readText(root) !== coreText) {
      // Text changed outside the DOM (undo/redo/programmatic): rebuild, keep the caret.
      const { start, end } = currentSel();
      renderLines(start, end);
      return;
    }
    // Text matches. A toolbar mark change alters the core marks without changing the
    // text: repaint to show it (restoring the caret). Otherwise just refresh the per-line
    // paragraph props (align/style), which is caret-safe. Typing keeps the marks baseline
    // in sync, so it will not repaint.
    const findSig = findHit && findHit.end > findHit.start ? `${findHit.start}:${findHit.end}` : "";
    if (session.marks(blockId).join(",") !== renderedMarks.current || findSig !== renderedFind.current) {
      const { start, end } = currentSel();
      renderLines(start, end);
    } else {
      syncPara();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, blockId, findHit?.start, findHit?.end, selectedAll]);

  function commit(inputType: string, data?: string | null) {
    const root = rootRef.current;
    if (!root || composing.current || suppress.current) return;
    const text = readText(root);
    const was = prev.current;
    if (text === was) {
      report();
      return;
    }
    const d = diffText(was, text);
    const now = performance.now();
    const burst = now - lastAt.current < 700;
    lastAt.current = now;
    const small =
      inputType === "insertText" || inputType === "deleteContentBackward" || inputType === "deleteContentForward";
    session.edit(blockId, d.start, d.end, d.inserted, burst && small);
    prev.current = session.text_of(blockId);
    // Typing shifts mark offsets; track them so the tick effect does not repaint mid-type.
    renderedMarks.current = session.marks(blockId).join(",");
    let caret = d.start + d.inserted.length;
    // Autocorrect: after typing one character in plain text, fix the word at the caret.
    if (autocorrect && inputType === "insertText" && data && data.length === 1 && session.effective_language(blockId) === "plain") {
      const fix = correctionAt(session.text_of(blockId), caret);
      if (fix) {
        session.edit(blockId, fix.start, fix.end, fix.replacement, false);
        prev.current = session.text_of(blockId);
        renderedMarks.current = session.marks(blockId).join(",");
        caret += fix.replacement.length - (fix.end - fix.start);
        renderLines(caret, caret);
        report();
        onEdited();
        return;
      }
    }
    // A line-count change means the browser restructured the DOM: rebuild clean lines
    // from the core (applying inherited/merged aligns) and put the caret back.
    if (text.split("\n").length !== was.split("\n").length) renderLines(caret, caret);
    report();
    onEdited();
  }

  function onInput(e: FormEvent<HTMLDivElement>) {
    const native = e.nativeEvent as InputEvent;
    if (native.isComposing) return;
    commit(native.inputType, native.data);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // The box selection owns Delete/Backspace and Escape while it is painted.
    if (box && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      deleteBox();
      return;
    }
    if (box && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setBox(null);
      return;
    }
    // Ctrl+A selects the whole sheet, matching the textarea renderer.
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      onSelectAll();
      return;
    }
    // Enter continues a bullet/numbered list at the caret. The insert is localized (so the
    // new line inherits the caret line's align via the core rule); the renumber is a
    // same-line-count replace (aligns preserved). A non-list Enter falls through to the
    // browser, which splits the line and commit() re-renders from the core.
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const { start, end } = currentSel();
      if (start === end) {
        const text = session.text_of(blockId);
        const change = continueList(text, start);
        if (change) {
          e.preventDefault();
          const startLine = (text.slice(0, change.start).match(/\n/g) ?? []).length;
          const caretLine = change.insert.includes("\n") ? startLine + 1 : startLine;
          session.edit(blockId, change.start, change.end, change.insert, false);
          let grown = session.text_of(blockId);
          const renumbered = renumberLists(grown.split("\n")).join("\n");
          if (renumbered !== grown) {
            session.edit(blockId, 0, grown.length, renumbered, false);
            grown = renumbered;
          }
          prev.current = grown;
          renderedMarks.current = session.marks(blockId).join(",");
          const gl = grown.split("\n");
          const pos = gl.slice(0, caretLine).reduce((s, l) => s + l.length + 1, 0) + (gl[caretLine]?.length ?? 0);
          renderLines(pos, pos);
          report();
          onEdited();
          return;
        }
      }
    }
    // Tab indents a list item (1. -> 1.1.), Shift+Tab outdents; outside a list Tab inserts a
    // literal tab. Always preventDefault so focus stays in the editor - otherwise the browser
    // walks focus to the sheet switcher (the reported bug). Mirrors the textarea renderer.
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const { start, end } = currentSel();
      const text = session.text_of(blockId);
      const moved = indentList(text, start, end, e.shiftKey ? -1 : 1);
      const lineIndex = (text.slice(0, start).match(/\n/g) ?? []).length;
      if (moved) {
        e.preventDefault();
        const linesBefore = text.split("\n");
        const lineStartBefore = linesBefore.slice(0, lineIndex).reduce((n, l) => n + l.length + 1, 0);
        const oldLine = linesBefore[lineIndex] ?? "";
        const oldCol = start - lineStartBefore;
        const atEnd = oldCol >= oldLine.length;
        session.edit(blockId, moved.start, moved.end, moved.insert, false);
        let grown = session.text_of(blockId);
        const renumbered = renumberLists(grown.split("\n")).join("\n");
        if (renumbered !== grown) {
          session.edit(blockId, 0, grown.length, renumbered, false);
          grown = renumbered;
        }
        prev.current = grown;
        renderedMarks.current = session.marks(blockId).join(",");
        const lines = grown.split("\n");
        const lineStart = lines.slice(0, lineIndex).reduce((n, l) => n + l.length + 1, 0);
        const newLine = lines[lineIndex] ?? "";
        const col = atEnd ? newLine.length : Math.min(newLine.length, Math.max(0, oldCol + (newLine.length - oldLine.length)));
        const pos = Math.min(grown.length, lineStart + col);
        renderLines(pos, pos);
        report();
        onEdited();
        return;
      }
      if (e.shiftKey) return;
      e.preventDefault();
      session.edit(blockId, start, end, "\t", false);
      const next = session.text_of(blockId);
      prev.current = next;
      renderedMarks.current = session.marks(blockId).join(",");
      renderLines(start + 1, start + 1);
      report();
      onEdited();
      return;
    }
    // PageUp/PageDown move by a viewport of lines; scrolling lives on `.sheet`.
    if ((e.key === "PageDown" || e.key === "PageUp") && !e.shiftKey && !e.altKey) {
      const root = rootRef.current;
      const sheet = root?.closest(".sheet");
      if (root && sheet instanceof HTMLElement) {
        e.preventDefault();
        const style = getComputedStyle(root);
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.7;
        const pageLines = Math.max(1, Math.floor(sheet.clientHeight / lineHeight) - 1);
        const dir = e.key === "PageDown" ? 1 : -1;
        const text = session.text_of(blockId);
        const lines = text.split("\n");
        const { start } = currentSel();
        const lineIndex = text.slice(0, start).split("\n").length - 1;
        const col = start - (text.lastIndexOf("\n", start - 1) + 1);
        const nextLine = Math.max(0, Math.min(lines.length - 1, lineIndex + dir * pageLines));
        const lineStart = lines.slice(0, nextLine).reduce((n, l) => n + l.length + 1, 0);
        const pos = lineStart + Math.min(col, (lines[nextLine] ?? "").length);
        root.focus({ preventScroll: true });
        setSelection(root, pos, pos);
        sheet.scrollTop = Math.max(0, sheet.scrollTop + dir * pageLines * lineHeight);
        report();
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const data = e.clipboardData;
    if (!data) return;
    const plain = data.getData("text/plain");
    const html = data.getData("text/html");

    // Excel/Sheets put a grid (TSV) and often a bitmap on the clipboard: prefer a table.
    if (plain) {
      const grid = parseDelimited(plain);
      if (grid) {
        e.preventDefault();
        onPasteTable(grid);
        return;
      }
    }
    if (html) {
      const fromHtml = parseHtmlTable(html);
      if (fromHtml) {
        e.preventDefault();
        onPasteTable(fromHtml);
        return;
      }
    }
    // HTML carrying inline emphasis becomes text plus marks.
    if (html && htmlHasEmphasis(html)) {
      const parsed = parseHtmlClipboard(html);
      if (parsed.text.length > 0 && parsed.runs.some((r) => r.bold || r.italic || r.underline || r.strike)) {
        e.preventDefault();
        const { start, end } = currentSel();
        session.edit(blockId, start, end, parsed.text, false);
        for (const run of parsed.runs) {
          const from = start + run.start;
          const to = start + run.end;
          if (to <= from) continue;
          if (run.bold) session.apply_style(blockId, from, to, "bold", 1);
          if (run.italic) session.apply_style(blockId, from, to, "italic", 1);
          if (run.underline) session.apply_style(blockId, from, to, "underline", 1);
          if (run.strike) session.apply_style(blockId, from, to, "strike", 1);
        }
        prev.current = session.text_of(blockId);
        renderedMarks.current = session.marks(blockId).join(",");
        const caret = start + parsed.text.length;
        renderLines(caret, caret);
        report();
        onEdited();
        return;
      }
    }
    // An image file becomes an image block.
    const image = [...data.files].find((file) => file.type.startsWith("image/"));
    if (image) {
      e.preventDefault();
      onImage(image);
      return;
    }
    // Plain text (possibly multi-line): insert via the core and rebuild from it.
    if (plain != null) {
      e.preventDefault();
      const { start, end } = currentSel();
      session.edit(blockId, start, end, plain, false);
      prev.current = session.text_of(blockId);
      renderedMarks.current = session.marks(blockId).join(",");
      const caret = start + plain.length;
      renderLines(caret, caret);
      report();
      onEdited();
    }
  }

  function boxText(rect: Box): string {
    const lines = session.text_of(blockId).split("\n");
    const [first, last] = [Math.min(rect.aLine, rect.fLine), Math.max(rect.aLine, rect.fLine)];
    const [left, right] = [Math.min(rect.aCol, rect.fCol), Math.max(rect.aCol, rect.fCol)];
    const out: string[] = [];
    for (let line = first; line <= last; line += 1) out.push((lines[line] ?? "").slice(left, right));
    return out.join("\n");
  }

  /** Removes the selected rectangle, last line up so offsets stay valid. */
  function deleteBox() {
    if (!box) return;
    const lines = session.text_of(blockId).split("\n");
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
      const start = (starts[line] ?? 0) + Math.min(left, length);
      const end = (starts[line] ?? 0) + Math.min(right, length);
      if (end > start) cuts.push({ start, end });
    }
    cuts.sort((a, b) => b.start - a.start);
    for (const cut of cuts) session.edit(blockId, cut.start, cut.end, "", false);
    prev.current = session.text_of(blockId);
    renderedMarks.current = session.marks(blockId).join(",");
    setBox(null);
    renderLines(null);
    onEdited();
  }

  function onMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (!e.altKey) {
      if (box) setBox(null);
      return;
    }
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    // preventDefault above blocks the native focus, so focus explicitly: Delete/Escape
    // for the box must reach this editor's key handler even if it was not focused yet.
    root.focus({ preventScroll: true });
    const lines = session.text_of(blockId).split("\n");
    const point = pointAtCE(root, e.clientX, e.clientY, lines);
    const next = { aLine: point.line, aCol: point.col, fLine: point.line, fCol: point.col };
    drag.current = next;
    setBox(next);
  }

  function onMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!drag.current || (e.buttons & 1) === 0) return;
    const root = rootRef.current;
    if (!root) return;
    const lines = session.text_of(blockId).split("\n");
    const point = pointAtCE(root, e.clientX, e.clientY, lines);
    const next = { ...drag.current, fLine: point.line, fCol: point.col };
    drag.current = next;
    setBox(next);
  }

  function onMouseUp() {
    drag.current = null;
  }

  function onCopy(e: ClipboardEvent<HTMLDivElement>) {
    if (!box) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", boxText(box));
  }

  return (
    <div
      className={`${grow ? "block grow" : "block"} is-ce${box ? " is-column-select" : ""}`}
      data-note={noteId}
      data-block-id={blockId}
      data-font={look?.font ?? undefined}
      data-style={look?.style ?? undefined}
    >
      {box && rootRef.current && (
        <div className="block-rect" aria-hidden="true" style={boxPixelsCE(rootRef.current, box)} />
      )}
      <div
        ref={rootRef}
        className="ce-root"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Note"
        spellCheck={false}
        onFocus={report}
        onInput={onInput}
        onKeyUp={report}
        onClick={report}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onCopy={onCopy}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          commit("insertText");
        }}
      />
    </div>
  );
}
