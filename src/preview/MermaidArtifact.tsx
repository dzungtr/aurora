// Mermaid artifact renderer: mermaid.js client-side, dark theme matching the
// app. Invalid source renders an in-page error (with the source visible) so
// the agent can see its diagram failed and retry — never a blank pane.

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
});

let renderSeq = 0;

function extractMessage(err: unknown): string {
  const anyErr = err as { message?: string; str?: string };
  return anyErr?.message ?? anyErr?.str ?? String(err);
}

export function MermaidArtifact({ content }: { content: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Render into a detached holder so a failed parse never flashes
        // partial output into the visible pane.
        const holder = holderRef.current;
        const { svg: rendered } = await mermaid.render(
          `aur-mermaid-${++renderSeq}`,
          content,
          holder ?? undefined
        );
        if (alive) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (alive) {
          setSvg(null);
          setError(extractMessage(err));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [content]);

  if (error) {
    return (
      <div className="aur-mermaid aur-mermaid--error">
        <p className="aur-mermaid__error-title">Mermaid render failed</p>
        <pre className="aur-mermaid__error-detail">{error}</pre>
        <p className="aur-mermaid__error-source-label">Diagram source</p>
        <pre className="aur-mermaid__error-source">{content}</pre>
      </div>
    );
  }

  return (
    <div className="aur-mermaid">
      <div ref={holderRef} className="aur-mermaid__holder" aria-hidden="true" />
      {svg === null ? (
        <p className="aur-mermaid__loading">Rendering diagram…</p>
      ) : (
        <div
          className="aur-mermaid__svg"
          // Mermaid output is generated locally from the pushed source under
          // securityLevel: "strict" (no user HTML, no event handlers).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
