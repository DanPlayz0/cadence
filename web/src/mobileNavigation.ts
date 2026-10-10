// SPDX-License-Identifier: GPL-2.0-or-later
import { type Route } from "./navigation";

export type MobileTab = "home" | "search" | "library";
export function routeTab(route: Route, origin?: MobileTab): MobileTab {
  if (origin !== "home" && origin !== "search" && origin !== "library")
    origin = undefined;
  if (route.view === "home") return "home";
  if (
    route.view === "search" ||
    route.view === "find" ||
    (route.view === "songs" && route.query)
  )
    return "search";
  if (
    route.view === "album" ||
    route.view === "artist" ||
    route.view === "admin" ||
    route.view.startsWith("playlist:")
  )
    return origin || "library";
  return "library";
}
export function tabRoute(
  tab: MobileTab,
  remembered: Route | undefined,
  libraryId: string | undefined,
  playlists: string[],
  libraries: string[],
  allowFind: boolean,
): Route {
  let next = { ...(remembered || { view: tab }), libraryId };
  if (
    next.view.startsWith("playlist:") &&
    !playlists.includes(next.view.slice(9))
  )
    next = { view: "library", libraryId };
  if (next.view === "find" && !allowFind)
    next = { view: "search", query: next.query, libraryId };
  if (next.libraryId && !libraries.includes(next.libraryId))
    next = { ...next, libraryId: undefined };
  return next;
}
