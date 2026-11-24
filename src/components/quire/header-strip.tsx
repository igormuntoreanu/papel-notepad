import {
  ChevronDown,
  FilePlus,
  FolderOpen,
  FolderSync,
  LayoutGrid,
  Maximize2,
  Minus,
  Search,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { desktopBridge } from "@/lib/desktop/bridge";
import { SNAP_LAYOUTS, type SnapRect } from "@/lib/desktop/snap-layouts";
import type { Session } from "@/lib/quire/engine";
import { tornClip } from "@/lib/quire/torn";
import { ENCODINGS, SKINS, type SkinId } from "@/lib/quire/text";
import type { SortMode } from "@/lib/quire/persist";
import { APP_VERSION } from "@/lib/version";
import { DropMenu } from "./drop-menu";

const HEADER_CLIP = tornClip("papel-header", 5, { bottom: true }, 40);

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
  sort,
  setSort,
  onNew,
  onOpen,
  skin,
  setSkin,
  autocorrect,
  setAutocorrect,
  lastBackup,
  onExportZip,
  onImportBackup,
  folderSupported,
  folderName,
  onPickFolder,
  session,
  metrics,
  message,
  total,
  unsaved,
  binCount,
  onOpenBin,
  versionCount,
  onOpenHistory,
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
  sort: SortMode;
  setSort: (v: SortMode) => void;
  onNew: () => void;
  onOpen: () => void;
  skin: SkinId;
  setSkin: (v: SkinId) => void;
  autocorrect: boolean;
  setAutocorrect: (v: boolean) => void;
  lastBackup: string | null;
  onExportZip: () => void;
  onImportBackup: () => void;
  folderSupported: boolean;
  folderName: string | null;
  onPickFolder: () => void;
  session: Session | null;
  metrics: ArrayLike<number>;
  message: string;
  total: number;
  unsaved: number;
  binCount: number;
  onOpenBin: () => void;
  versionCount: number;
  onOpenHistory: () => void;
  onChanged: () => void;
  onMessage: (m: string) => void;
}) {
  const bridge = desktopBridge();
  const isDesktop = bridge !== null;

  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const [maximized, setMaximized] = useState(false);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapBox, setSnapBox] = useState({ top: 0, right: 8 });
  const maxBtnRef = useRef<HTMLButtonElement>(null);
  const snapPanelRef = useRef<HTMLDivElement>(null);
  const snapOpenTimer = useRef<number | null>(null);
  const snapCloseTimer = useRef<number | null>(null);
  const canSnap = typeof bridge?.snap === "function";

  function clearSnapTimers() {
    if (snapOpenTimer.current !== null) window.clearTimeout(snapOpenTimer.current);
    if (snapCloseTimer.current !== null) window.clearTimeout(snapCloseTimer.current);
    snapOpenTimer.current = null;
    snapCloseTimer.current = null;
  }

  function placeSnap() {
    const rect = maxBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelWidth = Math.min(566, window.innerWidth - 16);
    const besideButton = Math.max(8, window.innerWidth - rect.right);
    const onScreen = Math.max(8, window.innerWidth - panelWidth - 8);
    setSnapBox({
      top: rect.bottom + 4,
      right: Math.min(besideButton, onScreen),
    });
    setSnapOpen(true);
  }

  function armSnapOpen() {
    if (!canSnap) return;
    if (snapCloseTimer.current !== null) window.clearTimeout(snapCloseTimer.current);
    snapCloseTimer.current = null;
    if (snapOpen) return;
    if (snapOpenTimer.current !== null) window.clearTimeout(snapOpenTimer.current);
    snapOpenTimer.current = window.setTimeout(() => {
      snapOpenTimer.current = null;
      placeSnap();
    }, 400);
  }

  function armSnapClose() {
    if (snapOpenTimer.current !== null) {
      window.clearTimeout(snapOpenTimer.current);
      snapOpenTimer.current = null;
    }
    if (snapCloseTimer.current !== null) window.clearTimeout(snapCloseTimer.current);
    snapCloseTimer.current = window.setTimeout(() => {
      snapCloseTimer.current = null;
      setSnapOpen(false);
    }, 280);
  }

  useEffect(() => {
    if (!snapOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSnapOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (maxBtnRef.current?.contains(target) || snapPanelRef.current?.contains(target)) return;
      setSnapOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [snapOpen]);

  useEffect(() => () => clearSnapTimers(), []);

  async function applySnap(rect: SnapRect) {
    if (!bridge?.snap) return;
    setSnapOpen(false);
    await bridge.snap(rect);
    setMaximized(await bridge.isMaximized());
  }

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.appVersion().then((v) => {
      if (!cancelled && v) setAppVersion(v);
    });
    void bridge.isMaximized().then((v) => {
      if (!cancelled) setMaximized(v);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  /**
   * The note search: one small field in the status row, its loupe doubling as the submit
   * button. Enter and the loupe do the same thing — search every sheet and paint the
   * matches (see `runNoteSearch` in the app).
   */
  const searchField = (
    <form
      className="strip-search strip-no-drag"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onGo();
      }}
    >
      <span className="field-box">
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search notes"
          aria-label="Search notes"
          title="Search every sheet (Enter)"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
        <button type="submit" className="strip-search-go" aria-label="Search notes" title="Search every sheet (Enter)">
          <Search aria-hidden="true" />
        </button>
      </span>
    </form>
  );

  return (
    <header
      className="strip"
      data-view={view}
      data-desktop={isDesktop ? "on" : "off"}
      data-tauri-drag-region={isDesktop ? true : undefined}
    >
      <div className="strip-paper" data-tauri-drag-region={isDesktop ? true : undefined}>
        <div className="strip-bg" style={{ clipPath: HEADER_CLIP }} aria-hidden="true" />
        <div className="strip-top" data-tauri-drag-region={isDesktop ? true : undefined}>
          <span className="brand-name">
            Papel <span className="brand-ver">(v{appVersion})</span>
          </span>
          <DropMenu
            className="variant strip-no-drag"
            ariaLabel="Switch sheet"
            title="Switch sheet"
            label={
              <>
                <span className="variant-label">{current}</span>
                <ChevronDown aria-hidden="true" />
              </>
            }
            items={
              <>
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
                <span className="strip-sep" aria-hidden="true">
                  |
                </span>
                {searchField}
              </>
            ) : (
              <>
                <span title="Sheets on the board">
                  {total} {total === 1 ? "sheet" : "sheets"}
                </span>
                {unsaved > 0 && (
                  <span title="Sheets not yet saved to a downloaded file">{unsaved} unsaved</span>
                )}
                <span className="strip-sep" aria-hidden="true">
                  |
                </span>
                {searchField}
              </>
            )}
          </div>
          {message && (
            <span className="status-msg" role="status">
              {message}
            </span>
          )}
          <button
            type="button"
            className={`tool strip-no-drag${view === "board" ? " is-on" : ""}`}
            onClick={onBoard}
            aria-label="Board"
            title="Board"
            aria-pressed={view === "board"}
          >
            <LayoutGrid />
            <span className="tool-label">Board</span>
          </button>
          <button
            type="button"
            className="tool strip-no-drag"
            onClick={onNew}
            aria-label="New sheet"
            title="New sheet (Ctrl+N)"
          >
            <FilePlus />
            <span className="tool-label">New</span>
          </button>
          <button
            type="button"
            className="tool strip-no-drag"
            onClick={onOpen}
            aria-label="Open file"
            title="Open file (Ctrl+O)"
          >
            <FolderOpen />
          </button>
          <DropMenu
            className="tool strip-no-drag"
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
                <label className="menu-field">
                  <span>Board order</span>
                  <span className="field-box select-box">
                    <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                      <option value="title">Title</option>
                      <option value="recent">Last edited</option>
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </span>
                </label>
                {session && (
                  <>
                    <div className="menu-sep" role="separator" />
                    <p className="menu-heading">This sheet's file</p>
                    <label className="menu-field">
                      <span>Encoding</span>
                      <span className="field-box select-box">
                        <select
                          value={session.encoding()}
                          onChange={(e) => {
                            const id = e.target.value;
                            const result = session.set_encoding(id);
                            const label = e.target.selectedOptions[0]?.textContent ?? id;
                            onMessage(result.startsWith("err:") ? result.slice(4) : `Encoding: ${label}`);
                            onChanged();
                          }}
                        >
                          {ENCODINGS.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown aria-hidden="true" />
                      </span>
                    </label>
                    <label className="menu-field">
                      <span>Line endings</span>
                      <span className="field-box select-box">
                        <select
                          value={session.eol()}
                          onChange={(e) => {
                            session.set_eol(e.target.value);
                            onChanged();
                          }}
                        >
                          <option value="lf">Unix (LF)</option>
                          <option value="crlf">Windows (CRLF)</option>
                        </select>
                        <ChevronDown aria-hidden="true" />
                      </span>
                    </label>
                  </>
                )}
                <div className="menu-sep" role="separator" />
                <p className="menu-heading">History</p>
                <button type="button" className="menu-item" onClick={onOpenBin}>
                  Bin… ({binCount})
                </button>
                {session && (
                  <button type="button" className="menu-item" onClick={onOpenHistory}>
                    Version history… ({versionCount})
                  </button>
                )}
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
                <button type="button" className="menu-item" onClick={onImportBackup}>
                  Import backup…
                </button>
                {lastBackup && <p className="menu-note">Last backup: {lastBackup}</p>}
              </div>
            }
          />
          {isDesktop && bridge && (
            <div className="win-controls strip-no-drag" role="group" aria-label="Window">
              <span className="win-sep" aria-hidden="true" />
              <button
                type="button"
                className="win-btn"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => void bridge.minimize()}
              >
                <Minus />
              </button>
              <button
                ref={maxBtnRef}
                type="button"
                className="win-btn"
                aria-label={maximized ? "Restore" : "Maximize"}
                aria-haspopup={canSnap ? "menu" : undefined}
                aria-expanded={canSnap ? snapOpen : undefined}
                title={
                  canSnap
                    ? maximized
                      ? "Restore. Right-click or hover for snap layouts."
                      : "Maximize. Right-click or hover for snap layouts."
                    : maximized
                      ? "Restore"
                      : "Maximize"
                }
                onClick={() => {
                  setSnapOpen(false);
                  void bridge.toggleMaximize().then(async () => {
                    setMaximized(await bridge.isMaximized());
                  });
                }}
                onContextMenu={(event) => {
                  if (!canSnap) return;
                  event.preventDefault();
                  clearSnapTimers();
                  placeSnap();
                }}
                onMouseEnter={armSnapOpen}
                onMouseLeave={armSnapClose}
              >
                {maximized ? <Square /> : <Maximize2 />}
              </button>
              {snapOpen &&
                canSnap &&
                createPortal(
                  <div
                    ref={snapPanelRef}
                    className="snap-flyout strip-no-drag"
                    role="menu"
                    aria-label="Snap layouts"
                    style={{ top: snapBox.top, right: snapBox.right }}
                    onMouseEnter={() => {
                      if (snapCloseTimer.current !== null) window.clearTimeout(snapCloseTimer.current);
                      snapCloseTimer.current = null;
                    }}
                    onMouseLeave={armSnapClose}
                  >
                    {SNAP_LAYOUTS.map((layout) => (
                      <div key={layout.id} className="snap-layout" role="group" aria-label={layout.label}>
                        {layout.zones.map((zone) => (
                          <button
                            key={zone.id}
                            type="button"
                            className="snap-zone"
                            role="menuitem"
                            title={zone.label}
                            aria-label={zone.label}
                            style={{
                              left: `${zone.rect.x * 100}%`,
                              top: `${zone.rect.y * 100}%`,
                              width: `${zone.rect.w * 100}%`,
                              height: `${zone.rect.h * 100}%`,
                            }}
                            onClick={() => void applySnap(zone.rect)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>,
                  document.body,
                )}
              <button
                type="button"
                className="win-btn win-close"
                aria-label="Close"
                title="Close"
                onClick={() => void bridge.close()}
              >
                <X />
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
