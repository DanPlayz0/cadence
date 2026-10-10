// SPDX-License-Identifier: GPL-2.0-or-later
export type Route = {
  view: string;
  albumId?: string;
  artist?: string;
  adminTab?: string;
  query?: string;
};
export const adminTabs = [
  "dashboard",
  "branding",
  "devices",
  "library",
  "people",
  "permissions",
  "metadata",
  "suggestions",
  "activity",
  "scans",
];
const pages = ["home", "songs", "albums", "artists", "likes", "history"];

export function routeURL(route: Route): string {
  let path = "/";
  if (route.view === "album" && route.albumId)
    path = `/albums/${encodeURIComponent(route.albumId)}`;
  else if (route.view === "artist" && route.artist)
    path = `/artists/${encodeURIComponent(route.artist)}`;
  else if (route.view.startsWith("playlist:") && route.view.slice(9))
    path = `/playlists/${encodeURIComponent(route.view.slice(9))}`;
  else if (route.view === "admin")
    path = `/admin/${adminTabs.includes(route.adminTab || "") ? route.adminTab : "dashboard"}`;
  else if (pages.includes(route.view) && route.view !== "home")
    path = `/${route.view}`;
  const params = new URLSearchParams();
  if (route.query) params.set("q", route.query);
  return path + (params.size ? `?${params}` : "");
}

export function parseRoute(url: URL): Route {
  let parts: string[];
  try {
    parts = url.pathname
      .replace(/\/$/, "")
      .split("/")
      .slice(1)
      .map(decodeURIComponent);
  } catch {
    return { view: "home" };
  }
  const [page, detail] = parts;
  let route: Route = { view: "home" };
  if (parts.length === 1 && pages.includes(page)) route = { view: page };
  else if (parts.length === 2 && detail) {
    if (page === "albums") route = { view: "album", albumId: detail };
    else if (page === "artists") route = { view: "artist", artist: detail };
    else if (page === "playlists") route = { view: `playlist:${detail}` };
    else if (page === "admin" && adminTabs.includes(detail))
      route = { view: "admin", adminTab: detail };
  } else if (page === "admin" && parts.length === 1)
    route = { view: "admin", adminTab: "dashboard" };
  if (url.searchParams.get("q")) route.query = url.searchParams.get("q")!;
  return route;
}
