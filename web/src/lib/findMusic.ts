// SPDX-License-Identifier: GPL-2.0-or-later
import { fileName, type SoulseekFile, type SoulseekResult } from "./soulseek";

export type CatalogItem = {
  id: string;
  kind: "artist" | "album" | "song";
  name: string;
  artist: string;
  date: string;
  releaseType: string;
  disambiguation: string;
};
export type CatalogPage = {
  items: CatalogItem[];
  total: number;
  limit: number;
  offset: number;
};
export type FindNavigation = {
  tab: "catalog" | "direct" | "downloads";
  type: "album" | "artist" | "song";
  sourceView: "folders" | "files";
  catalogQuery: string;
  sourceQuery: string;
  filter: string;
  format: string;
  minBitrate: string;
  freeSlots: boolean;
  sort: "availability" | "quality" | "name";
  selection?: CatalogItem;
  artist?: CatalogItem;
};
export const defaultFind: FindNavigation = {
  tab: "catalog",
  type: "album",
  sourceView: "folders",
  catalogQuery: "",
  sourceQuery: "",
  filter: "",
  format: "",
  minBitrate: "",
  freeSlots: false,
  sort: "availability",
};
export function parseFind(raw: string | null): FindNavigation | undefined {
  if (!raw || raw.length > 4096) return undefined;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return undefined;
    const n = { ...defaultFind };
    for (const key of [
      "catalogQuery",
      "sourceQuery",
      "filter",
      "format",
      "minBitrate",
    ] as const)
      if (typeof v[key] === "string") n[key] = v[key].slice(0, 200);
    if (["catalog", "direct", "downloads"].includes(v.tab)) n.tab = v.tab;
    if (["album", "artist", "song"].includes(v.type)) n.type = v.type;
    if (["folders", "files"].includes(v.sourceView))
      n.sourceView = v.sourceView;
    if (["availability", "quality", "name"].includes(v.sort)) n.sort = v.sort;
    n.freeSlots = v.freeSlots === true;
    for (const key of ["selection", "artist"] as const) {
      const item = v[key];
      if (
        item &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          item.id,
        ) &&
        ["artist", "album", "song"].includes(item.kind) &&
        ["name", "artist", "date", "releaseType", "disambiguation"].every(
          (k) => typeof item[k] === "string" && item[k].length <= 300,
        )
      )
        n[key] = item;
    }
    return n;
  } catch {
    return undefined;
  }
}
export function formatOf(file: SoulseekFile) {
  return fileName(file.filename).split(".").pop()?.toLowerCase() || "";
}
export function quality(file: SoulseekFile) {
  return [
    formatOf(file).toUpperCase(),
    file.bitDepth && `${file.bitDepth} bit`,
    file.sampleRate && `${file.sampleRate / 1000} kHz`,
    file.bitRate && `${file.bitRate} kbps`,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function duration(seconds?: number) {
  return seconds
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    : "—";
}
export function sourceQuality(files: SoulseekFile[]) {
  const formats = new Map<string, SoulseekFile[]>();
  for (const file of files) {
    const format = formatOf(file);
    const group = formats.get(format);
    if (group) group.push(file);
    else formats.set(format, [file]);
  }
  return [...formats.entries()]
    .map(([format, group]) => {
      const range = (
        field: "bitDepth" | "sampleRate" | "bitRate",
        scale: number,
        unit: string,
      ) => {
        if (group.some((f) => !f[field])) return "";
        const values = group.map((f) => f[field]! / scale),
          low = Math.min(...values),
          high = Math.max(...values);
        return `${low === high ? low : `${low}–${high}`} ${unit}`;
      };
      return [
        format.toUpperCase(),
        range("bitDepth", 1, "bit"),
        range("sampleRate", 1000, "kHz"),
        range("bitRate", 1, "kbps"),
      ]
        .filter(Boolean)
        .join(" · ");
    })
    .sort()
    .join(" / ");
}
export const naturalFiles = (files: SoulseekFile[]) =>
  [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true }),
  );
export type Source = {
  key: string;
  result: SoulseekResult;
  files: SoulseekResult[];
};
export function sources(
  results: SoulseekResult[],
  nav: FindNavigation,
): Source[] {
  const matching = results.filter(
    (r) =>
      (!nav.filter ||
        `${r.filename} ${r.username}`
          .toLowerCase()
          .includes(nav.filter.toLowerCase())) &&
      (!nav.format || formatOf(r) === nav.format) &&
      (!nav.minBitrate || (r.bitRate || 0) >= Number(nav.minBitrate)) &&
      (!nav.freeSlots || r.hasFreeUploadSlot),
  );
  const groups = new Map<string, Source>();
  for (const r of matching) {
    const folder = r.folder.replaceAll("\\", "/");
    const key = JSON.stringify([
      r.username,
      nav.sourceView === "folders" ? folder : r.filename.replaceAll("\\", "/"),
    ]);
    const group = groups.get(key);
    if (group) {
      if (
        !group.files.some(
          (f) =>
            f.filename.replaceAll("\\", "/") ===
            r.filename.replaceAll("\\", "/"),
        )
      )
        group.files.push(r);
    } else groups.set(key, { key, result: r, files: [r] });
  }
  return [...groups.values()].sort((a, b) => {
    const score = (s: Source) =>
      Math.max(
        ...s.files.map(
          (f) =>
            (f.bitDepth || 0) * 1e7 +
            (f.sampleRate || 0) * 100 +
            (f.bitRate || 0),
        ),
      );
    const name = (s: Source) =>
      fileName(
        nav.sourceView === "folders" ? s.result.folder : s.result.filename,
      );
    const order =
      nav.sort === "quality"
        ? score(b) - score(a)
        : nav.sort === "name"
          ? name(a).localeCompare(name(b), undefined, { numeric: true })
          : Number(b.result.hasFreeUploadSlot) -
              Number(a.result.hasFreeUploadSlot) ||
            a.result.queueLength - b.result.queueLength ||
            b.result.uploadSpeed - a.result.uploadSpeed;
    return order || a.key.localeCompare(b.key);
  });
}
