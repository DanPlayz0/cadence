// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from "vitest";
import type { Track } from "./api";
import {
  advanceQueue,
  emptyQueue,
  hasNext,
  jumpQueue,
  previousQueue,
  queueEntries,
  queueEntry,
  removeQueueEntry,
  reorderQueue,
  retainQueue,
  shuffleRemaining,
  startQueue,
} from "./queue";
const tracks = ["A", "B", "C", "D"].map((id) => ({ id, title: id }) as Track);
const source = { name: "Evening mix", route: { view: "playlist:p" } };
const ids = (entries: { track: Track }[]) =>
  entries.map((entry) => entry.track.id);
it("starts at the selected song with only the actual remainder and no invented history", () => {
  const q = startQueue(emptyQueue(), tracks, 2, source);
  expect(q.current?.track.id).toBe("C");
  expect(ids(q.remaining)).toEqual(["D"]);
  expect(q.history).toEqual([]);
  expect(q.current?.source).toEqual(source);
  expect(startQueue(q, tracks, 99)).toBe(q);
});
it("plays manual additions first and preserves them and history when replacing the source", () => {
  let q = startQueue(emptyQueue(), tracks, 0, source);
  q = { ...q, manual: [queueEntry(tracks[3]), queueEntry(tracks[2])] };
  q = startQueue(q, [tracks[1], tracks[0]], 0, {
    name: "Other",
    route: { view: "songs" },
  });
  expect(ids(q.history)).toEqual(["A"]);
  expect(ids(q.manual)).toEqual(["D", "C"]);
  q = advanceQueue(q);
  expect(q.current?.track.id).toBe("D");
  q = advanceQueue(q);
  expect(q.current?.track.id).toBe("C");
  q = advanceQueue(q);
  expect(q.current?.track.id).toBe("A");
});
it("Previous and Next follow actual playback through manual songs without changing upcoming entries", () => {
  let q = startQueue(emptyQueue(), tracks);
  q = { ...q, manual: [queueEntry(tracks[3])] };
  q = advanceQueue(q);
  q = advanceQueue(q);
  const remaining = q.remaining;
  q = previousQueue(previousQueue(q));
  expect(q.current?.track.id).toBe("A");
  expect(ids(q.forward)).toEqual(["D", "B"]);
  expect(q.remaining).toBe(remaining);
  q = advanceQueue(advanceQueue(q));
  expect(q.current?.track.id).toBe("B");
  expect(ids(q.history)).toEqual(["A", "D"]);
  expect(q.forward).toEqual([]);
  expect(previousQueue(emptyQueue())).toEqual(emptyQueue());
});
it("jumping skips earlier entries only in the selected section without pretending they played", () => {
  const base = startQueue(emptyQueue(), tracks);
  const q = { ...base, manual: [queueEntry(tracks[0])] };
  const next = jumpQueue(q, "remaining", q.remaining[1].id);
  expect(next.current?.track.id).toBe("C");
  expect(ids(next.history)).toEqual(["A"]);
  expect(ids(next.remaining)).toEqual(["D"]);
  expect(next.manual).toBe(q.manual);
  expect(jumpQueue(q, "remaining", "missing")).toBe(q);
});
it("the alternate jump preserves earlier entries and other sections", () => {
  const q = startQueue(emptyQueue(), tracks);
  const next = jumpQueue(q, "remaining", q.remaining[1].id, true);
  expect(ids(next.remaining)).toEqual(["B", "D"]);
  expect(next.current?.track.id).toBe("C");
});
it("duplicates have independent identities for moves, removal and playback", () => {
  let q = startQueue(emptyQueue(), [tracks[0], tracks[0], tracks[0]]);
  expect(new Set(queueEntries(q).map((entry) => entry.id)).size).toBe(3);
  const [first, second] = q.remaining;
  q = reorderQueue(q, "remaining", first.id, second.id);
  expect(q.remaining.map((entry) => entry.id)).toEqual([second.id, first.id]);
  q = removeQueueEntry(q, "remaining", second.id);
  expect(q.remaining.map((entry) => entry.id)).toEqual([first.id]);
  expect(q.cycle).toHaveLength(2);
  expect(reorderQueue(q, "manual", first.id, second.id)).toBe(q);
  q = advanceQueue(q);
  expect(q.current?.id).toBe(first.id);
});
it("shuffle exposes the exact next order, preserves manual order and restores remaining source order", () => {
  let q = startQueue(emptyQueue(), tracks);
  q = { ...q, manual: [queueEntry(tracks[2]), queueEntry(tracks[3])] };
  const mixed = shuffleRemaining(q, true, () => 0);
  expect(ids(mixed.remaining)).toEqual(["C", "D", "B"]);
  expect(mixed.manual).toBe(q.manual);
  const progressed = advanceQueue(advanceQueue(advanceQueue(mixed)));
  expect(progressed.current?.track.id).toBe("C");
  expect(ids(shuffleRemaining(progressed, false).remaining)).toEqual([
    "B",
    "D",
  ]);
  expect(ids(shuffleRemaining(mixed, false).remaining)).toEqual([
    "B",
    "C",
    "D",
  ]);
});
it("repeat-all starts a fresh source cycle and never replays consumed manual additions", () => {
  let q = startQueue(emptyQueue(), [tracks[0], tracks[1]], 1, source);
  q = { ...q, manual: [queueEntry(tracks[3])] };
  q = advanceQueue(q, true);
  expect(q.current?.track.id).toBe("D");
  const cycled = advanceQueue(q, true);
  expect(cycled.current?.track.id).toBe("A");
  expect(cycled.manual).toEqual([]);
  expect(cycled.current?.id).not.toBe(cycled.cycle[0].id);
  const removed = removeQueueEntry(cycled, "remaining", cycled.remaining[0].id);
  expect(ids(removed.cycle)).toEqual(["A"]);
  expect(advanceQueue(removed, true).current?.track.id).toBe("A");
});
it("end-of-queue is stable and repeat availability requires a source", () => {
  const q = startQueue(emptyQueue(), [tracks[0]]);
  expect(hasNext(q, false)).toBe(false);
  expect(hasNext(q, true)).toBe(true);
  expect(advanceQueue(q)).toBe(q);
  expect(hasNext(emptyQueue(), true)).toBe(false);
  expect(advanceQueue(emptyQueue(), true)).toEqual(emptyQueue());
});
it("permission filtering removes inaccessible songs from every playback section and repeat source", () => {
  let q = startQueue(emptyQueue(), tracks, 0, source);
  q = advanceQueue(advanceQueue(q));
  q = previousQueue(q);
  q = { ...q, manual: [queueEntry(tracks[0]), queueEntry(tracks[3])] };
  const kept = retainQueue(q, (id) => id === "D");
  expect(kept.current).toBeNull();
  expect(kept.history).toEqual([]);
  expect(kept.forward).toEqual([]);
  expect(ids(kept.manual)).toEqual(["D"]);
  expect(ids(kept.remaining)).toEqual(["D"]);
  expect(ids(kept.cycle)).toEqual(["D"]);
});
