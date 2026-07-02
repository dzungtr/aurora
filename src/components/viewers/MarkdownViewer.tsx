import type { Buffer } from "../../App";
import { renderMarkdown } from "../../lib/highlight";

export interface MarkdownViewerProps {
  buffer?: Buffer;
  onChange: (v: string) => void;
  mode: "edit" | "split" | "preview";
}

/** Markdown editor with edit / split / preview modes. */
export function MarkdownViewer({ buffer, onChange, mode }: MarkdownViewerProps) {
  const content = buffer?.content ?? "";
  const showEdit = mode !== "preview";
  const showPreview = mode !== "edit";

  return (
    <div className="aur-md">
      {showEdit && (
        <div className="aur-md__src">
          <textarea value={content} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        </div>
      )}
      {showPreview && (
        <div className="aur-md__prev">
          <div className="aur-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        </div>
      )}
    </div>
  );
}
