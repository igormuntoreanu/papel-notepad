import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@/lib/quire/engine";
import { HIGHLIGHTERS, paint, readMarks } from "@/lib/quire/marks";

type CellData = { t: string; f: number; m?: number[] };
type TableData = { cols: number; cells: CellData[] };
type Menu = { row: number; col: number; x: number; y: number; sheet: boolean };
type Scope = "cell" | "row" | "col" | "table";

/** The caret a cell is holding, so the sheet toolbar styles the cell, not the page. */
export type CellTarget = { tableId: number; row: number; col: number; start: number; end: number };

/**
 * A rectangle of cells from a drag that crossed a cell boundary.
 * Cells store text, not blocks, so this is the selection a second cell can join.
 */
export type CellRange = { tableId: number; r0: number; c0: number; r1: number; c1: number };

const SCOPES: { id: Scope; label: string }[] = [
  { id: "cell", label: "Cell" },
  { id: "row", label: "Row" },
  { id: "col", label: "Column" },
  { id: "table", label: "Table" },
];

/**
 * A table block.
 *
 * Cells are uncontrolled inputs: a keystroke is one `table_set_text` call and
 * no React render, which measured 0.3 ms per key on a 400-cell grid. The parent
 * is told 300 ms after typing stops (or on blur); it re-renders, `version`
 * changes, and the grid re-reads the core — that is also how undo and the
 * structural edits below reach the DOM.
 */
