// Media artifact renderer: images, video, and audio streamed from the
// artifact store snapshot blob. <video>/<audio controls> use HTTP range
// requests for seeking.

import { previewApi } from "./previewApi";
import type { Artifact } from "./previewApi";

export function blobUrl(sessionId: string, artifactId: string): string {
  return `/api/s/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/blob`;
}

export function MediaArtifact({ artifact }: { artifact: Artifact }) {
  const src = blobUrl(artifact.session_id, artifact.artifact_id);
  if (artifact.type === "video") {
    return (
      <div className="aur-media">
        <video className="aur-media__media" src={src} controls preload="metadata" />
      </div>
    );
  }
  if (artifact.type === "audio") {
    return (
      <div className="aur-media aur-media--audio">
        <audio className="aur-media__audio" src={src} controls preload="metadata" />
        {artifact.transcript ? (
          <details className="aur-media__transcript">
            <summary>Transcript</summary>
            <pre>{artifact.transcript}</pre>
          </details>
        ) : null}
      </div>
    );
  }
  return (
    <div className="aur-media">
      <img className="aur-media__media" src={src} alt={artifact.title} />
    </div>
  );
}
