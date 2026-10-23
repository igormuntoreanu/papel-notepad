import { ChevronDown, ChevronUp, FilePlus, FolderOpen, LayoutGrid, ListFilter, Search, Settings2 } from "lucide-react";
import { useState, type RefObject } from "react";
import { tornClip } from "@/lib/quire/torn";
import { SKINS, type SkinId } from "@/lib/quire/text";
import type { SortMode } from "@/lib/quire/persist";
import { DropMenu } from "./drop-menu";

const HEADER_CLIP = tornClip("papel-header", 7, { bottom: true }, 48);

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
  langs,
  lang,
  setLang,
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
  onImportBackup,
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
  langs: string[];
  lang: string;
  setLang: (v: string) => void;
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
  onImportBackup: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const filterOn = Boolean(lang) || sort !== "manual";
  const filterLabel = filterOn
    ? [lang || null, sort === "recent" ? "Recent" : sort === "title" ? "Title" : null].filter(Boolean).join(" · ") || "Filters"
    : "Filters";

  return (
    <header
      className="strip"
      data-collapsed={collapsed ? "on" : "off"}
      data-fields={fieldsOpen ? "open" : "closed"}
      data-view={view}
    >
      <div className="strip-paper">
        <div className="strip-bg" style={{ clipPath: HEADER_CLIP }} aria-hidden="true" />
        <div className="strip-top">
          <span className="brand-name">Papel</span>
          <DropMenu
            className="variant"
            ariaLabel="Switch sheet"
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
          <span className="spacer" />
          <button
            type="button"
            className="tool fields-toggle"
            aria-label="Search and filters"
            aria-expanded={fieldsOpen}
            onClick={() => {
              setFieldsOpen((v) => !v);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            <Search />
          </button>
          <button type="button" className="tool" onClick={onNew} title="New sheet (Ctrl+N)">
            <FilePlus />
            <span className="tool-label">New</span>
          </button>
          <button type="button" className="tool" onClick={onOpen} aria-label="Open file" title="Open file (Ctrl+O)">
            <FolderOpen />
          </button>
          <DropMenu
            ariaLabel="Settings"
            title="Paper and typing"
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
                <p className="menu-heading">Backup</p>
                <button type="button" className="menu-item" onClick={onExportAll}>
                  Export all…
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
            ariaLabel="Language and sort filters"
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
                  <span>Language</span>
                  <span className="field-box">
                    <select value={lang} onChange={(e) => setLang(e.target.value)}>
                      <option value="">Any</option>
                      {langs.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
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
      <button
        type="button"
        className="strip-fold"
        aria-label={collapsed ? "Show filters" : "Hide filters"}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <ChevronDown /> : <ChevronUp />}
      </button>
    </header>
  );
}
