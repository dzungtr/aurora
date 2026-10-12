// Mermaid artifact renderer: delegates to the shared MermaidView render path
// (issue #40 extraction) so the standalone artifact and the Mermaid component
// inside pushed UI dashboards render identically.

import { MermaidView } from "./MermaidView";

export function MermaidArtifact({ content }: { content: string }) {
  return <MermaidView source={content} />;
}
