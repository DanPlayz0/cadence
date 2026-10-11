// SPDX-License-Identifier: GPL-2.0-or-later
import type { Track } from "../services/api";
import {
  emptyQueue,
  type PlaybackQueue,
  type PlaybackSource,
  type QueueEntry,
} from "./queue";

export type SavedEntry = Omit<QueueEntry, "track"> & { trackId: string };
export type QueueSnapshot = {
  version: 1;
  current: SavedEntry | null;
  history: SavedEntry[];
  forward: SavedEntry[];
  manual: SavedEntry[];
  remaining: SavedEntry[];
  cycle: SavedEntry[];
  source?: PlaybackSource;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
};
export const queueSections = [
  "history",
  "forward",
  "manual",
  "remaining",
  "cycle",
] as const;

export function saveQueue(
  q: PlaybackQueue,
  shuffle: boolean,
  repeat: QueueSnapshot["repeat"],
): QueueSnapshot {
  const entry = ({ track, ...value }: QueueEntry): SavedEntry => ({
    ...value,
    trackId: track.id,
  });
  return {
    version: 1,
    current: q.current ? entry(q.current) : null,
    history: q.history.map(entry),
    forward: q.forward.map(entry),
    manual: q.manual.map(entry),
    remaining: q.remaining.map(entry),
    cycle: q.cycle.map(entry),
    source: q.source,
    shuffle,
    repeat,
  };
}
export function savedEntries(q: QueueSnapshot): SavedEntry[] {
  return [
    ...(q.current ? [q.current] : []),
    ...queueSections.flatMap((key) => q[key]),
  ];
}
export function restoreQueue(
  q: QueueSnapshot,
  tracks: Record<string, Track>,
): PlaybackQueue {
  const entry = (value: SavedEntry): QueueEntry => {
    const { trackId, ...rest } = value;
    return { ...rest, track: tracks[trackId] };
  };
  const result = { ...emptyQueue(), source: q.source };
  result.current =
    q.current && Object.hasOwn(tracks, q.current.trackId)
      ? entry(q.current)
      : null;
  for (const key of queueSections)
    result[key] = q[key]
      .filter((v) => Object.hasOwn(tracks, v.trackId))
      .map(entry);
  return result;
}
export function validQueueSnapshot(value: unknown): value is QueueSnapshot {
  if (!value || typeof value !== "object") return false;
  const q = value as QueueSnapshot;
  const source = (v: PlaybackSource | undefined) =>
    v === undefined ||
    (!!v &&
      typeof v.name === "string" &&
      !!v.route &&
      typeof v.route.view === "string" &&
      Object.values(v.route).every((s) => typeof s === "string"));
  const entry = (v: SavedEntry) =>
    !!v &&
    typeof v.id === "string" &&
    !!v.id &&
    typeof v.trackId === "string" &&
    !!v.trackId &&
    Number.isSafeInteger(v.order) &&
    v.order >= 0 &&
    source(v.source);
  return (
    q.version === 1 &&
    typeof q.shuffle === "boolean" &&
    ["off", "all", "one"].includes(q.repeat) &&
    source(q.source) &&
    (q.current === null || entry(q.current)) &&
    queueSections.every((key) => Array.isArray(q[key]) && q[key].every(entry))
  );
}
