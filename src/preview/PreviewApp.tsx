// Top-level preview surface: /preview (session list) and /preview/:sid[/:aid]
// (stack view). Route parsing lives in previewApi.ts.

import { parsePreviewPath } from "./previewApi";
import { SessionList } from "./SessionList";
import { StackView } from "./StackView";

export function PreviewApp() {
  const route = parsePreviewPath(window.location.pathname);
  if (!route) return <SessionList />;
  if (!route.sid) return <SessionList />;
  return <StackView key={`${route.sid}/${route.aid ?? ""}`} sessionId={route.sid} artifactId={route.aid} />;
}
