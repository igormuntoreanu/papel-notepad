/**
 * Fonts and paragraph styles the editor offers, and the ids stored in a document.
 *
 * Ids are the only thing written to disk (`font`, `style` on a text block), so they
 * must stay stable forever: renaming a label is fine, changing an id breaks old files.
 *
 * The list is deliberately short. Six near-identical sans faces and three monos only
 * made the face menu hard to scan, so the palette is Plex Sans, one other sans (Inter)
 * and two monos (Plex Mono, Fira Code). Faces that old files still reference keep their
 * stored code below and fall back to a kept face.
 */

export const FONTS = [
  { id: "plex-sans", name: "IBM Plex Sans", css: "var(--font-paper-sans)", mono: false },
  { id: "inter", name: "Inter", css: "var(--font-inter)", mono: false },
  { id: "plex-mono", name: "IBM Plex Mono", css: "var(--font-paper-mono)", mono: true },
  { id: "fira-code", name: "Fira Code", css: "var(--font-fira-code)", mono: true },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

/** The look of one text block. Every part is optional; absent means the default. */
export type BlockLook = { font?: FontId; style?: StyleId; align?: AlignId };

export const TEXT_STYLES = [
  { id: "title", name: "Title" },
  { id: "subtitle", name: "Subtitle" },
  { id: "heading", name: "Heading" },
  { id: "subheading", name: "Subheading" },
  { id: "body", name: "Body" },
] as const;

export type StyleId = (typeof TEXT_STYLES)[number]["id"];

/** Rendered size of each paragraph style, in px. The menu previews at 0.6x of these. */
export const STYLE_SIZES: Record<StyleId, number> = {
  title: 32,
  subtitle: 26,
  heading: 22.5,
  subheading: 20,
  body: 16,
};

/** Per-line paragraph-style codes stored in the core. 0 = body (the default), so an
 *  all-zero array means "no per-line styling". Ids are stable; do not renumber.
 *  Codes 5 and 6 were Section and Subsection; they are gone from the menu, so old
 *  files that still carry them render as Body (see CODE_STYLES). */
export const STYLE_CODES: Record<StyleId, number> = {
  body: 0,
  title: 1,
  subtitle: 2,
  heading: 3,
  subheading: 4,
};
/** Reverse of STYLE_CODES: core code -> StyleId. Length and order are fixed by the
 *  stored codes; retired Section/Subsection (5, 6) map to Body instead of vanishing. */
export const CODE_STYLES: StyleId[] = [
  "body",
  "title",
  "subtitle",
  "heading",
  "subheading",
  "body",
  "body",
];

/** Per-line font codes stored in the core. 0 = inherit the block's default font, so an
 *  all-zero array means "no per-line font override". Ids are stable; do not renumber.
 *  These are the codes the original nine-face list used, kept so old files open with
 *  the same face wherever that face still exists. */
export const FONT_CODES: Record<FontId, number> = {
  "plex-sans": 1,
  "plex-mono": 2,
  inter: 3,
  "fira-code": 10,
};
/** Reverse of FONT_CODES: core code -> FontId. Index 0 is null (0 = inherit block font).
 *  Retired faces map to the closest kept face instead of dropping the styling:
 *  Roboto/Open Sans/Lato/Montserrat/Poppins -> Plex Sans, JetBrains Mono -> Plex Mono. */
export const CODE_FONTS: (FontId | null)[] = [
  null,
  "plex-sans",
  "plex-mono",
  "inter",
  "plex-sans",
  "plex-sans",
  "plex-sans",
  "plex-sans",
  "plex-sans",
  "plex-mono",
  "fira-code",
];

/** Paragraph alignment, offered while Word Wrap is on. */
export const ALIGNMENTS = [
  { id: "left", name: "Align left" },
  { id: "center", name: "Align centre" },
  { id: "right", name: "Align right" },
] as const;

export type AlignId = (typeof ALIGNMENTS)[number]["id"];

export const DEFAULT_FONT: FontId = "plex-sans";
export const DEFAULT_STYLE: StyleId = "body";

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONTS.some((font) => font.id === value);
}

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && TEXT_STYLES.some((style) => style.id === value);
}

export function isAlignId(value: unknown): value is AlignId {
  return typeof value === "string" && ALIGNMENTS.some((align) => align.id === value);
}

/** Reads a look from untrusted JSON, dropping anything unrecognised. */
export function readLook(
  raw: { font?: unknown; style?: unknown; align?: unknown } | null | undefined,
): BlockLook {
  const look: BlockLook = {};
  if (isFontId(raw?.font)) look.font = raw.font;
  if (isStyleId(raw?.style)) look.style = raw.style;
  if (isAlignId(raw?.align)) look.align = raw.align;
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
