export interface MarkdownPreviewProps {
  content: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeUrl(url: string): string {
  return url.replace(/[\t\n\r]/g, "").trim();
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function isSafeUrl(cleanedUrl: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleanedUrl)) {
    return /^(https?|mailto):/i.test(cleanedUrl);
  }
  return true;
}

function inline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (match, label, url) => {
      const cleaned = sanitizeUrl(url);
      return isSafeUrl(cleaned) ? `<a href="${escapeAttr(cleaned)}">${label}</a>` : label;
    });
}

function renderMarkdown(text: string): string {
  const lines = escapeHtml(text).split("\n");
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (heading) {
      if (inList) { html.push("</ul>"); inList = false; }
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (listItem) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inline(listItem[1])}</li>`);
    } else if (line.trim() === "") {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push("");
    } else {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("\n");
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return <div className="wsp-markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
}