export function TableBlock({
  blockId,
  session,
  version,
  onEdited,
  onSelect,
  range,
  onRange,
  onDelete,
}: {
  blockId: number;
  session: Session;
  version: number;
  onEdited: () => void;
  onSelect: (target: CellTarget | null) => void;
  /** Drag that crossed into another cell. `null` clears it. */
  range: CellRange | null;
  onRange: (range: CellRange | null) => void;
  /** Removes the whole table; the sheet owns the undoable step. */
  onDelete: () => void;
}) {
  const table = useMemo<TableData>(() => {
    try {
      return JSON.parse(session.table_json(blockId)) as TableData;
    } catch {
      return { cols: 1, cells: [{ t: "", f: 0 }] };
    }
  }, [blockId, session, version]);

  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ row: number; col: number } | null>(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const pending = useRef<number | null>(null);
  const latest = useRef(onEdited);
  latest.current = onEdited;

  const [menu, setMenu] = useState<Menu | null>(null);
  const [scope, setScope] = useState<Scope>("cell");
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);

  // The core is the source of truth; push it back into cells that are not being
  // typed into (undo, structural edits, styling) and repaint their overlays.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLTextAreaElement>("textarea.cell-input").forEach((ta, index) => {
      const cell = table.cells[index];
      if (!cell) return;
      if (document.activeElement !== ta && ta.value !== cell.t) ta.value = cell.t;
      paintCell(ta, cell.m);
    });
  }, [table]);

  function paintCell(ta: HTMLTextAreaElement, marks: number[] | undefined) {
    const pre = ta.previousElementSibling as HTMLElement | null;
    if (!pre) return;
    pre.innerHTML = paint(ta.value, [], readMarks(marks ?? []));
  }

  const flush = () => {
    if (pending.current === null) return;
    window.clearTimeout(pending.current);
    pending.current = null;
    latest.current();
  };

  useEffect(() => () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const anchor = drag.current;
      const root = rootRef.current;
      if (!anchor || !root) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const td = hit instanceof Element ? hit.closest("td") : null;
      if (!td || !root.contains(td)) return;
      const row = Number(td.getAttribute("data-row"));
      const col = Number(td.getAttribute("data-col"));
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;
      if (row === anchor.row && col === anchor.col) return;
      onRangeRef.current({ tableId: blockId, r0: anchor.row, c0: anchor.col, r1: row, c1: col });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [blockId]);

  const nudge = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      latest.current();
    }, 300);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const change = (run: () => void) => {
    run();
    setMenu(null);
    onEdited();
  };

  const cols = Math.max(1, table.cols);
  const rows = Math.max(1, Math.ceil(table.cells.length / cols));

  return (
    <div
      className="block table-block"
      data-block-id={blockId}
      ref={rootRef}
      onBlur={(event) => {
        flush();
        // Leaving the table clears the sticky cell target so text-block styles work again.
        // A toolbar or menu click is not "leaving": Insert table and Bold still need this cell.
        const next = event.relatedTarget;
        if (next instanceof Node && rootRef.current?.contains(next)) return;
        if (next instanceof Element && next.closest(".sheet-strip, .popover")) return;
        onSelect(null);
      }}
      onContextMenu={(event) => {
        // A right-click anywhere on the table opens the menu; the cell under the
        // pointer wins, the top-left cell is the fallback.
        const cell = (event.target as HTMLElement).closest("td");
        const cells = [...rootRef.current!.querySelectorAll("td")];
        const index = cell ? cells.indexOf(cell as HTMLTableCellElement) : 0;
        const cols = Math.max(1, table.cols);
        const safe = index >= 0 ? index : 0;
        event.preventDefault();
        setMenu({
          row: Math.floor(safe / cols),
          col: safe % cols,
          x: event.clientX,
          y: event.clientY,
          sheet: false,
        });
      }}
    >
      <div className="table-scroll">
        <table
          className="sheet-table"
          /* A wide sheet expands to the right and scrolls instead of squeezing every
             column into the page width. */
          style={{ minWidth: `${cols * 108}px` }}
        >
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: cols }, (_, col) => {
                  const cell = table.cells[row * cols + col] ?? { t: "", f: 0 };
                  return (
                    <td
                      key={col}
                      data-row={row}
                      data-col={col}
                      className={
                        [
                          cell.f ? `fill-${cell.f}` : "",
                          range &&
                          range.tableId === blockId &&
                          row >= Math.min(range.r0, range.r1) &&
                          row <= Math.max(range.r0, range.r1) &&
                          col >= Math.min(range.c0, range.c1) &&
                          col <= Math.max(range.c0, range.c1)
                            ? "is-range"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        drag.current = { row, col };
                        onRange(null);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({ row, col, x: event.clientX, y: event.clientY, sheet: false });
                      }}
                    >
                      <div className="cell">
                        <pre className="hl" aria-hidden="true" />
                        <textarea
                          rows={1}
                          wrap="off"
                          className="cell-input"
                          aria-label={`Row ${row + 1}, column ${col + 1}`}
                          defaultValue={cell.t}
                          spellCheck={false}
                          onFocus={(event) => {
                            setActive({ row, col });
                            onSelect({
                              tableId: blockId,
                              row,
                              col,
                              start: event.currentTarget.selectionStart ?? 0,
                              end: event.currentTarget.selectionEnd ?? 0,
                            });
                          }}
                          onSelect={(event) => {
                            const ta = event.currentTarget;
                            onSelect({
                              tableId: blockId,
                              row,
                              col,
                              start: ta.selectionStart ?? 0,
                              end: ta.selectionEnd ?? 0,
                            });
                          }}
                          onChange={(event) => {
                            const ta = event.currentTarget;
                            session.table_set_text(blockId, row, col, ta.value);
                            paintCell(ta, cell.m);
                            nudge();
                          }}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>



      {menu &&
        createPortal(
          <div
            className="cell-menu"
            data-sheet={menu.sheet ? "on" : "off"}
            role="menu"
            style={menu.sheet ? undefined : { left: menu.x, top: menu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="menu-scope" role="group" aria-label="Paint">
              {SCOPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={scope === item.id ? "scope is-on" : "scope"}
                  aria-pressed={scope === item.id}
                  onClick={() => setScope(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="fill-swatches" role="group" aria-label="Fill colour">
              {HIGHLIGHTERS.map((colour) => (
                <button
                  key={colour.id}
                  type="button"
                  className="fill-swatch"
                  style={{ background: colour.color }}
                  aria-label={colour.id === 0 ? "No fill" : colour.name}
                  title={colour.id === 0 ? "No fill" : colour.name}
                  onClick={() =>
                    change(() => session.table_fill(blockId, scope, menu.row, menu.col, colour.id))
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="menu-item"
              onClick={() => change(() => session.table_insert_row(blockId, menu.row))}
            >
              Insert row above
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => change(() => session.table_insert_row(blockId, menu.row + 1))}
            >
              Insert row below
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => change(() => session.table_delete_row(blockId, menu.row))}
            >
              Delete row
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => change(() => session.table_insert_col(blockId, menu.col))}
            >
              Insert column left
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => change(() => session.table_insert_col(blockId, menu.col + 1))}
            >
              Insert column right
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => change(() => session.table_delete_col(blockId, menu.col))}
            >
              Delete column
            </button>
            {/* One undoable step removes the table and the empty block below it. */}
            <button
              type="button"
              className="menu-item is-danger"
              onClick={() => {
                setMenu(null);
                onDelete();
              }}
            >
              Delete table
            </button>
          </div>,
          document.querySelector(".desk") ?? document.body,
        )}
    </div>
  );
}
