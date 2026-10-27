import {
  ChevronDown,
  FilePlus,
  FolderOpen,
  FolderSync,
  LayoutGrid,
  ListFilter,
  Search,
  Settings2,
} from "lucide-react";
import { useState, type RefObject } from "react";
import type { Session } from "@/lib/quire/engine";
import { tornClip } from "@/lib/quire/torn";
import { SKINS, type SkinId } from "@/lib/quire/text";
import type { SortMode } from "@/lib/quire/persist";
import { DropMenu } from "./drop-menu";

const HEADER_CLIP = tornClip("papel-header", 5, { bottom: true }, 40);

const ENCODINGS = [
  ["utf-8", "UTF-8"],
  ["utf-8-bom", "UTF-8 BOM"],
  ["utf-16le", "UTF-16 LE"],
  ["windows-1252", "Windows-1252"],
] as const;

export type SwitchItem = { id: string; title: string; dirty: boolean };

export function HeaderStrip({
  view,
  current,
  currentId,
  items,
  onBoard,
  onSwitch,
  query,
  setQuery,
  onGo,
  searchRef,
  hint,
  sort,
  setSort,
  onNew,
  onOpen,
  skin,
  setSkin,
  autocorrect,
  setAutocorrect,
  lastBackup,
  onExportAll,
  onExportZip,
  onImportBackup,
  folderSupported,
  folderName,
  onPickFolder,
  session,
  metrics,
  zoom,
  message,
  total,
  unsaved,
  shown,
  onChanged,
  onMessage,
}: {
  view: "board" | "focus";
  current: string;
  currentId: string | null;
  items: SwitchItem[];
  onBoard: () => void;
  onSwitch: (id: string) => void;
  query: string;
  setQuery: (v: string) => void;
  onGo: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  hint: string;
  sort: SortMode;
  setSort: (v: SortMode) => void;
  onNew: () => void;
  onOpen: () => void;
  skin: SkinId;
  setSkin: (v: SkinId) => void;
  autocorrect: boolean;
  setAutocorrect: (v: boolean) => void;
  lastBackup: string | null;
  onExportAll: () => void;
  onExportZip: () => void;
  onImportBackup: () => void;
  folderSupported: boolean;
  folderName: string | null;
  onPickFolder: () => void;
  session: Session | null;
  metrics: ArrayLike<number>;
 zoom: number;
  message: string;
  total: number;
  unsaved: number;
  shown: number;
  onChanged: () => void;
  onMessage: (m: string) => void;
}) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const filterOn = sort !== "manual";
  const filterLabel = filterOn
    ? (sort === "recent" ? "Last edited" : sort === "title" ? "Title" : null) ?? "Filters"
    : "Filters";

  return (
    <header className="strip" data-fields={fieldsOpen ? "open" : "closed"} data-view={view}>
      <div className="strip-paper">
        <div className="strip-bg" style={{ clipPath: HEADER_CLIP }} aria-hidden="true" />
        <div className="strip-top">
          <span className="brand-name">Papel</span>
          <DropMenu
            className="variant"
            ariaLabel="Switch sheet"
            title="Switch sheet or open the board"
            label={
              <>
                <span className="variant-label">{current}</span>
                <ChevronDown aria-hidden="true" />
              </>
            }
            items={
              <>
                <button type="button" className={view === "board" ? "menu-item is-on" : "menu-item"} onClick={onBoard}>
                  <LayoutGrid aria-hidden="true" /> Board
                </button>
                <div className="menu-sep" role="separator" />
                {items.length === 0 && <p className="menu-note">No sheets yet.</p>}
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={view === "focus" && item.id === currentId ? "menu-item is-on" : "menu-item"}
                    onClick={() => onSwitch(item.id)}
                  >
                    <span className="menu-title">{item.title}</span>
                    {item.dirty && <span className="dirty" aria-label="Unsaved" />}
                  </button>
                ))}
              </>
            }
          />
          <div className="strip-status" aria-live="polite">
            {view === "focus" && session ? (
              <>
                <span title="Current line and column">
                  Ln {metrics[0]}, Col {metrics[1]}
                </span>
                <span title="Character count in this sheet">{metrics[3]} chars</span>
                {/* One language only: every sheet is plain text, so there is nothing to pick. */}
                <span title="Every sheet is plain text">Plain text</span>
                <DropMenu
                  className="tool status-chip"
                  label={session.encoding_label()}
                  title="File encoding"
                  align="end"
                  items={ENCODINGS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        const result = session.set_encoding(id);
                        onMessage(result.startsWith("err:") ? result.slice(4) : label);
                        onChanged();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                />
                <DropMenu
                  className="tool status-chip"
                  label={session.eol_label()}
                  title="Line endings"
                  align="end"
                  items={
                    <>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          session.set_eol("lf");
                          onChanged();
                        }}
                      >
                        Unix (LF)
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          session.set_eol("crlf");
                          onChanged();
                        }}
                      >
                        Windows (CRLF)
                      </button>
                    </>
                  }
                />
                <span title="Zoom level">{Math.round((zoom / 16) * 100)}%</span>
              </>
            ) : (
              <>
                <span title="Sheets on the board">
                  {total} {total === 1 ? "sheet" : "sheets"}
                </span>
                {shown !== total && <span title="Sheets matching filters">{shown} shown</span>}
                <span title="Sheets not yet saved to a downloaded file">
                  {unsaved ? `${unsaved} not saved to a file` : "No unsaved changes"}
                </span>
                <span title={folderName ? `Sync folder: ${folderName}` : "Saved in this browser"}>
                  {folderName ? `Folder: ${folderName}` : "Autosaved on this device"}
                </span>
              </>
            )}
            {message && (
              <span className="status-msg" role="status">
                {message}
              </span>
            )}
          </div>
          <button
            type="button"
            className="tool fields-toggle"
            aria-label="Search and filters"
            title="Search and filters"
            aria-expanded={fieldsOpen}
            onClick={() => {
              setFieldsOpen((v) => !v);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            <Search />
          </button>
          <button type="button" className="tool" onClick={onNew} aria-label="New sheet" title="New sheet (Ctrl+N)">
            <FilePlus />
            <span className="tool-label">New</span>
          </button>
          <button type="button" className="tool" onClick={onOpen} aria-label="Open file" title="Open file (Ctrl+O)">
            <FolderOpen />
          </button>
          <DropMenu
            ariaLabel="Settings"
            title="Paper, typing, folder and backup"
            label={<Settings2 />}
            align="end"
            items={
              <div className="settings">
                <p className="menu-heading">Paper</p>
                {SKINS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === skin ? "skin-card is-on" : "skin-card"}
                    onClick={() => setSkin(item.id)}
                  >
                    <span className="swatch" data-skin={item.id} aria-hidden="true" />
                    <span>
                      <strong>{item.name}</strong>
                      <em>{item.blurb}</em>
                    </span>
                  </button>
                ))}
                <div className="menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={autocorrect}
                  className={autocorrect ? "menu-item is-on" : "menu-item"}
                  onClick={() => setAutocorrect(!autocorrect)}
                >
                  <span className="check" aria-hidden="true">{autocorrect ? "✓" : ""}</span>
                  Autocorrect English typos
                </button>
                <div className="menu-sep" role="separator" />
                <p className="menu-heading">Folder & backup</p>
                {folderSupported ? (
                  folderName ? (
                    <>
                      <p className="menu-note">
                        <FolderSync aria-hidden="true" className="menu-inline-icon" /> Syncing to {folderName}
                      </p>
                      <button type="button" className="menu-item" onClick={onPickFolder}>
                        Change folder…
                      </button>
                    </>
                  ) : (
                    <button type="button" className="menu-item" onClick={onPickFolder}>
                      Choose folder…
                    </button>
                  )
                ) : (
                  <p className="menu-note">Folder sync needs Chrome or Edge. Use Export zip on this browser.</p>
                )}
                <button type="button" className="menu-item" onClick={onExportZip}>
                  Export zip…
                </button>
                <button type="button" className="menu-item" onClick={onExportAll}>
                  Export archive…
                </button>
                <button type="button" className="menu-item" onClick={onImportBackup}>
                  Import backup…
                </button>
                {lastBackup && <p className="menu-note">Last backup: {lastBackup}</p>}
              </div>
            }
          />
        </div>

        <form
          className="filters"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onGo();
          }}
        >
          <label className="field field-search">
            <span>Search notes</span>
            <span className="field-box">
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Words, titles, typos welcome"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              <Search aria-hidden="true" />
            </span>
          </label>
          <DropMenu
            className={filterOn ? "filter-chip is-on" : "filter-chip"}
            ariaLabel="Sort order"
            title={filterLabel}
            label={
              <>
                <ListFilter aria-hidden="true" />
                <span>{filterLabel}</span>
              </>
            }
            items={
              <div
                className="filter-menu"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <label className="field">
                  <span>Sort</span>
                  <span className="field-box">
                    <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                      <option value="manual">My order</option>
                      <option value="recent">Last edited</option>
                      <option value="title">Title</option>
                    </select>
                  </span>
                </label>
              </div>
            }
          />
          <div className="go-wrap">
            <button type="submit" className="btn go" title="Search short words (Enter)">
              Go
            </button>
            <span className="go-hint" aria-live="polite">
              {hint}
            </span>
          </div>
        </form>
      </div>
    </header>
  );
}
