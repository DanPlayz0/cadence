// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from "vitest";
import type { Track } from "../services/api";
import {
  advanceQueue,
  emptyQueue,
  previousQueue,
  queueEntry,
  replaceUpcomingSource,
  startQueue,
} from "./queue";
import { restoreQueue, saveQueue, validQueueSnapshot } from "./queueSnapshot";

const tracks = ["a", "b", "c", "d"].map((id) => ({ id, title: id }) as Track);
const source = { name: "Playlist", route: { view: "playlist:p" } };
it("round trips all queue sections, duplicate songs, entry identities and settings", () => {
  let queue = startQueue(
    emptyQueue(),
    [tracks[0], tracks[1], tracks[0]],
    0,
    source,
  );
  queue.manual = [queueEntry(tracks[2]), queueEntry(tracks[2])];
  queue = previousQueue(advanceQueue(queue));
  const saved = saveQueue(queue, true, "all");
  expect(validQueueSnapshot(saved)).toBe(true);
  expect(JSON.stringify(saved)).not.toContain('"track":');
  expect(
    restoreQueue(saved, Object.fromEntries(tracks.map((t) => [t.id, t]))),
  ).toEqual(queue);
  expect(saved.shuffle).toBe(true);
  expect(saved.repeat).toBe("all");
  expect(new Set(queue.manual.map((e) => e.id)).size).toBe(queue.manual.length);
});
it("filters unavailable entries without discarding the rest of the queue", () => {
  const queue = startQueue(emptyQueue(), tracks, 0, source);
  queue.manual = [queueEntry(tracks[2]), queueEntry(tracks[1])];
  const restored = restoreQueue(saveQueue(queue, false, "off"), {
    b: tracks[1],
    d: tracks[3],
  });
  expect(restored.current).toBeNull();
  expect(restored.manual.map((e) => e.track.id)).toEqual(["b"]);
  expect(restored.remaining.map((e) => e.track.id)).toEqual(["b", "d"]);
});
it("replaces upcoming playlist while preserving current, manual and history", () => {
  let queue = advanceQueue(startQueue(emptyQueue(), tracks, 0, source));
  queue.manual = [queueEntry(tracks[2])];
  queue.forward = [queueEntry(tracks[3])];
  const current = queue.current;
  const next = replaceUpcomingSource(queue, [tracks[3], tracks[0]], source);
  expect(next.current).toBe(current);
  expect(next.history).toBe(queue.history);
  expect(next.manual).toBe(queue.manual);
  expect(next.forward).toEqual([]);
  expect(next.remaining.map((e) => e.track.id)).toEqual(["d", "a"]);
  expect(advanceQueue(advanceQueue(next)).current?.track.id).toBe("d");
  expect(replaceUpcomingSource(next, [], source)).toBe(next);
});
it("rejects malformed snapshots and restores IDs without collisions", () => {
  const saved = saveQueue(startQueue(emptyQueue(), tracks), false, "off");
  for (const bad of [
    null,
    {},
    { ...saved, version: 2 },
    { ...saved, manual: null },
    { ...saved, repeat: "bad" },
    { ...saved, current: {} },
  ])
    expect(validQueueSnapshot(bad)).toBe(false);
  const restored = restoreQueue(
    saved,
    Object.fromEntries(tracks.map((t) => [t.id, t])),
  );
  expect(queueEntry(tracks[0]).id).not.toBe(restored.current?.id);
});
