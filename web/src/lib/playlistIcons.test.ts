// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  filterPlaylistIcons,
  playlistIconLabel,
  playlistIconNames,
  playlistIconPage,
  resolvePlaylistIcon,
} from "./playlistIcons";

describe("playlist icon catalog", () => {
  it("exposes the full sorted collection", () => {
    expect(playlistIconNames).toHaveLength(1544);
    expect(new Set(playlistIconNames).size).toBe(1544);
    expect(playlistIconNames).toEqual([...playlistIconNames].sort());
    expect(playlistIconNames).toContain("tree-pine");
  });
  it("preserves legacy artwork and rejects unknown property names", () => {
    expect(resolvePlaylistIcon("music")).toBe("music-2");
    expect(resolvePlaylistIcon("disc")).toBe("disc-3");
    expect(resolvePlaylistIcon("moon")).toBe("moon");
    expect(resolvePlaylistIcon("tree-pine")).toBe("tree-pine");
    for (const name of [undefined, "unknown", "constructor", "__proto__"]) {
      expect(resolvePlaylistIcon(name)).toBe("music-2");
    }
  });
  it("searches names regardless of capitalization and separators", () => {
    expect(filterPlaylistIcons(" TREE-PINE ")).toEqual(
      filterPlaylistIcons("tree pine"),
    );
    expect(filterPlaylistIcons("tree pine")).toContain("tree-pine");
    expect(filterPlaylistIcons("nonexistenticon")).toEqual([]);
    expect(filterPlaylistIcons("")).toEqual(playlistIconNames);
    expect(playlistIconLabel("tree-pine")).toBe("Tree Pine");
  });
  it("paginates without skipping or repeating icons", () => {
    const all = Array.from(
      { length: Math.ceil(playlistIconNames.length / 60) },
      (_, page) => playlistIconPage(playlistIconNames, page),
    );
    expect(all[0]).toHaveLength(60);
    expect(all.at(-1)).toHaveLength(44);
    expect(all.flat()).toEqual(playlistIconNames);
    expect(playlistIconPage([], 0)).toEqual([]);
  });
});
