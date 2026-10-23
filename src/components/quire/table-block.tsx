import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@/lib/quire/engine";

type CellData = { t: string; f: number };
type TableData = { cols: number; cells: CellData[] };
type Menu = { row: number; col: number; x: number; y: number; sheet: boolean };

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
}: {
  blockId: number;
  session: Session;
  version: number;
  onEdited: () => void;
}) {
  const table = useMemo<TableData>(() => {
    try {
      return JSON.parse(session.table_json(blockId)) as TableData;
    } catch {
      return { cols: 1, cells: [{ t: "", f: 0 }] };
    }
  }, [blockId, session, version]);

  const rootRef = useRef<HTMLDivElement>(null);
  const pending = useRef<number | null>(null);
  const latest = useRef(onEdited);
  latest.current = onEdited;

  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);

  // The core is the source of truth; push it back into inputs that are not
  // being typed into (undo, row/column edits, reloads).
  useLayoutEffect(() => {
    const inputs = rootRef.current?.querySelectorAll("input");
    if (!inputs) return;
    inputs.forEach((input, index) => {
      const cell = table.cells[index];
      if (cell && document.activeElement !== input && input.value !== cell.t) input.value = cell.t;
    });
  }, [table]);

  const flush = () => {
    if (pending.current === null) return;
    window.clearTimeout(pending.current);
    pending.current = null;
    latest.current();
  };

  useEffect(() => () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
  }, []);

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
    <div className="block table-block" ref={rootRef} onBlur={flush}>
      <div className="table-scroll">
        <table className="sheet-table">
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: cols }, (_, col) => {
                  const cell = table.cells[row * cols + col] ?? { t: "", f: 0 };
                  return (
                    <td
                      key={col}
                      className={cell.f ? `fill-${cell.f}` : undefined}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({ row, col, x: event.clientX, y: event.clientY, sheet: false });
                      }}
                    >
                      <input
                        aria-label={`Row ${row + 1}, column ${col + 1}`}
                        defaultValue={cell.t}
                        spellCheck={false}
                        onFocus={() => setActive({ row, col })}
                        onChange={(event) => {
                          session.table_set_text(blockId, row, col, event.currentTarget.value);
                          nudge();
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && !menu && (
        <button
          type="button"
          className="table-tools"
          aria-label="Table options"
          onClick={() => setMenu({ ...active, x: 0, y: 0, sheet: true })}
        >
          Table
        </button>
      )}

      {menu &&
        createPortal(
          <div
            className="cell-menu"
            data-sheet={menu.sheet ? "on" : "off"}
            role="menu"
            style={menu.sheet ? undefined : { left: menu.x, top: menu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
