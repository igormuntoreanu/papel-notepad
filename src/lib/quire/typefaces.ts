/**
 * Fonts and paragraph styles the editor offers, and the ids stored in a document.
 *
 * Ids are the only thing written to disk (`font`, `style` on a text block), so they
 * must stay stable forever: renaming a label is fine, changing an id breaks old files.
 */

export const FONTS = [
  { id: "plex-sans", name: "IBM Plex Sans", css: "var(--font-paper-sans)", mono: false },
  { id: "plex-mono", name: "IBM Plex Mono", css: "var(--font-paper-mono)", mono: true },
  { id: "inter", name: "Inter", css: "var(--font-inter)", mono: false },
  { id: "roboto", name: "Roboto", css: "var(--font-roboto)", mono: false },
  { id: "open-sans", name: "Open Sans", css: "var(--font-open-sans)", mono: false },
  { id: "lato", name: "Lato", css: "var(--font-lato)", mono: false },
  { id: "montserrat", name: "Montserrat", css: "var(--font-montserrat)", mono: false },
  { id: "poppins", name: "Poppins", css: "var(--font-poppins)", mono: false },
  { id: "jetbrains-mono", name: "JetBrains Mono", css: "var(--font-jetbrains-mono)", mono: true },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

/** The look of one text block. Both parts are optional; absent means the default. */
export type BlockLook = { font?: FontId; style?: StyleId };

export const TEXT_STYLES = [
  { id: "title", name: "Title" },
  { id: "subtitle", name: "Subtitle" },
  { id: "heading", name: "Heading" },
  { id: "subheading", name: "Subheading" },
  { id: "section", name: "Section" },
  { id: "subsection", name: "Subsection" },
  { id: "body", name: "Body" },
] as const;

export type StyleId = (typeof TEXT_STYLES)[number]["id"];

export const DEFAULT_FONT: FontId = "plex-sans";
export const DEFAULT_STYLE: StyleId = "body";

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONTS.some((font) => font.id === value);
}

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && TEXT_STYLES.some((style) => style.id === value);
}

/** Reads a look from untrusted JSON, dropping anything unrecognised. */
export function readLook(raw: { font?: unknown; style?: unknown } | null | undefined): BlockLook {
  const look: BlockLook = {};
  if (isFontId(raw?.font)) look.font = raw.font;
  if (isStyleId(raw?.style)) look.style = raw.style;
  return look;
}

export function fontName(id: FontId | undefined): string {
  return FONTS.find((font) => font.id === (id ?? DEFAULT_FONT))?.name ?? "IBM Plex Sans";
}

export function styleName(id: StyleId | undefined): string {
  return TEXT_STYLES.find((style) => style.id === (id ?? DEFAULT_STYLE))?.name ?? "Body";
}

export function isMonoFont(id: FontId | undefined): boolean {
  return FONTS.find((font) => font.id === (id ?? DEFAULT_FONT))?.mono ?? false;
}
