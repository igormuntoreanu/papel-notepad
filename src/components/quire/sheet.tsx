import {
  ArrowLeft,
  Bold,
  Clock,
  Eraser,
  ImagePlus,
  Italic,
  List,
  Redo2,
  Save,
  Search,
  Strikethrough,
  Table2,
  ChevronDown,
  Underline,
  Undo2,
  WrapText,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from "react";
import type { Session } from "@/lib/quire/engine";
import { HIGHLIGHTERS, INKS, type FlagName } from "@/lib/quire/marks";
import {
  DEFAULT_FONT,
  DEFAULT_STYLE,
  FONTS,
  TEXT_STYLES,
  fontName,
  styleName,
  type BlockLook,
} from "@/lib/quire/typefaces";
import type { DateStampStyle } from "@/lib/quire/text";
import { tornClip } from "@/lib/quire/torn";
import { TextBlock } from "./text-block";
import { TableBlock, type CellTarget } from "./table-block";
import { DropMenu } from "./drop-menu";
import { imageUrl, outlineOf, type NoteMeta, type Place } from "./store";

const SHEET_CLIP = tornClip("papel-sheet", 6, undefined, 40);
const SHEET_UNDER = tornClip("papel-sheet-under", 8, undefined, 40);

/** 5 × 5 grid of rows/cols, built once: the picker only mounts while open. */
const PICKER_CELLS = Array.from({ length: 25 }, (_, i) => ({
  rows: Math.floor(i / 5) + 1,
  cols: (i % 5) + 1,
}));

function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [size, setSize] = useState({ rows: 3, cols: 3 });
  return (
    <div className="table-picker">
      <p className="table-picker-size">
        {size.rows} × {size.cols}
      </p>
      <div className="table-picker-grid" onMouseLeave={() => setSize({ rows: 3, cols: 3 })}>
        {PICKER_CELLS.map(({ rows, cols }) => {
          const on = rows <= size.rows && cols <= size.cols;
          return (
            <button
              key={`${rows}-${cols}`}
              type="button"
              className={on ? "pick-cell is-on" : "pick-cell"}
              aria-label={`Insert a ${rows} by ${cols} table`}
              onMouseEnter={() => setSize({ rows, cols })}
              onFocus={() => setSize({ rows, cols })}
              onClick={() => onPick(rows, cols)}
            />
          );
        })}
      </div>
      <p className="table-picker-hint">Insert table</p>
    </div>
  );
}

export type FindState = {
  open: boolean;
  query: string;
  setQuery: (v: string) => void;
  repl: string;
  setRepl: (v: string) => void;
  matchCase: boolean;
  setMatchCase: (v: boolean) => void;
  line: string;
  setLine: (v: string) => void;
  status: string;
  inputRef: RefObject<HTMLInputElement | null>;
  move: (back: boolean) => void;
  replaceOne: () => void;
  replaceAll: () => void;
  jump: () => void;
  close: () => void;
};

export type StyleState = {
  hasSelection: boolean;
  active: Record<FlagName, boolean>;
  ink: number;
  hl: number;
  toggle: (flag: FlagName) => void;
  setInk: (ink: number) => void;
  setHl: (hl: number) => void;
  clear: () => void;
};

export type SheetActions = {
  back: () => void;
  rename: (title: string) => void;
  undo: () => void;
  redo: () => void;
  find: () => void;
  date: (style?: DateStampStyle) => void;
  image: () => void;
  wrap: () => void;
  save: (ext?: string) => void;
  close: () => void;
  deleteImage: (id: number) => void;
  table: (rows: number, cols: number) => void;
  bullets: () => void;
  /** Sets the face and/or paragraph style of one text block. */
  look: (blockId: number, patch: BlockLook) => void;
};

