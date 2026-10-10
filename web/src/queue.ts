// SPDX-License-Identifier: GPL-2.0-or-later
import type { Track } from "./api";
import type { Route } from "./navigation";

export type PlaybackSource = { name: string; route: Route };
export type QueueEntry = {
  id: string;
  track: Track;
  source?: PlaybackSource;
  order: number;
};
export type QueueSection = "forward" | "manual" | "remaining";
export type PlaybackQueue = {
  current: QueueEntry | null;
  history: QueueEntry[];
  forward: QueueEntry[];
  manual: QueueEntry[];
  remaining: QueueEntry[];
  cycle: QueueEntry[];
  source?: PlaybackSource;
};
let entrySequence = 0;
export function queueEntry(
  track: Track,
  source?: PlaybackSource,
  order = 0,
): QueueEntry {
  return { id: `entry-${++entrySequence}`, track, source, order };
}
export function emptyQueue(): PlaybackQueue {
  return {
    current: null,
    history: [],
    forward: [],
    manual: [],
    remaining: [],
    cycle: [],
  };
}
function shuffled(entries: QueueEntry[], random = Math.random) {
  const result = [...entries];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function shuffleRemaining(
  q: PlaybackQueue,
  enabled: boolean,
  random = Math.random,
): PlaybackQueue {
  return {
    ...q,
    remaining: enabled
      ? shuffled(q.remaining, random)
      : [...q.remaining].sort((a, b) => a.order - b.order),
  };
}
export function startQueue(
  q: PlaybackQueue,
  tracks: Track[],
  index = 0,
  source?: PlaybackSource,
  shuffle = false,
): PlaybackQueue {
  if (!tracks[index]) return q;
  const cycle = tracks.map((track, order) => queueEntry(track, source, order));
  return shuffleRemaining(
    {
      ...q,
      current: cycle[index],
      history: q.current ? [...q.history, q.current] : q.history,
      forward: [],
      remaining: cycle.slice(index + 1),
      cycle,
      source,
    },
    shuffle,
  );
}
export function advanceQueue(
  q: PlaybackQueue,
  repeatAll = false,
  shuffle = false,
): PlaybackQueue {
  let section: QueueSection = q.forward.length
    ? "forward"
    : q.manual.length
      ? "manual"
      : "remaining";
  let entries = q[section];
  if (!entries.length && repeatAll && q.cycle.length) {
    entries = q.cycle.map((entry) =>
      queueEntry(entry.track, entry.source, entry.order),
    );
    if (shuffle) entries = shuffled(entries);
    section = "remaining";
  }
  if (!entries.length) return q;
  return {
    ...q,
    current: entries[0],
    [section]: entries.slice(1),
    history: q.current ? [...q.history, q.current] : q.history,
  };
}
export function previousQueue(q: PlaybackQueue): PlaybackQueue {
  if (!q.history.length) return q;
  return {
    ...q,
    current: q.history[q.history.length - 1],
    history: q.history.slice(0, -1),
    forward: q.current ? [q.current, ...q.forward] : q.forward,
  };
}
export function jumpQueue(
  q: PlaybackQueue,
  section: QueueSection,
  id: string,
  keepEarlier = false,
): PlaybackQueue {
  const index = q[section].findIndex((entry) => entry.id === id);
  if (index < 0) return q;
  return {
    ...q,
    current: q[section][index],
    [section]: keepEarlier
      ? q[section].filter((entry) => entry.id !== id)
      : q[section].slice(index + 1),
    history: q.current ? [...q.history, q.current] : q.history,
  };
}
export function removeQueueEntry(
  q: PlaybackQueue,
  section: QueueSection,
  id: string,
): PlaybackQueue {
  const entry = q[section].find((entry) => entry.id === id);
  if (!entry) return q;
  return {
    ...q,
    [section]: q[section].filter((entry) => entry.id !== id),
    cycle:
      section === "remaining"
        ? q.cycle.filter((item) => item.order !== entry.order)
        : q.cycle,
  };
}
export function reorderQueue(
  q: PlaybackQueue,
  section: QueueSection,
  id: string,
  targetId: string,
): PlaybackQueue {
  const entries = [...q[section]];
  const from = entries.findIndex((entry) => entry.id === id);
  const to = entries.findIndex((entry) => entry.id === targetId);
  if (from < 0 || to < 0 || from === to) return q;
  const [entry] = entries.splice(from, 1);
  entries.splice(to, 0, entry);
  return { ...q, [section]: entries };
}
export function retainQueue(
  q: PlaybackQueue,
  allowed: (id: string) => boolean,
): PlaybackQueue {
  const retain = (entries: QueueEntry[]) =>
    entries.filter((entry) => allowed(entry.track.id));
  return {
    ...q,
    current: q.current && allowed(q.current.track.id) ? q.current : null,
    history: retain(q.history),
    forward: retain(q.forward),
    manual: retain(q.manual),
    remaining: retain(q.remaining),
    cycle: retain(q.cycle),
  };
}
export function queueEntries(q: PlaybackQueue) {
  return [
    ...(q.current ? [q.current] : []),
    ...q.history,
    ...q.forward,
    ...q.manual,
    ...q.remaining,
    ...q.cycle,
  ];
}
export function hasNext(q: PlaybackQueue, repeatAll: boolean) {
  return !!(
    q.forward.length ||
    q.manual.length ||
    q.remaining.length ||
    (repeatAll && q.cycle.length)
  );
}
