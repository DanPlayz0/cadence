// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { routeTab, tabRoute } from "./mobileNavigation";
import { parseRoute, routeURL } from "./navigation";

describe("mobile navigation", () => {
  it("round trips tab roots, query and library selection", () => {
    for (const view of ["search", "library"]) {
      const route = { view, query: "rock & 音楽", libraryId: "shared/music" };
      expect(
        parseRoute(new URL(routeURL(route), "https://music.example")),
      ).toEqual(route);
    }
  });
  it("assigns roots and legacy search URLs to the correct tab", () => {
    expect(routeTab({ view: "home" })).toBe("home");
    expect(routeTab({ view: "songs", query: "hello" })).toBe("search");
    expect(routeTab({ view: "songs" })).toBe("library");
    expect(routeTab({ view: "find" })).toBe("search");
  });
  it("inherits detail ownership and defaults direct links to Library", () => {
    for (const view of ["album", "artist", "playlist:p"]) {
      expect(routeTab({ view }, "home")).toBe("home");
      expect(routeTab({ view }, "search")).toBe("search");
      expect(routeTab({ view })).toBe("library");
    }
  });
  it("restores a remembered route with the current library", () => {
    expect(
      tabRoute(
        "search",
        { view: "search", query: "saved", libraryId: "old" },
        "new",
        [],
        ["new"],
        false,
      ),
    ).toEqual({ view: "search", query: "saved", libraryId: "new" });
  });
  it("recovers deleted playlists, revoked libraries, and disabled Find music", () => {
    expect(
      tabRoute("library", { view: "playlist:gone" }, "revoked", [], [], true),
    ).toEqual({ view: "library", libraryId: undefined });
    expect(
      tabRoute(
        "search",
        { view: "find", query: "saved" },
        undefined,
        [],
        [],
        false,
      ),
    ).toEqual({ view: "search", query: "saved", libraryId: undefined });
  });
});
