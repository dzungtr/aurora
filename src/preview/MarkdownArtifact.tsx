// Markdown artifact renderer: react-markdown + remark-gfm per the spec, with
// the house token highlighter reused for fenced code blocks (tok-* spans in
// styles.css). Links are rendered inert (new tab, noopener) via react-markdown.

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight } from "../lib/highlight";

/** Map a fenced-code language tag to the house highlighter kinds. */
function kindForLang(lang?: string): "code" | "json" | "css" | "text" {
  switch ((lang ?? "").toLowerCase()) {
    case "json": return "json";
    case "css": return "css";
    case "text":
    case "":
    case undefined: return "text";
    default: return "code";
  }
}

const CodeBlock = memo(function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const lang = /language-(\S+)/.exec(className ?? "")?.[1];
  const text = String(children ?? "").replace(/\n$/, "");
  return <pre className="md-pre"><code dangerouslySetInnerHTML={{ __html: highlight(text, kindForLang(lang)) }} /></pre>;
});

export function MarkdownArtifact({ content }: { content: string }) {
  return (
    <div className="aur-prose aur-artifact-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: (props) => {
            const { className } = props as { className?: string; children?: React.ReactNode };
            if (className?.includes("language-")) return <CodeBlock className={className}>{(props as any).children}</CodeBlock>;
            return <code className="md-code">{(props as any).children}</code>;
          },
          a: (props) => <a {...(props as any)} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
