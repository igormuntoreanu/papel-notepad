import type { StoredVersion } from "./persist";

/** How many versions of one sheet are kept. */
export const VERSION_LIMIT = 20;

/**
 * Appends a saved version, skipping an identical last version, and caps the history.
 * Returns the same object when nothing changed so callers can avoid a state update.
 */
export function pushVersion(
  history: Record<string, StoredVersion[]>,
  id: string,
  copy: StoredVersion,
): Record<string, StoredVersion[]> {
  const list = history[id] ?? [];
  const last = list[list.length - 1];
  if (last && last.papel === copy.papel) return history;
  return { ...history, [id]: [...list, copy].slice(-VERSION_LIMIT) };
}
