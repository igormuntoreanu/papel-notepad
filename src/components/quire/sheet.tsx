import {
  ArrowLeft,
  Bold,
  Braces,
  Clock,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  List,
  Redo2,
  Save,
  Search,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
  WrapText,
  X,
} from "lucide-react";
import { useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import type { Session } from "@/lib/quire/engine";
import { HIGHLIGHTERS, INKS, type FlagName } from "@/lib/quire/marks";
import { tornClip } from "@/lib/quire/torn";
import { TextBlock } from "./text-block";
import { TableBlock, type CellTarget } from "./table-block";
import { DropMenu } from "./drop-menu";
import { imageUrl, outlineOf, type NoteMeta, type Place } from "./store";

const SHEET_CLIP = tornClip("papel-sheet", 6, undefined, 40);
const SHEET_UNDER = tornClip("papel-sheet-under", 8, undefined, 40);

/** 5 Ã— 5 grid of rows/cols, built once: the picker only mounts while open. */
const PICKER_CELLS = Array.from({ length: 25 }, (_, i) => ({
  rows: Math.floor(i / 5) + 1,
  cols: (i % 5) + 1,
}));

function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [size, setSize] = useState({ rows: 3, cols: 3 });
  return (
    <div className="table-picker">
      <p className="table-picker-size">
        {size.rows} Ã— {size.cols}
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
  format: () => void;
  find: () => void;
  date: () => void;
  image: () => void;
  wrap: () => void;
  save: () => void;
  close: () => void;
  deleteImage: (id: number) => void;
  table: (rows: number, cols: number) => void;
  bullets: () => void;
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
  actions: SheetActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const torn = edge === "torn";
  const outline = outlineOf(session);
  const noSel = !styles.hasSelection;
  const selHint = noSel ? " (select text first)" : "";

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
                <button type="button" onClick={() => setRenaming(true)} title="Rename">
                  {note.title}
                </button>
              </h2>
            )}
            {session.is_dirty() && <span className="dirty" role="img" aria-label="Unsaved" title="Not saved to a file" />}
            <span className="spacer" />
            <Keep label="Save" title="Save as .papel (Ctrl+S)" onPress={() => actions.save()}>
              <Save />
            </Keep>
            <Keep label="Save as .papel" title="Papel is the only format" className="tool text-only" onPress={() => actions.save()}>
              <span>.papel</span>
            </Keep>
            <Keep label="Close sheet" onPress={actions.close}>
              <X />
            </Keep>
          </div>

          <div className="sheet-tools" role="toolbar" aria-label="Text and sheet tools">
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
              <Highlighter className="group-icon" aria-hidden="true" />
              {HIGHLIGHTERS.map((hl) => (
                <Keep
                  key={hl.id}
                  label={hl.id === 0 ? `No highlight${selHint}` : `${hl.name} highlighter${selHint}`}
                  className={hl.id === 0 ? "swatch-btn hl none" : "swatch-btn hl"}
                  pressed={styles.hasSelection && styles.hl === hl.id}
                  disabled={noSel}
                  onPress={() => styles.setHl(hl.id)}
                >
                  <span style={{ background: hl.color }} />
                </Keep>
              ))}
              <Keep label={`Clear styles${selHint}`} disabled={noSel} onPress={styles.clear}>
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
              <Keep label="Autoformat code" onPress={actions.format}>
                <Braces />
              </Keep>
              <Keep label="Find, replace, go to line" title="Find (Ctrl+F)" pressed={find.open} onPress={actions.find}>
                <Search />
              </Keep>
              <Keep label="Insert date and time" title="Insert date (F5)" onPress={actions.date}>
                <Clock />
              </Keep>
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
              <Keep label="Insert image" onPress={actions.image}>
                <ImagePlus />
              </Keep>
              <Keep label="Word wrap" pressed={note.wrap} onPress={actions.wrap}>
                <WrapText />
              </Keep>
            </div>
          </div>

          {find.open && <FindBar find={find} />}
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
                  onSelection={(start, end) => {
                    setSelectedImage(null);
                    onSelection(item.id, start, end);
                  }}
                  onEdited={onEdited}
                  onImage={onImage}
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
  return (
    <div className="findbar" role="search">
      <input
        ref={find.inputRef}
        aria-label="Find in sheet"
        placeholder="Find in sheet"
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            find.move(e.shiftKey);
          }
        }}
      />
      <input aria-label="Replace with" placeholder="Replace with" value={find.repl} onChange={(e) => find.setRepl(e.target.value)} />
      <button type="button" className="tool" aria-pressed={find.matchCase} title="Match case" onClick={() => find.setMatchCase(!find.matchCase)}>
        Aa
      </button>
      <button type="button" className="tool" onClick={() => find.move(true)}>
        Prev
      </button>
      <button type="button" className="tool" onClick={() => find.move(false)}>
        Next
      </button>
      <button type="button" className="tool" onClick={find.replaceOne}>
        Replace
      </button>
      <button type="button" className="tool" onClick={find.replaceAll}>
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
        <button type="submit" className="tool">
          Go
        </button>
      </form>
      {find.status && <span className="find-count">{find.status}</span>}
      <button type="button" className="tool" aria-label="Close find" onClick={find.close}>
        <X />
      </button>
    </div>
  );
}

