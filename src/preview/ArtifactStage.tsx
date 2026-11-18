// Per-type artifact renderer shared by every reading surface (StackView,
// Feed). frame="card" is the StackView look; frame="page" drops the card box
// and caption for ui artifacts only, so a briefing reads as a page.

import { MarkdownArtifact } from "./MarkdownArtifact";
import { ChartView, parseChartContract, type ChartContract } from "./ChartView";
import { MediaArtifact } from "./MediaArtifact";
import { MermaidArtifact } from "./MermaidArtifact";
import { UiArtifact } from "./UiArtifact";
import type { Artifact } from "./previewApi";

export interface ArtifactStageProps {
  artifact: Artifact;
  frame: "card" | "page";
}

/** Parse a chart contract, or null when the payload isn't a valid chart. */
function parseChartSafe(content: string): ChartContract | null {
  try {
    return parseChartContract(content);
  } catch {
    return null;
  }
}

export function ArtifactStage({ artifact: current, frame }: ArtifactStageProps) {
  switch (current.type) {
    case "markdown":
      return (
        <div className="aur-stack3__pane-md">
          <MarkdownArtifact content={current.content} />
        </div>
      );
    case "chart": {
      const chart = parseChartSafe(current.content);
      return (
        <div className="aur-stack3__pane-card">
          <div className="aur-stack3__cardbox">
            {chart ? (
              <ChartView contract={chart} />
            ) : (
              <p className="aur-preview__error">Invalid chart artifact — malformed contract JSON.</p>
            )}
          </div>
          {chart && (
            <div className="aur-stack3__caption">
              <span className="aur-stack3__captionmono">push_chart</span>
              <span className="aur-stack3__dot" />
              <span>chart_type: <span className="aur-stack3__captionmono">{chart.chart_type}</span></span>
              <span className="aur-stack3__dot" />
              <span>Aurora house theme</span>
            </div>
          )}
        </div>
      );
    }
    case "mermaid":
      return (
        <div className="aur-stack3__pane-card">
          <div className="aur-stack3__cardbox aur-stack3__cardbox--center">
            <MermaidArtifact content={current.content} />
          </div>
          <div className="aur-stack3__caption aur-stack3__captionmono">
            push_mermaid · rendered client-side, house theme
          </div>
        </div>
      );
    case "ui":
      if (frame === "page") {
        return (
          <div className="aur-stack3__pane-card">
            <UiArtifact content={current.content} artifactId={current.artifact_id} />
          </div>
        );
      }
      return (
        <div className="aur-stack3__pane-card">
          <div className="aur-stack3__cardbox aur-ui__pane">
            <UiArtifact content={current.content} artifactId={current.artifact_id} />
          </div>
          <div className="aur-stack3__caption aur-stack3__captionmono">
            push_ui · composed with the aurora component library
          </div>
        </div>
      );
    case "image":
    case "video":
    case "audio":
      return (
        <div className="aur-stack3__pane-card">
          <div className={"aur-stack3__cardbox" + (current.type === "video" ? " aur-stack3__cardbox--video" : "")}>
            <MediaArtifact artifact={current} />
          </div>
          <div className="aur-stack3__caption aur-stack3__captionmono">
            {current.type === "image" ? "push_image" : current.type === "video" ? "push_video" : "push_audio"}
          </div>
        </div>
      );
    default:
      return null;
  }
}
