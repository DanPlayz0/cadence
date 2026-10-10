// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  broaderOverlaps,
  catalogLibrary,
  containsFolder,
  MusicLibrary,
} from "./libraries";
import { parseRoute, routeURL } from "./navigation";

const privateLibrary: MusicLibrary = {
  id: "family",
  name: "Family",
  folders: ["/music/Family"],
  everyone: false,
  users: ["alice"],
  groups: ["family"],
};

describe("library sharing and selection", () => {
  it("warns about broad overlapping grants without matching sibling prefixes", () => {
    const shared: MusicLibrary = {
      ...privateLibrary,
      id: "legacy",
      name: "Existing music",
      folders: ["/music"],
      everyone: true,
    };
    expect(broaderOverlaps(privateLibrary, [privateLibrary, shared])).toEqual([
      shared,
    ]);
    expect(
      broaderOverlaps(privateLibrary, [
        { ...shared, folders: ["/music/FamilyOther"] },
      ]),
    ).toEqual([]);
    expect(containsFolder("/", "/music/song")).toBe(true);
    expect(
      broaderOverlaps(privateLibrary, [
        { ...privateLibrary, id: "same-access" },
      ]),
    ).toEqual([]);
    expect(
      broaderOverlaps(privateLibrary, [
        { ...privateLibrary, id: "other", users: ["bob"] },
      ]),
    ).toHaveLength(1);
  });
  it("preserves library selection in shareable URLs and browser history routes", () => {
    for (const view of [
      "home",
      "songs",
      "albums",
      "artists",
      "artist",
      "album",
    ]) {
      const route = {
        view,
        artist: view === "artist" ? "AC/DC" : undefined,
        albumId: view === "album" ? "album" : undefined,
        libraryId: "family / 音楽",
        query: "song",
      };
      const parsed = parseRoute(
        new URL(routeURL(route), "https://music.example"),
      );
      expect(parsed.libraryId).toBe(route.libraryId);
      expect(parsed.query).toBe("song");
      expect(parsed.view).toBe(view);
    }
  });
  it("scopes catalog views while leaving personal collections account-wide", () => {
    for (const view of [
      "home",
      "songs",
      "albums",
      "artists",
      "artist",
      "album",
    ])
      expect(catalogLibrary(view, "family")).toBe("family");
    for (const view of ["likes", "history", "playlist:mix", "admin"])
      expect(catalogLibrary(view, "family")).toBe("");
    expect(catalogLibrary("songs")).toBe("");
  });
});
