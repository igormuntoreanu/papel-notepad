// Relative, with extension: `text.ts` is loaded by `node --test` through type
// stripping, where the `@/` alias does not resolve.
import { asBytes, desktopBridge } from "../desktop/bridge.ts";

export const SKINS = [
  {
    id: "sulphite",
    name: "Sulphite",
    edge: "clean",
    pattern: "blank",
    blurb: "Bare white sheet, a hairline, nothing else.",
  },
  {
    id: "ink",
    name: "Ink",
    edge: "clean",
    pattern: "blank",
    blurb: "Cream desk and sheet. Nothing but the words.",
  },
  {
    id: "paper",
    name: "Paper",
    edge: "torn",
    pattern: "ruled",
    blurb: "Torn notebook. Rules under the type.",
  },
  {
    id: "carbon",
    name: "Carbon",
    edge: "perf",
    pattern: "grid",
    blurb: "Drafting card, grid, perforated edge.",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    edge: "clean",
    pattern: "grid",
    blurb: "Night drafting paper. Chalk on deep blue.",
  },
  {
    id: "terminal",
    name: "Terminal",
    edge: "clean",
    pattern: "blank",
    blurb: "Phosphor green on charcoal. A CRT for your words.",
  },
  {
    id: "legal-pad",
    name: "Legal Pad",
    edge: "clean",
    pattern: "ruled",
    blurb: "Yellow ruled pad on an olive blotter. Wax-red accents.",
  },
  {
    id: "manila",
    name: "Manila",
    edge: "clean",
    pattern: "blank",
    blurb: "Buff folder paper on a tan desk. Saddle-brown accents.",
  },
  {
    id: "newsprint",
    name: "Newsprint",
    edge: "torn",
    pattern: "blank",
    blurb: "Grey newsprint, near-black ink, deep red accents.",
  },
  {
    id: "washi",
    name: "Washi",
    edge: "torn",
    pattern: "blank",
    blurb: "Warm fibre paper, soft deckle edge, vermilion accents.",
  },
  {
    id: "index-card",
    name: "Index Card",
    edge: "clean",
    pattern: "ruled",
    blurb: "Crisp white card on cork. Blue rules and accents.",
  },
  {
    id: "chalkboard",
    name: "Chalkboard",
    edge: "clean",
    pattern: "blank",
    blurb: "Chalk on slate in an oak frame. Yellow chalk accents.",
  },
] as const;

export type SkinId = (typeof SKINS)[number]["id"];

/**
 * Extensions Papel will open as plain text. There is no language picker: every sheet
 * is plain text, so a `.js` or `.md` file simply opens as words. `.papel`/`.quire`
 * are the note formats and keep their rich blocks.
 */
export const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "json",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "sql",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "hh",
  "py",
  "abap",
] as const;

/**
 * What the Open picker offers.
 */
export const OPENABLE_EXTENSIONS: string[] = [
  ".papel",
  ".quire",
  ...TEXT_EXTENSIONS.map((ext) => `.${ext}`),
];

export const FILE_ACCEPT = OPENABLE_EXTENSIONS.join(",");

/** File encodings a sheet can be saved as. Ids match the core's `set_encoding`. */
export const ENCODINGS = [
  ["utf-8", "UTF-8"],
  ["utf-8-bom", "UTF-8 BOM"],
  ["utf-16le", "UTF-16 LE"],
  ["windows-1252", "Windows-1252"],
] as const;

/** True for the note formats Papel can actually open. */
export function canOpenFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".papel") || lower.endsWith(".quire")) return true;
  const ext = lower.split(".").pop() ?? "";
  return (TEXT_EXTENSIONS as readonly string[]).includes(ext);
}

export function mimeForExtension(ext: string): string {
  switch (ext) {
    case "papel":
      return "application/json";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
      return "text/javascript";
    case "sql":
      return "application/sql";
    case "md":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

export function diffText(prev: string, next: string): { start: number; end: number; inserted: string } {
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let tail = 0;
  while (
    tail < prev.length - start &&
    tail < next.length - start &&
    prev.charCodeAt(prev.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)
  ) {
    tail += 1;
  }
  return { start, end: prev.length - tail, inserted: next.slice(start, next.length - tail) };
}

export function download(name: string, data: Uint8Array | string, mime: string) {
  // A portable build asks where to save. Falling back to the download manager
  // there would drop every sheet into Downloads instead of the user's folder.
  const bridge = desktopBridge();
  if (bridge) {
    void bridge.saveFile(name, asBytes(data), mime).catch(() => {
      /* the shell surfaces its own errors */
    });
    return;
  }
  const blob =
    typeof data === "string" ? new Blob([data], { type: mime }) : new Blob([data.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(raw);
}

export function base64ToBytes(data: string): Uint8Array {
  const raw = atob(data);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type DateStampStyle = "local" | "eu" | "iso";

/** Insertable date/time stamp. `eu` is day/month/year (European). */
export function fileStamp(style: DateStampStyle = "local"): string {
  const d = new Date();
  if (style === "eu") {
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (style === "iso") {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

export function safeName(title: string, ext: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled";
  if (base.toLowerCase().endsWith(`.${ext}`)) return base;
  const stripped = base.replace(/\.(txt|papel|quire|json|md|js|ts|java|c|cpp|h|hpp|py|rs|abap|xml|html|css|sql)$/i, "");
  return `${stripped}.${ext}`;
}
