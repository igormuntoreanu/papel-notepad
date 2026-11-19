/**
 * Coloured tabs and pins for board cards.
 *
 * Ids are stored on the note, so they must stay stable. Colors are plain hex so a tab
 * reads the same on every skin; they are deliberately mid-tone (not neon) so they sit
 * on both light and dark paper.
 */

export const TABS = [
  { id: "red", name: "Wax red", color: "#9c3b2e" },
  { id: "amber", name: "Amber", color: "#c98a1e" },
  { id: "blue", name: "Blue", color: "#1e4f8c" },
  { id: "green", name: "Green", color: "#2f5a2c" },
  { id: "violet", name: "Violet", color: "#6b4a8c" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && TABS.some((tab) => tab.id === value);
}

export function tabColor(id: TabId | undefined): string | undefined {
  return TABS.find((tab) => tab.id === id)?.color;
}

export function tabName(id: TabId | undefined): string | undefined {
  return TABS.find((tab) => tab.id === id)?.name;
}