/** Toolbar buttons that must not steal focus (and the selection) from the editor. */
function Keep({
  label,
  onPress,
  pressed,
  disabled,
  children,
  className,
  title,
}: {
  label: string;
  onPress: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={className ?? "tool"}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

export function Sheet({
  note,
  session,
  edge,
  pattern,
  tick,
  focusRef,
  autocorrect,
  selectedImage,
  setSelectedImage,
  onSelection,
  onEdited,
  onCellSelect,
  onImage,
  styles,
  find,
  findHit,
  looks,
  activeBlockId,
  saveExt,
  saveExts,
  actions,
}: {
  note: NoteMeta;
  session: Session;
  edge: string;
  pattern: string;
  tick: number;
  focusRef: MutableRefObject<Place | null>;
  autocorrect: boolean;
  selectedImage: number | null;
  setSelectedImage: (id: number | null) => void;
  onSelection: (blockId: number, start: number, end: number) => void;
  onEdited: () => void;
  onCellSelect: (target: CellTarget | null) => void;
  onImage: (file: File) => void;
  styles: StyleState;
  find: FindState;
  /** Active Find match to keep highlighted while Find stays focused. */
  findHit: { blockId: number; start: number; end: number } | null;
  /** Face and paragraph style per text block, keyed by block id. */
  looks: Record<string, BlockLook>;
  /** The block that holds the caret: where a style or font choice applies. */
  activeBlockId: number | null;
  /** Default extension for Ctrl+S, e.g. `papel` or `txt`. */
  saveExt: string;
  /** Every extension this note can be written as, default first. */
  saveExts: string[];
  actions: SheetActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const torn = edge === "torn";
  const outline = outlineOf(session);
  const noSel = !styles.hasSelection;
  const selHint = noSel ? " (select text first)" : "";
  // Where a paragraph style or font choice applies: the block holding the caret.
  const currentLook: BlockLook = activeBlockId === null ? {} : (looks[String(activeBlockId)] ?? {});

  return (
    <section className="sheet-wrap" data-edge={edge} aria-label={note.title}>
      {torn && <div className="sheet-under" style={{ clipPath: SHEET_UNDER }} aria-hidden="true" />}
      <div className="sheet-frame" data-edge={edge} style={torn ? { clipPath: SHEET_CLIP } : undefined}>
        <div className="sheet-strip">
          <div className="sheet-title-row">
            <button type="button" className="tool back" onClick={actions.back} aria-label="Back to board" title="Back to board (Esc)">
              <ArrowLeft />
            </button>
            {renaming ? (
              <input
                className="sheet-rename"
                aria-label="Sheet name"
                defaultValue={note.title}
                autoFocus
                onBlur={(e) => {
                  actions.rename(e.target.value);
                  setRenaming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    actions.rename(e.currentTarget.value);
                    setRenaming(false);
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <h2 className="sheet-title">
                <button type="button" onClick={() => setRenaming(true)} title="Rename this sheet">
                  {note.title}
                </button>
              </h2>
            )}
            {session.is_dirty() && <span className="dirty" role="img" aria-label="Unsaved" title="Not saved to a file" />}
            {find.open ? (
              <FindBar find={find} />
            ) : (
              <div className="sheet-tools" role="toolbar" aria-label="Text and sheet tools">
                <div className="tool-group" role="group" aria-label="Paragraph style and font">
                  <DropMenu
                    className="tool text-only"
                    ariaLabel={`Paragraph style: ${styleName(currentLook.style)}`}
                    title="Paragraph style for this block"
                    label={
                      <span>
                        {styleName(currentLook.style)} <ChevronDown size={13} aria-hidden="true" />
                      </span>
                    }
                    items={TEXT_STYLES.map((style) => {
                      const on = (currentLook.style ?? DEFAULT_STYLE) === style.id;
                      return (
                        <button
                          key={style.id}
                          type="button"
                          className="menu-item"
                          role="menuitemradio"
                          aria-checked={on}
                          disabled={activeBlockId === null}
                          onClick={() => activeBlockId !== null && actions.look(activeBlockId, { style: style.id })}
                        >
                          {on ? `${style.name} ✓` : style.name}
                        </button>
                      );
                    })}
                  />
                  <DropMenu
                    className="tool text-only"
                    ariaLabel={`Font: ${fontName(currentLook.font)}`}
                    title="Font for this block"
                    label={
                      <span>
                        {fontName(currentLook.font)} <ChevronDown size={13} aria-hidden="true" />
                      </span>
                    }
                    items={FONTS.map((font) => {
                      const on = (currentLook.font ?? DEFAULT_FONT) === font.id;
                      return (
                        <button
                          key={font.id}
                          type="button"
                          className="menu-item"
                          role="menuitemradio"
                          aria-checked={on}
                          disabled={activeBlockId === null}
                          onClick={() => activeBlockId !== null && actions.look(activeBlockId, { font: font.id })}
                        >
                          <span style={{ fontFamily: font.css }}>{font.name}</span>
                          {on ? " ✓" : ""}
                        </button>
                      );
                    })}
                  />
                </div>
                <div className="tool-group" role="group" aria-label="Text style">
                  <Keep label={`Bold${selHint}`} title="Bold (Ctrl+B)" pressed={styles.active.bold} disabled={noSel} onPress={() => styles.toggle("bold")}>
                    <Bold />
                  </Keep>
                  <Keep label={`Italic${selHint}`} title="Italic (Ctrl+I)" pressed={styles.active.italic} disabled={noSel} onPress={() => styles.toggle("italic")}>
                    <Italic />
                  </Keep>
                  <Keep label={`Underline${selHint}`} title="Underline (Ctrl+U)" pressed={styles.active.underline} disabled={noSel} onPress={() => styles.toggle("underline")}>
                    <Underline />
                  </Keep>
                  <Keep label={`Strikethrough${selHint}`} title="Strikethrough (Ctrl+Shift+X)" pressed={styles.active.strike} disabled={noSel} onPress={() => styles.toggle("strike")}>
                    <Strikethrough />
                  </Keep>
                </div>
                <div className="tool-group swatches" role="group" aria-label="Ink color">
                  {INKS.map((ink) => (
                    <Keep
                      key={ink.id}
                      label={`${ink.name} ink${selHint}`}
                      title={`${ink.name} ink${selHint}`}
                      className="swatch-btn ink"
                      pressed={styles.hasSelection && styles.ink === ink.id}
                      disabled={noSel}
                      onPress={() => styles.setInk(ink.id)}
                    >
                      <span style={{ background: ink.color }} />
                    </Keep>
                  ))}
                </div>
                <div className="tool-group swatches" role="group" aria-label="Highlighter">
                  {HIGHLIGHTERS.map((hl) => (
                    <Keep
                      key={hl.id}
                      label={hl.id === 0 ? `No highlight${selHint}` : `${hl.name} highlighter${selHint}`}
                      title={hl.id === 0 ? `No highlight${selHint}` : `${hl.name} highlighter${selHint}`}
                      className={hl.id === 0 ? "swatch-btn hl none" : "swatch-btn hl"}
                      pressed={styles.hasSelection && styles.hl === hl.id}
                      disabled={noSel}
                      onPress={() => styles.setHl(hl.id)}
                    >
                      <span style={{ background: hl.color }} />
                    </Keep>
                  ))}
                  <Keep label={`Clear styles${selHint}`} title={`Clear styles${selHint}`} disabled={noSel} onPress={styles.clear}>
                    <Eraser />
                  </Keep>
                </div>
                <div className="tool-group" role="group" aria-label="Edit">
                  <Keep label="Undo" title="Undo (Ctrl+Z)" disabled={!session.can_undo()} onPress={actions.undo}>
                    <Undo2 />
                  </Keep>
                  <Keep label="Redo" title="Redo (Ctrl+Y)" disabled={!session.can_redo()} onPress={actions.redo}>
                    <Redo2 />
                  </Keep>
                  <Keep label="Find, replace, go to line" title="Find (Ctrl+F)" pressed={find.open} onPress={actions.find}>
                    <Search />
                  </Keep>
                  <DropMenu
                    className="tool"
                    align="end"
                    ariaLabel="Insert date and time"
                    title="Insert date and time (F5 uses local format)"
                    label={<Clock />}
                    items={
                      <>
                        <button type="button" className="menu-item" onClick={() => actions.date("local")}>
                          Local format
                        </button>
                        <button type="button" className="menu-item" onClick={() => actions.date("eu")}>
                          European (DD/MM/YYYY)
                        </button>
                        <button type="button" className="menu-item" onClick={() => actions.date("iso")}>
                          ISO (YYYY-MM-DD)
                        </button>
                      </>
                    }
                  />
                  <Keep label="Bulleted list" title="Bulleted list" onPress={actions.bullets}>
                    <List />
                  </Keep>
                  <DropMenu
                    className="tool"
                    align="end"
                    ariaLabel="Insert table"
                    title="Insert table"
                    label={<Table2 />}
                    items={<TablePicker onPick={actions.table} />}
                  />
                  <Keep label="Insert image" title="Insert image" onPress={actions.image}>
                    <ImagePlus />
                  </Keep>
                  <Keep label="Word wrap" title="Toggle word wrap" pressed={note.wrap} onPress={actions.wrap}>
                    <WrapText />
                  </Keep>
                </div>
              </div>
            )}
            <Keep label={`Save (.${saveExt})`} title={`Save (.${saveExt}) (Ctrl+S)`} onPress={() => actions.save()}>
              <Save />
            </Keep>
            <DropMenu
              className="tool text-only"
              align="end"
              ariaLabel={`Save as .${saveExt}`}
              title={`Choose save format (.${saveExt})`}
              label={<span>.{saveExt}</span>}
              items={saveExts.map((ext) => (
                <button key={ext} type="button" className="menu-item" onClick={() => actions.save(ext)}>
                  Save as .{ext}
                </button>
              ))}
            />
            <Keep label="Close sheet" title="Close sheet" onPress={actions.close}>
              <X />
            </Keep>
          </div>
        </div>

        <div className="sheet">
          <div className="page" data-pattern={pattern} data-wrap={note.wrap ? "on" : "off"}>
            {outline.map((item, index, all) =>
              item.kind === "image" ? (
                <button
                  key={item.id}
                  type="button"
                  className={selectedImage === item.id ? "picture is-selected" : "picture"}
                  aria-label="Pasted image. Press Delete to remove."
                  onClick={() => setSelectedImage(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") {
                      e.preventDefault();
                      actions.deleteImage(item.id);
                    }
                  }}
                >
                  <img src={imageUrl(note.id, item.id, session)} alt="" />
                </button>
              ) : item.kind === "table" ? (
                <TableBlock
                  key={item.id}
                  blockId={item.id}
                  session={session}
                  version={tick}
                  onEdited={onEdited}
                  onSelect={onCellSelect}
                />
              ) : (
                <TextBlock
                  key={item.id}
                  noteId={note.id}
                  blockId={item.id}
                  session={session}
                  wrap={note.wrap}
                  grow={index === all.length - 1}
                  tick={tick}
                  focusRef={focusRef}
                  autocorrect={autocorrect}
                  findHit={
                    findHit && findHit.blockId === item.id && findHit.end > findHit.start
                      ? { start: findHit.start, end: findHit.end }
                      : null
                  }
                  onSelection={(start, end) => {
                    setSelectedImage(null);
                    onSelection(item.id, start, end);
                  }}
                  onEdited={onEdited}
                  onImage={onImage}
                  look={looks[String(item.id)]}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function FindBar({ find }: { find: FindState }) {
  function onFindKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      // Enter = next only; Shift+Enter = previous.
      find.move(e.shiftKey);
      // Keep focus in Find so the next Enter advances; match stays painted via find-hit.
      window.setTimeout(() => find.inputRef.current?.focus(), 0);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      find.close();
    }
  }

  return (
    <div
      className="findbar sheet-tools"
      role="search"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <input
        ref={find.inputRef}
        aria-label="Find in sheet"
        placeholder="Find"
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={onFindKey}
      />
      <span className="find-count" aria-live="polite" title="Match counter">
        {find.status || "—"}
      </span>
      <input
        aria-label="Replace with"
        placeholder="Replace"
        value={find.repl}
        onChange={(e) => find.setRepl(e.target.value)}
        onKeyDown={onFindKey}
      />
      <button type="button" className="tool" aria-pressed={find.matchCase} title="Match case" onClick={() => find.setMatchCase(!find.matchCase)}>
        Aa
      </button>
      <button
        type="button"
        className="tool"
        title="Previous match"
        onClick={() => {
          find.move(true);
          window.setTimeout(() => find.inputRef.current?.focus(), 0);
        }}
      >
        Prev
      </button>
      <button
        type="button"
        className="tool"
        title="Next match (Enter)"
        onClick={() => {
          find.move(false);
          window.setTimeout(() => find.inputRef.current?.focus(), 0);
        }}
      >
        Next
      </button>
      <button type="button" className="tool" title="Replace this match" onClick={find.replaceOne}>
        Replace
      </button>
      <button type="button" className="tool" title="Replace all matches" onClick={find.replaceAll}>
        All
      </button>
      <form
        className="goto"
        onSubmit={(e) => {
          e.preventDefault();
          find.jump();
        }}
      >
        <input aria-label="Go to line" inputMode="numeric" placeholder="Line" value={find.line} onChange={(e) => find.setLine(e.target.value)} />
        <button type="submit" className="tool" title="Go to line">
          Go
        </button>
      </form>
      <button type="button" className="tool" aria-label="Close find" title="Close find" onClick={find.close}>
        <X />
      </button>
    </div>
  );
}

