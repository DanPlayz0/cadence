// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { panelBounds, clampPanelSize } from "./panelSize";
describe("playback panel sizing", () => {
  it("reserves usable library space beside and above the panel", () => {
    expect(panelBounds("side", 1045)).toEqual({ min: 300, max: 685 });
    expect(panelBounds("stack", 636)).toEqual({ min: 200, max: 476 });
  });
  it("clamps dragging and restored preferences after viewport changes", () => {
    const bounds = panelBounds("side", 900);
    expect(clampPanelSize(100, bounds)).toBe(300);
    expect(clampPanelSize(900, bounds)).toBe(540);
    expect(clampPanelSize(400, bounds)).toBe(400);
    expect(clampPanelSize(NaN, bounds)).toBe(300);
  });
  it("keeps minimum panel dimensions on constrained viewports", () => {
    expect(panelBounds("stack", 300)).toEqual({ min: 200, max: 200 });
    expect(panelBounds("side", 600)).toEqual({ min: 300, max: 300 });
  });
});
