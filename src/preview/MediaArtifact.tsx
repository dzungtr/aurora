// Media artifact renderer: images and video streamed from the artifact store
// snapshot blob. <video controls> uses HTTP range requests for seeking.

import { previewApi } from "./previewApi";
import type { Artifact } from "./previewApi";

export function blobUrl(sessionId: string, artifactId: string): string {
  return `/api/preview/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/blob`;
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
  return (
    <div className="aur-media">
      <img className="aur-media__media" src={src} alt={artifact.title} />
    </div>
  );
}
