// Top-level preview surface: /preview (session list) and /preview/:sid[/:aid]
// (stack view). Route parsing lives in previewApi.ts.

import { parsePreviewPath } from "./previewApi";
import { SessionList } from "./SessionList";
import { StackView } from "./StackView";
import { LiveToast } from "./LiveToast";

export function PreviewApp() {
  const route = parsePreviewPath(window.location.pathname);
  const viewing = route?.sid ?? null;
  const surface = viewing ? <StackView key={`${viewing}/${route!.aid ?? ""}`} sessionId={viewing} artifactId={route!.aid} /> : <SessionList />;
  return (
    <>
      {surface}
      {/* Pushes to other sessions surface as a badge/toast, never a navigation. */}
      <LiveToast viewingSessionId={viewing ?? undefined} />
    </>
  );
}
