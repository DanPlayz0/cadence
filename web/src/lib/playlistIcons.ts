// SPDX-License-Identifier: GPL-2.0-or-later
import imports from "lucide-react/dynamicIconImports.js";

export const quickPlaylistIcons = [
  "music",
  "heart",
  "headphones",
  "disc",
  "sparkles",
  "moon",
];
export const playlistIconNames = Object.keys(imports).sort();
export const playlistIconPageSize = 60;
export function playlistIconLabel(name: string) {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
export function resolvePlaylistIcon(name?: string): keyof typeof imports {
  if (name === "music") return "music-2";
  if (name === "disc") return "disc-3";
  return name && Object.hasOwn(imports, name)
    ? (name as keyof typeof imports)
    : "music-2";
}
export function filterPlaylistIcons(query: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[-\s]+/g, " ")
      .trim();
  const words = normalize(query).split(" ").filter(Boolean);
  return playlistIconNames.filter((name) =>
    words.every((word) => normalize(name).includes(word)),
  );
}
export function playlistIconPage(names: string[], page: number) {
  return names.slice(
    page * playlistIconPageSize,
    (page + 1) * playlistIconPageSize,
  );
}
export { imports as playlistIconImports };
