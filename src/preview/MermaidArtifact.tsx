// Mermaid artifact renderer: mermaid.js client-side, on the same purple-
// accented "base" theme as the rest of Aurora, re-initialized whenever the
// app theme flips. Invalid source renders an in-page error (with the source
// visible) so the agent can see its diagram failed and retry — never a
// blank pane.

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { useTheme, type Theme } from "../lib/themeStore";

const MERMAID_VARS: Record<Theme, Record<string, string>> = {
  light: {
    background: "#fafafa", primaryColor: "#efe8fb", primaryBorderColor: "#673ab6",
    primaryTextColor: "#222222", secondaryColor: "#e7f0fd", tertiaryColor: "#f7f7f7",
    mainBkg: "#efe8fb", nodeBorder: "#673ab6", nodeTextColor: "#222222",
    titleColor: "#222222", textColor: "#222222", lineColor: "#8a8a8a",
    edgeLabelBackground: "#fafafa", tertiaryTextColor: "#333333",
    clusterBkg: "#f7f7f7", clusterBorder: "#d9d9d9",
  },
  dark: {
    background: "#1e1e1e", primaryColor: "#2b2141", primaryBorderColor: "#7e57c2",
    primaryTextColor: "#e8e8e8", secondaryColor: "#1f2b3d", tertiaryColor: "#242424",
    mainBkg: "#2b2141", nodeBorder: "#7e57c2", nodeTextColor: "#e8e8e8",
    titleColor: "#e8e8e8", textColor: "#e8e8e8", lineColor: "#8a8a8a",
    edgeLabelBackground: "#1e1e1e", tertiaryTextColor: "#b0b0b0",
    clusterBkg: "#242424", clusterBorder: "#3a3a3a",
  },
};

let initializedTheme: Theme | null = null;

function ensureInitialized(theme: Theme): void {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    themeVariables: MERMAID_VARS[theme],
  });
  initializedTheme = theme;
}

let renderSeq = 0;

function extractMessage(err: unknown): string {
  const anyErr = err as { message?: string; str?: string };
  return anyErr?.message ?? anyErr?.str ?? String(err);
}

export function MermaidArtifact({ content }: { content: string }) {
  const theme = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    ensureInitialized(theme);
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
  }, [content, theme]);

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
