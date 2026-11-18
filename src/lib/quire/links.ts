/**
 * What a link looks like inside a sheet.
 *
 * Papel stores no link objects: a link is plain text plus the same two style runs the
 * toolbar writes — Blue ink and underline (marks.ts `INKS`, `FLAG.underline`). Keeping it
 * that way means links survive `restore_*`, undo, save-as-`.papel`, tables of marks, and
 * both renderers, with no new block kind and no new mark flag to keep in sync.
 *
 * The core styles the *characters*, so a link is a link only while the text is unchanged:
 * typing over it is the same as typing over bold text.
 */
import type { Session } from "@/lib/quire/engine";
import type { UrlSpan } from "@/lib/quire/urls";

/** "Blue" in the ink palette (`INKS[2]` in marks.ts). */
export const LINK_INK = 2;

/** Writes the link look over `spans`, which are relative to `base`. */
export function stylizeLinks(
  session: Session,
  blockId: number,
  base: number,
  spans: UrlSpan[],
): void {
  for (const span of spans) {
    const from = base + span.start;
    const to = base + span.end;
    if (to <= from) continue;
    session.apply_style(blockId, from, to, "ink", LINK_INK);
    // `apply_style` takes on/off for a flag, not the bit itself (see StyleChange::parse).
    session.apply_style(blockId, from, to, "underline", 1);
  }
}
