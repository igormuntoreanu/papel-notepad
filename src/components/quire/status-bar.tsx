import type { Session } from "@/lib/quire/engine";
import { LANGUAGES } from "@/lib/quire/text";
import { tornClip } from "@/lib/quire/torn";
import { DropMenu } from "./drop-menu";

const ENCODINGS = [
  ["utf-8", "UTF-8"],
  ["utf-8-bom", "UTF-8 BOM"],
  ["utf-16le", "UTF-16 LE"],
  ["windows-1252", "Windows-1252"],
] as const;

const STATUS_CLIP = tornClip("papel-status", 4, { top: true }, 60);

export function StatusBar({
  view,
  session,
  metrics,
  langText,
  zoom,
  message,
  total,
  unsaved,
  shown,
  onChanged,
  onMessage,
}: {
  view: "board" | "focus";
  session: Session | null;
  metrics: ArrayLike<number>;
  langText: string;
  zoom: number;
  message: string;
  total: number;
  unsaved: number;
  shown: number;
  onChanged: () => void;
  onMessage: (m: string) => void;
}) {
  return (
    <footer className="status">
      <div className="status-bg" style={{ clipPath: STATUS_CLIP }} aria-hidden="true" />
      {view === "focus" && session ? (
        <>
          <span>
            Ln {metrics[0]}, Col {metrics[1]}
          </span>
          <span>{metrics[3]} chars</span>
          <DropMenu
            label={langText}
            align="up"
            items={LANGUAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === session.language() ? "menu-item is-on" : "menu-item"}
                onClick={() => {
                  session.set_language(item.id);
                  onChanged();
                }}
              >
                {item.label}
              </button>
            ))}
          />
          <DropMenu
            label={session.encoding_label()}
            align="up"
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
            label={session.eol_label()}
            align="up"
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
          <span>{Math.round((zoom / 16) * 100)}%</span>
        </>
      ) : (
        <>
          <span>
            {total} {total === 1 ? "sheet" : "sheets"}
          </span>
          {shown !== total && <span>{shown} shown</span>}
          <span>{unsaved ? `${unsaved} not saved to a file` : "No unsaved changes"}</span>
          <span>Autosaved on this device</span>
        </>
      )}
      {message && (
        <span className="status-msg" role="status">
          {message}
        </span>
      )}
    </footer>
  );
}
