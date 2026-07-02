import type { Buffer } from "../../App";
import { kindOf } from "../../lib/fileTypes";
import { highlight } from "../../lib/highlight";

export interface TextViewerProps {
  path: string;
  buffer?: Buffer;
  onChange: (v: string) => void;
  wrap: boolean;
}

/**
 * Code / plain-text editor: a transparent <textarea> layered over a highlighted
 * <pre>. Both share identical monospace metrics so the caret lines up with the
 * rendered tokens. A single scroll container keeps the gutter, highlight and
 * textarea in sync without manual scroll wiring.
 */
export function TextViewer({ path, buffer, onChange, wrap }: TextViewerProps) {
  const content = buffer?.content ?? "";
  const kind = kindOf(path);
  const lines = content.split("\n");
  const wrapCls = wrap ? "wrap" : "nowrap";

  return (
    <div className="aur-code">
      <div className="aur-code__inner">
        <div className="aur-gutter">
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="aur-code__col">
          <pre
            className={`aur-code__pre ${wrapCls}`}
            dangerouslySetInnerHTML={{ __html: highlight(content, kind) + "\n" }}
          />
          <textarea
            className={`aur-code__ta ${wrapCls}`}
            value={content}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
