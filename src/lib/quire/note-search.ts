/**
 * "Search notes" from the strip: one query, every sheet, every match.
 *
 * The matching itself is the document core's (`Session::find`, the routine the find bar
 * uses), so what this search finds can never drift from what Ctrl+F finds: same case
 * folding, same UTF-16 offsets, same "next match starts after this one" rule.
 *
 * The result is per block, because that is the unit the editors paint: a block's ranges
 * become temporary yellow highlights and nothing is written to the document.
 */
import type { Session } from "@/lib/quire/engine";

export type Range = { start: number; end: number };

export type BlockHits = { blockId: number; ranges: Range[] };

export type NoteHits = {
  /** Matches in the whole sheet. */
  total: number;
  /** Only the blocks that matched, in document order. */
  blocks: BlockHits[];
};

export const EMPTY_HITS: NoteHits = { total: 0, blocks: [] };

/** Every match of `query` in the text blocks `textIds`, per block. */
export function findInNote(session: Session, textIds: number[], query: string): NoteHits {
  if (!query) return EMPTY_HITS;
  const blocks: BlockHits[] = [];
  let total = 0;
  for (const blockId of textIds) {
    const ranges: Range[] = [];
    let from = 0;
    for (;;) {
      const hit = session.find(query, false, blockId, from, false);
      // `find` keeps walking past the block; a hit elsewhere ends this block's run.
      if (!hit || hit.block_id !== blockId) break;
      ranges.push({ start: hit.start, end: hit.end });
      total += 1;
      from = hit.end > hit.start ? hit.end : hit.start + 1;
      if (ranges.length >= MAX_PER_BLOCK) break;
    }
    if (ranges.length > 0) blocks.push({ blockId, ranges });
  }
  return { total, blocks };
}

/** A sheet's worth of matches more than this is a runaway query, not a search. */
const MAX_PER_BLOCK = 5000;
