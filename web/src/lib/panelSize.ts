// SPDX-License-Identifier: GPL-2.0-or-later
export type PanelMode = "side" | "stack";
export function panelBounds(mode: PanelMode, available: number) {
  const min = mode === "side" ? 300 : 200;
  const libraryMin = mode === "side" ? 360 : 160;
  return { min, max: Math.max(min, Math.floor(available - libraryMin)) };
}
export function clampPanelSize(
  size: number,
  bounds: { min: number; max: number },
) {
  return Math.min(
    bounds.max,
    Math.max(bounds.min, Number.isFinite(size) ? size : bounds.min),
  );
}
