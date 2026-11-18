// Top-level preview surface: /preview (session list) and /preview/:sid[/:aid]
// (stack view). Route parsing lives in previewApi.ts.

import { useEffect } from "react";
import { parseFeedPath, parsePreviewPath } from "./previewApi";
import { useRoutePathname } from "./useRoutePathname";
import { SessionList } from "./SessionList";
import { StackView } from "./StackView";
import { FeedView } from "./FeedView";
import { LiveToast } from "./LiveToast";
import { setViewingSession } from "./unreadStore";
import { useTheme } from "../lib/themeStore";
import { rootPalette, usePalette } from "../lib/paletteStore";

export function PreviewApp() {
  const theme = useTheme();
  const palette = usePalette();
  const pathname = useRoutePathname();
  const feedRoute = parseFeedPath(pathname);
  const route = feedRoute ? null : parsePreviewPath(pathname);
  const viewing = (feedRoute ?? route)?.sid ?? null;
  // Record which session (if any) is open so unread counts stop accruing for
  // it. useRoutePathname re-renders on every navigation, so the StackView key
  // below changes and remounts it.
  useEffect(() => setViewingSession(viewing), [viewing]);
  const surface = feedRoute ? (
    <FeedView key={`feed:${viewing ?? ""}/${feedRoute.aid ?? ""}`} sessionId={viewing ?? undefined} artifactId={feedRoute.aid} />
  ) : viewing ? <StackView key={`${viewing}/${route!.aid ?? ""}`} sessionId={viewing} artifactId={route!.aid} /> : <SessionList />;
  return (
    <div className="aur" data-theme={theme} data-palette={rootPalette(theme, palette)}>
      {surface}
      {/* Pushes to other sessions surface as a badge/toast, never a navigation. */}
      <LiveToast viewingSessionId={viewing ?? undefined} />
    </div>
  );
}
