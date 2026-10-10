// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { parseRoute, routeURL, type Route } from "./navigation";

describe("page URLs", () => {
  it("preserves detail identifiers and search text without confusing path separators", () => {
    const routes: Route[] = [
      { view: "album", albumId: "album/with spaces?#" },
      { view: "artist", artist: "AC/DC & 音楽" },
      { view: "playlist:mix/one" },
      { view: "songs", query: "rock & roll + 音楽" },
      { view: "admin", adminTab: "people" },
    ];
    for (const route of routes)
      expect(
        parseRoute(new URL(routeURL(route), "https://music.example")),
      ).toEqual(route);
  });
  it("supports administration sections and existing links", () => {
    for (const adminTab of [
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
    ]) {
      const route = { view: "admin", adminTab };
      expect(
        parseRoute(new URL(routeURL(route), "https://music.example")),
      ).toEqual(route);
    }
    expect(routeURL({ view: "admin" })).toBe("/admin/dashboard");
  });
  it("recovers malformed and unknown routes and normalizes trailing slashes", () => {
    const parse = (path: string) =>
      parseRoute(new URL(path, "https://music.example"));
    expect(parse("/artists/%E0%A4%A")).toEqual({ view: "home" });
    expect(parse("/admin/unknown")).toEqual({ view: "home" });
    expect(parse("/albums/id/extra")).toEqual({ view: "home" });
    expect(parse("/admin")).toEqual({ view: "admin", adminTab: "dashboard" });
    expect(parse("/likes/")).toEqual({ view: "likes" });
  });
});
