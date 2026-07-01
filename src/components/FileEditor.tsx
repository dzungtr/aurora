import { useEffect, useRef } from "react";

export interface FileEditorProps {
  path: string;
  content: string;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightJson(text: string): string {
  return escapeHtml(text).replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "num";
      if (/^"/.test(match)) cls = /:$/.test(match) ? "key" : "str";
      else if (/true|false/.test(match)) cls = "bool";
      else if (/null/.test(match)) cls = "null";
      return `<span class="tok-${cls}">${match}</span>`;
    }
  );
}

function highlightMarkup(text: string): string {
  return escapeHtml(text).replace(
    /(&lt;\/?[a-zA-Z][a-zA-Z0-9-]*)([^&]*?)(\/?&gt;)/g,
    (_m, open, attrs, close) => `<span class="tok-tag">${open}</span><span class="tok-attr">${attrs}</span><span class="tok-tag">${close}</span>`
  );
}

function highlightCss(text: string): string {
  return escapeHtml(text)
    .replace(/([.#]?[a-zA-Z0-9_-]+)(\s*\{)/g, '<span class="tok-selector">$1</span>$2')
    .replace(/([a-zA-Z-]+)(\s*:)/g, '<span class="tok-key">$1</span>$2');
}

function highlightMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/^(#{1,6}\s.*)$/gm, '<span class="tok-heading">$1</span>')
    .replace(/(\*\*[^*]+\*\*)/g, '<span class="tok-bold">$1</span>')
    .replace(/(`[^`]+`)/g, '<span class="tok-code">$1</span>');
}

function highlightGeneric(text: string): string {
  return escapeHtml(text).replace(
    /\b(function|return|const|let|var|if|else|for|while|import|export|from|class|new|await|async)\b/g,
    '<span class="tok-keyword">$1</span>'
  );
}

function highlight(text: string, ext: string): string {
  switch (ext) {
    case "json": return highlightJson(text);
    case "html": case "xml": return highlightMarkup(text);
    case "css": return highlightCss(text);
    case "md": case "markdown": return highlightMarkdown(text);
    default: return highlightGeneric(text);
  }
}

export function FileEditor({ path, content, dirty, onChange, onSave }: FileEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const ext = extOf(path);
  const lines = content.split("\n");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSave]);

  const syncScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="wsp-editor">
      <div className="wsp-editor-toolbar">
        <span className={`wsp-dirty-dot ${dirty ? "dirty" : ""}`} />
        <span className="wsp-editor-path">{path}</span>
        <button className="wsp-save-btn" onClick={onSave} disabled={!dirty}>Save</button>
      </div>
      <div className="wsp-editor-pane">
        <div className="wsp-line-numbers">
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="wsp-editor-code">
          <pre ref={preRef} className="wsp-editor-highlight" dangerouslySetInnerHTML={{ __html: highlight(content, ext) + "\n" }} />
          <textarea
            ref={textareaRef}
            className="wsp-editor-textarea"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
