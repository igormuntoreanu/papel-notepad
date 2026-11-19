import type { StoredCarbonCopy } from "./persist";

/** How many carbon copies one sheet keeps. */
export const CARBON_LIMIT = 20;

/**
 * Appends a carbon copy, skipping an identical last version, and caps the history.
 * Returns the same object when nothing changed so callers can avoid a state update.
 */
export function pushCarbon(
  carbon: Record<string, StoredCarbonCopy[]>,
  id: string,
  copy: StoredCarbonCopy,
): Record<string, StoredCarbonCopy[]> {
  const list = carbon[id] ?? [];
  const last = list[list.length - 1];
  if (last && last.papel === copy.papel) return carbon;
  return { ...carbon, [id]: [...list, copy].slice(-CARBON_LIMIT) };
}
