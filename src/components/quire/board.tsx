import { MoreHorizontal } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { tiltOf, tornClip } from "@/lib/quire/torn";
import { DropMenu } from "./drop-menu";
import { relativeTime, type CardInfo, type NoteMeta } from "./store";

export type CardActions = {
  open: (id: string) => void;
  rename: (id: string, title: string) => void;
  save: (id: string) => void;
  close: (id: string) => void;
  move: (id: string, delta: number) => void;
  reorder: (id: string, beforeId: string) => void;
};

type Props = {
  /** Changes whenever anything the cards show changes; the board skips re-rendering otherwise. */
  stamp: string;
  ids: string[];
  notes: Map<string, NoteMeta>;
  info: (id: string) => CardInfo | null;
  snippets: Map<string, string>;
  activeId: string | null;
  compact: boolean;
  edge: string;
  canReorder: boolean;
  actions: CardActions;
  now: number;
};

const CARD_MIN = 260;

export const Board = memo(BoardView, (a, b) => a.stamp === b.stamp);

function BoardView({ ids, notes, info, snippets, activeId, compact, edge, canReorder, actions, now }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [cols, setCols] = useState(1);
  const moved = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || compact) return;
    const measure = () => {
      const gap = 28;
      setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (CARD_MIN + gap))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  function startDrag(id: string, e: ReactPointerEvent) {
    if (!canReorder || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, .menu, a")) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    moved.current = false;
    let lastTarget: string | undefined;
    const move = (ev: PointerEvent) => {
      if (!moved.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
      if (!moved.current) {
        moved.current = true;
        setDragging(id);
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-card-id]");
      const target = el?.dataset.cardId;
      if (target && target !== id && target !== lastTarget) actions.reorder(id, target);
      lastTarget = target;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(null);
      // The click that ends a drag fires before this timeout; later clicks open cards normally.
      window.setTimeout(() => {
        moved.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const renderCard = (id: string, index: number) => {
        const meta = notes.get(id);
        const data = info(id);
        if (!meta || !data) return null;
        return (
          <NoteCard
            key={id}
            meta={meta}
            info={data}
            snippet={snippets.get(id)}
            active={id === activeId}
            compact={compact}
            edge={edge}
            first={index === 0}
            last={index === ids.length - 1}
            canReorder={canReorder}
            dragging={dragging === id}
            now={now}
            actions={actions}
            onPointerDown={(e) => startDrag(id, e)}
            onOpen={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              actions.open(id);
            }}
          />
        );
  };

  if (compact) {
    return (
      <div className="board" data-compact="on" data-dragging={dragging ? "on" : "off"}>
        {ids.map(renderCard)}
      </div>
    );
  }

  // Cards are dealt left to right so reading order matches the board, like a desk of notes.
  const columns: { id: string; index: number }[][] = Array.from({ length: cols }, () => []);
  ids.forEach((id, index) => columns[index % cols]!.push({ id, index }));
  return (
    <div ref={ref} className="board" data-compact="off" data-dragging={dragging ? "on" : "off"}>
      {columns.map((column, c) => (
        <div key={c} className="board-col">
          {column.map(({ id, index }) => renderCard(id, index))}
        </div>
      ))}
    </div>
  );
}

const NoteCard = memo(NoteCardView, (a, b) => {
  const x = a.info;
  const y = b.info;
  return (
    a.meta === b.meta &&
    a.snippet === b.snippet &&
    a.active === b.active &&
    a.compact === b.compact &&
    a.edge === b.edge &&
    a.first === b.first &&
    a.last === b.last &&
    a.canReorder === b.canReorder &&
    a.dragging === b.dragging &&
    a.now === b.now &&
    x.preview === y.preview &&
    x.words === y.words &&
    x.lines === y.lines &&
    x.lang === y.lang &&
    x.image === y.image &&
    x.images === y.images &&
    x.dirty === y.dirty &&
    (x.text.trim() === "") === (y.text.trim() === "")
  );
});

function NoteCardView({
  meta,
  info,
  snippet,
  active,
  compact,
  edge,
  first,
  last,
  canReorder,
  dragging,
  now,
  actions,
  onPointerDown,
  onOpen,
}: {
  meta: NoteMeta;
  info: CardInfo;
  snippet: string | undefined;
  active: boolean;
  compact: boolean;
  edge: string;
  first: boolean;
  last: boolean;
  canReorder: boolean;
  dragging: boolean;
  now: number;
  actions: CardActions;
  onPointerDown: (e: ReactPointerEvent) => void;
  onOpen: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const torn = edge === "torn";
  const style = {
    "--tilt": compact ? "0deg" : `${tiltOf(meta.id)}deg`,
  } as CSSProperties;
  const clip = torn ? { clipPath: tornClip(meta.id, 4.5) } : undefined;
  const underClip = torn ? { clipPath: tornClip(`${meta.id}:under`, 6) } : undefined;
  const bodyClip = torn ? { clipPath: tornClip(`${meta.id}:body`, 3, { top: true, bottom: true, left: false, right: false }, 18) } : undefined;
  const edited = relativeTime(meta.edited, now);
  const empty = !info.text.trim() && info.images === 0;

  function commit(value: string) {
    actions.rename(meta.id, value);
    setRenaming(false);
  }

  return (
    <div
      className={["card-wrap", active && "is-active", dragging && "is-dragging"].filter(Boolean).join(" ")}
      data-card-id={meta.id}
      data-edge={edge}
      style={style}
      onPointerDown={onPointerDown}
    >
      {torn && <div className="card-under" style={underClip} aria-hidden="true" />}
      <article className="card" onClick={onOpen} aria-current={active ? "page" : undefined}>
        <div className="card-bg" style={clip} aria-hidden="true" />
        <header className="card-head">
          <div className="card-titles">
            {renaming ? (
              <input
                className="card-rename"
                aria-label="Note name"
                defaultValue={meta.title}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(e.currentTarget.value);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <h3 className="card-title">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenaming(true);
                  }}
                >
                  {meta.title}
                </button>
              </h3>
            )}
            <p className="card-sub">
              {info.lang} · {edited}
            </p>
          </div>
          {info.dirty && <span className="dirty" role="img" aria-label="Unsaved" title="Not saved to a file" />}
          <div onClick={(e) => e.stopPropagation()}>
            <DropMenu
              className="tool card-more"
              ariaLabel={`Actions for ${meta.title}`}
              label={<MoreHorizontal />}
              align="end"
              items={
                <>
                  <button type="button" className="menu-item" onClick={() => actions.open(meta.id)}>
                    Open
                  </button>
                  <button type="button" className="menu-item" onClick={() => setRenaming(true)}>
                    Rename
                  </button>
                  <button type="button" className="menu-item" onClick={() => actions.save(meta.id)}>
                    Save to file
                  </button>
                  {canReorder && (
                    <>
                      <button type="button" className="menu-item" disabled={first} onClick={() => actions.move(meta.id, -1)}>
                        Move earlier
                      </button>
                      <button type="button" className="menu-item" disabled={last} onClick={() => actions.move(meta.id, 1)}>
                        Move later
                      </button>
                    </>
                  )}
                  <button type="button" className="menu-item danger" onClick={() => actions.close(meta.id)}>
                    Close sheet
                  </button>
                </>
              }
            />
          </div>
        </header>

        {!compact && info.image && (
          <div className="card-thumb">
            <img src={info.image} alt="" loading="lazy" />
            {info.images > 1 && <span className="card-count">+{info.images - 1}</span>}
          </div>
        )}

        <div className="card-body" style={bodyClip}>
          {snippet ? (
            <p className="card-snippet">{snippet}</p>
          ) : empty ? (
            <p className="card-empty">A blank sheet.</p>
          ) : (
            <pre className="card-preview" data-code={info.code ? "on" : "off"}>
              {compact ? info.preview.split("\n").slice(0, 2).join("\n") : info.preview}
            </pre>
          )}
        </div>

        {!compact && (
          <footer className="card-foot">
            <span className="kpi">
              <strong>{info.words}</strong> {info.words === 1 ? "word" : "words"}
            </span>
            <span className="card-meta">
              {info.lines} {info.lines === 1 ? "line" : "lines"}
            </span>
            <span className="badge">{info.lang}</span>
          </footer>
        )}
      </article>
    </div>
  );
}
