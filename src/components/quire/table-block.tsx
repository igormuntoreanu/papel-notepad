import { useEffect, useMemo, useRef } from "react";
import type { Session } from "@/lib/quire/engine";

type CellData = { t: string; f: number };
type TableData = { cols: number; cells: CellData[] };

/**
 * A table block.
 *
 * Cells are uncontrolled inputs: the session holds the text, `defaultValue`
 * seeds the DOM once, and a keystroke is one `table_set_text` call. The parent
 * is told about the edit on a short delay instead of per key — notifying it
 * re-renders the whole grid, which measured 109 ms per keystroke in a 20×20
 * table. Dirty state and autosave are unaffected; autosave already waits.
 */
export function TableBlock({
  blockId,
  session,
  onEdited,
}: {
  blockId: number;
  session: Session;
  onEdited: () => void;
}) {
  const table = useMemo<TableData>(() => {
    try {
      return JSON.parse(session.table_json(blockId)) as TableData;
    } catch {
      return { cols: 1, cells: [{ t: "", f: 0 }] };
    }
  }, [blockId, session]);

  const pending = useRef<number | null>(null);
  const latest = useRef(onEdited);
  latest.current = onEdited;

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

  const cols = Math.max(1, table.cols);
  const rows = Math.max(1, Math.ceil(table.cells.length / cols));

  return (
    <div className="block table-block" onBlur={flush}>
      <div className="table-scroll">
        <table className="sheet-table">
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: cols }, (_, col) => {
                  const cell = table.cells[row * cols + col] ?? { t: "", f: 0 };
                  return (
                    <td key={col} className={cell.f ? `fill-${cell.f}` : undefined}>
                      <input
                        aria-label={`Row ${row + 1}, column ${col + 1}`}
                        defaultValue={cell.t}
                        spellCheck={false}
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
    </div>
  );
}
