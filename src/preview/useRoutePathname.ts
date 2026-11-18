// Current URL pathname as React state. Re-renders on in-app navigate() and
// popstate so route-derived keys (see PreviewApp) change on every navigation.

import { useSyncExternalStore } from "react";
import { onRouteChange } from "./previewApi";

export const getRoutePathname = (): string => window.location.pathname;
export const subscribeRoutePathname = onRouteChange;

export function useRoutePathname(): string {
  return useSyncExternalStore(subscribeRoutePathname, getRoutePathname);
}
