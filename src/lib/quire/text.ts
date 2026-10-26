// Relative, with extension: `text.ts` is loaded by `node --test` through type
// stripping, where the `@/` alias does not resolve.
import { asBytes, desktopBridge } from "../desktop/bridge.ts";

export const SKINS = [
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
    id: "sulphite",
    name: "Sulphite",
    edge: "clean",
    pattern: "blank",
    blurb: "Bare white sheet, a hairline, nothing else.",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    edge: "clean",
    pattern: "grid",
    blurb: "Night drafting paper. Chalk on deep blue.",
  },
] as const;

export type SkinId = (typeof SKINS)[number]["id"];

export const LANGUAGES: { id: string; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "plain", label: "Plain text" },
  { id: "json", label: "JSON" },
  { id: "xml", label: "XML" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "javascript", label: "JavaScript" },
  { id: "sql", label: "SQL" },
  { id: "markdown", label: "Markdown" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "python", label: "Python" },
  { id: "abap", label: "ABAP" },
];

const EXT: Record<string, string> = {
  json: "json",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "javascript",
  tsx: "javascript",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  py: "python",
  abap: "abap",
  txt: "plain",
};

export function langFromFilename(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? null;
}

/**
 * What the Open picker offers. Derived from the same table that hints a
 * language, so the two cannot drift apart.
 */
export const OPENABLE_EXTENSIONS: string[] = [
  ".papel",
  ".quire",
  ...[...new Set(Object.keys(EXT))].map((ext) => `.${ext}`),
];

export const FILE_ACCEPT = OPENABLE_EXTENSIONS.join(",");

/** True for the note formats Papel can actually open. */
export function canOpenFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".papel") || lower.endsWith(".quire") || langFromFilename(name) !== null;
}

/**
 * Language id → the extension a saved file should carry. The reverse of `EXT`,
 * with the canonical extension chosen for each language (`.js`, not `.mjs`).
 */
const LANG_EXT: Record<string, string> = {
  json: "json",
  xml: "xml",
  html: "html",
  css: "css",
  javascript: "js",
  sql: "sql",
  markdown: "md",
  rust: "rs",
  java: "java",
  c: "c",
  cpp: "cpp",
  python: "py",
  abap: "abap",
};

export function extForLanguage(lang: string): string {
  return LANG_EXT[lang] ?? "txt";
}

export function mimeForExtension(ext: string): string {
  switch (ext) {
    case "papel":
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

export function langLabel(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? id;
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
