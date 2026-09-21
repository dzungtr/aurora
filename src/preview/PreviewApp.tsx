// Top-level preview surface: /preview (session list) and /preview/:sid[/:aid]
// (stack view). Route parsing lives in previewApi.ts.

import { useEffect } from "react";
import { parsePreviewPath } from "./previewApi";
import { SessionList } from "./SessionList";
import { StackView } from "./StackView";
import { LiveToast } from "./LiveToast";
import { setViewingSession } from "./unreadStore";

export function PreviewApp() {
  const route = parsePreviewPath(window.location.pathname);
  const viewing = route?.sid ?? null;
  // Record which session (if any) is open so unread counts stop accruing for
  // it; PreviewApp is re-keyed on every navigate, so this runs per mount.
  useEffect(() => setViewingSession(viewing), [viewing]);
  const surface = viewing ? <StackView key={`${viewing}/${route!.aid ?? ""}`} sessionId={viewing} artifactId={route!.aid} /> : <SessionList />;
  return (
    <>
      {surface}
      {/* Pushes to other sessions surface as a badge/toast, never a navigation. */}
      <LiveToast viewingSessionId={viewing ?? undefined} />
    </>
  );
}
