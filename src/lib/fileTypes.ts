// Central file-type helpers: kind detection, icons, colours, labels, formatters.
// Icon names are Unicons (uil:) rendered through @iconify/react.

export type FileKind =
  | "code" | "json" | "css" | "markdown"
  | "image" | "video" | "audio" | "pdf" | "text";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"]);
const VIDEO = new Set(["mp4", "mov", "webm", "mkv", "m4v", "ogv"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
const CODE  = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);

export function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}

export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function kindOf(path: string): FileKind {
  const e = extOf(path);
  if (IMAGE.has(e)) return "image";
  if (VIDEO.has(e)) return "video";
  if (AUDIO.has(e)) return "audio";
  if (e === "pdf") return "pdf";
  if (e === "md" || e === "markdown") return "markdown";
  if (e === "json") return "json";
  if (e === "css") return "css";
  if (CODE.has(e)) return "code";
  return "text";
}

export const isTextKind = (k: FileKind): boolean =>
  k === "code" || k === "json" || k === "css" || k === "text";

/** Text kinds plus markdown — anything that loads into an editable text buffer. */
export const isEditable = (k: FileKind): boolean => isTextKind(k) || k === "markdown";

const KIND_COLOR: Record<FileKind, string> = {
  code: "#4d9fff", json: "#ffca28", css: "#c792ea", markdown: "#26c6da",
  image: "#ec6191", video: "#ff7043", audio: "#66bb6a", pdf: "#ef5350", text: "#9aa3b0",
};
export const FOLDER_COLOR = "#c7a15a";

export function colorFor(path: string, isDir: boolean): string {
  return isDir ? FOLDER_COLOR : KIND_COLOR[kindOf(path)];
}

const KIND_ICON: Record<FileKind, string> = {
  code: "uil:brackets-curly", json: "uil:brackets-curly", css: "uil:palette",
  markdown: "uil:notes", image: "uil:image", video: "uil:video",
  audio: "uil:music", pdf: "uil:file-alt", text: "uil:file-alt",
};

export function iconFor(path: string, isDir: boolean, expanded = false): string {
  if (isDir) return expanded ? "uil:folder-open" : "uil:folder";
  return KIND_ICON[kindOf(path)];
}

export function badgeFor(path: string): string {
  const k = kindOf(path);
  if (k === "markdown") return "MD";
  if (k === "text") return "TXT";
  return extOf(path).toUpperCase();
}

const KIND_LABEL: Record<FileKind, string> = {
  code: "Source code", json: "JSON", css: "Stylesheet", markdown: "Markdown",
  image: "Image", video: "Video", audio: "Audio", pdf: "PDF document", text: "Text file",
};
export const kindLabel = (k: FileKind): string => KIND_LABEL[k];

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

export function formatBytes(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return bytes + " B";
  const u = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 ? 1 : 0) + " " + u[i];
}

export function formatDate(ms?: number): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
