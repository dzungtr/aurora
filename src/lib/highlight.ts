// Lightweight, dependency-free syntax highlighting + Markdown rendering.
// Highlighters emit <span class="tok-*"> spans; colours live in styles.css.
// Both outputs are HTML-escaped at the source, so they are safe for
// dangerouslySetInnerHTML. Markdown links are additionally URL-sanitised.

import type { FileKind } from "./fileTypes";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const span = (cls: string, x: string) => `<span class="${cls}">${x}</span>`;

function hlCode(src: string): string {
  const e = esc(src);
  return e.replace(
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|default|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|implements|new|await|async|yield|type|interface|enum|public|private|protected|readonly|static|typeof|instanceof|as|in|of|void|delete)\b|\b(true|false|null|undefined|this|super|NaN)\b|\b([A-Z][A-Za-z0-9_]*)\b|\b([a-zA-Z_$][\w$]*)(?=\s*\()|\b(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    (m, com, str, kw, lit, type, fn, num) => {
      if (com) return span("tok-com", com);
      if (str) return span("tok-str", str);
      if (kw) return span("tok-kw", kw);
      if (lit) return span("tok-lit", lit);
      if (type) return span("tok-type", type);
      if (fn) return span("tok-fn", fn);
      if (num) return span("tok-num", num);
      return m;
    }
  );
}

function hlJson(src: string): string {
  const e = esc(src);
  return e.replace(
    /("(?:\\.|[^"\\])*"(\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (m, str, colon, kw, num) => {
      if (str) return span(colon ? "tok-key" : "tok-str", str);
      if (kw) return span("tok-kw", kw);
      if (num) return span("tok-num", num);
      return m;
    }
  );
}

function hlCss(src: string): string {
  const e = esc(src);
  return e.replace(
    /(\/\*[\s\S]*?\*\/)|([.#][\w-]+)(\s*\{)|([\w-]+)(\s*:)|(#[0-9a-fA-F]{3,8}\b|-?\d+(?:px|em|rem|%|vh|vw|s|ms|fr)?\b)/g,
    (m, com, sel, br, prop, cl, val) => {
      if (com) return span("tok-com", com);
      if (sel) return span("tok-type", sel) + br;
      if (prop) return span("tok-key", prop) + cl;
      if (val) return span("tok-str", val);
      return m;
    }
  );
}

export function highlight(text: string, kind: FileKind): string {
  switch (kind) {
    case "json": return hlJson(text);
    case "css": return hlCss(text);
    case "code":
    case "text": return hlCode(text);
    default: return esc(text);
  }
}

/* ---------------------------------- Markdown --------------------------------- */

function sanitizeUrl(url: string): string {
  return url.replace(/[\t\n\r]/g, "").trim();
}
function isSafeUrl(url: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return /^(https?|mailto):/i.test(url);
  return true;
}
function escAttr(v: string): string {
  return v.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (match, label, url) => {
      const clean = sanitizeUrl(url);
      return isSafeUrl(clean)
        ? `<a href="${escAttr(clean)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
        : esc(label);
    });
}

export function renderMarkdown(text: string): string {
  const lines = (text ?? "").split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (!inCode) { closeList(); inCode = true; out.push('<pre class="md-pre">'); }
      else { inCode = false; out.push("</pre>"); }
      continue;
    }
    if (inCode) { out.push(esc(raw)); continue; }

    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(raw.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\s*>\s+/.test(raw)) {
      closeList();
      out.push(`<blockquote>${inline(raw.replace(/^\s*>\s+/, ""))}</blockquote>`);
      continue;
    }
    if (/^---+\s*$/.test(raw)) { closeList(); out.push("<hr />"); continue; }
    if (raw.trim() === "") { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(raw)}</p>`);
  }
  closeList();
  if (inCode) out.push("</pre>");
  return out.join("\n");
}
