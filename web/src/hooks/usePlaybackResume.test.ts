// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyQueue, queueEntry, startQueue } from "../lib/queue";
import { restoreQueue, saveQueue } from "../lib/queueSnapshot";
import type { usePlayer } from "./usePlayer";
import type { Checkpoint, SavedPlayback } from "../lib/playbackCheckpoint";
import type { Track } from "../services/api";

const hooks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    return (hooks.cells[index] ??= { current: initial });
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.index++;
    const old = hooks.cells[index];
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
      hooks.effects.push(() => {
        old?.cleanup?.();
        hooks.cells[index] = { deps, cleanup: effect() };
      });
    }
  },
}));
vi.mock("../services/api", async (original) => ({
  ...(await original<object>()),
  api: vi.fn(),
}));
import { api, APIError } from "../services/api";
import { usePlaybackResume } from "./usePlaybackResume";

const track = (id: string): Track =>
  ({ id, title: id, duration: 100 }) as Track;
const a = track("a"),
  b = track("b"),
  c = track("c");
const source = { name: "Playlist", route: { view: "playlist:p" } };
let player: ReturnType<typeof usePlayer>;
let generation: number;
let position: number;
let storage: Map<string, string>;
let windowEvents: EventTarget;
let saved: SavedPlayback;
let queue: ReturnType<typeof emptyQueue>;
function render(user = "user") {
  hooks.index = 0;
  player.queue = queue;
  usePlaybackResume(player, user);
  for (const effect of hooks.effects.splice(0)) effect();
}
async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
async function flush() {
  render();
  await vi.advanceTimersByTimeAsync(300);
  await settle();
}
const writes = () =>
  vi.mocked(api).mock.calls.filter((call) => call[1] === "PUT");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.cells = [];
  hooks.effects = [];
  hooks.index = 0;
  generation = 0;
  position = 0;
  storage = new Map();
  queue = emptyQueue();
  windowEvents = new EventTarget();
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
  });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  saved = {
    trackId: "a",
    position: 42,
    revision: 3,
    writer: "0123456789abcdef",
    sequence: 1,
    track: a,
    tracks: { a, b },
    queue: saveQueue(startQueue(emptyQueue(), [a, b], 0, source), false, "all"),
  };
  player = {
    queue,
    shuffle: false,
    repeat: "off",
    playing: false,
    checkpointVersion: 0,
    generation: () => String(generation),
    snapshot: () => ({
      trackId: queue.current?.track.id ?? "",
      position,
      playing: false,
      queue: saveQueue(queue, player.shuffle, player.repeat),
      tracks: Object.fromEntries(
        [queue.current, ...queue.manual, ...queue.remaining]
          .filter(Boolean)
          .map((e) => [e!.track.id, e!.track]),
      ),
    }),
    restore: vi.fn((t, p, restored, settings) => {
      queue = restored ?? {
        ...emptyQueue(),
        current: t ? queueEntry(t) : null,
      };
      position = p;
      generation++;
      if (settings) {
        player.shuffle = settings.shuffle;
        player.repeat = settings.repeat;
      }
    }),
  } as unknown as ReturnType<typeof usePlayer>;
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (_path, method, body) =>
    method === "PUT"
      ? { ...(body as Checkpoint), revision: ++saved.revision }
      : saved,
  );
});
afterEach(() => {
  for (const cell of hooks.cells) cell?.cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("restores a complete server queue and settings without autoplay", async () => {
  render();
  await settle();
  expect(player.restore).toHaveBeenCalledWith(
    a,
    42,
    restoreQueue(saved.queue!, { a, b }),
    saved.queue,
  );
  expect(JSON.parse(storage.get("cadence:playback:user")!).dirty).toBe(false);
  await flush();
  expect(writes()).toEqual([]);
});
it("persists manual edits, reorder, clear and settings while paused", async () => {
  render();
  await settle();
  queue = { ...queue, manual: [queueEntry(c), queueEntry(b)] };
  generation++;
  await flush();
  expect(
    (writes()[0][2] as Checkpoint).queue?.manual.map((e) => e.trackId),
  ).toEqual(["c", "b"]);
  expect(writes()[0][2]).not.toHaveProperty("playing");
  expect(writes()[0][2]).not.toHaveProperty("tracks");
  queue = { ...queue, manual: [...queue.manual].reverse() };
  generation++;
  await flush();
  expect(
    (writes()[1][2] as Checkpoint).queue?.manual.map((e) => e.trackId),
  ).toEqual(["b", "c"]);
  queue = { ...queue, manual: [] };
  player.repeat = "one";
  generation++;
  await flush();
  expect((writes()[2][2] as Checkpoint).queue?.manual).toEqual([]);
  expect((writes()[2][2] as Checkpoint).queue?.repeat).toBe("one");
});
it("does not overwrite startup interaction or local recovery while GET is pending", async () => {
  const get = deferred<SavedPlayback>();
  vi.mocked(api).mockImplementationOnce(() => get.promise);
  render();
  await vi.advanceTimersByTimeAsync(300);
  expect(storage.size).toBe(0);
  queue.manual = [queueEntry(c)];
  generation++;
  get.resolve(saved);
  await settle();
  expect(player.restore).not.toHaveBeenCalled();
  expect((writes()[0][2] as Checkpoint).queue?.manual[0].trackId).toBe("c");
});
it("recovers dirty local queues, filters denied tracks and supports legacy checkpoints", async () => {
  const localQueue = startQueue(emptyQueue(), [a, c], 0, source);
  storage.set(
    "cadence:playback:user",
    JSON.stringify({
      ...saved,
      queue: saveQueue(localQueue, false, "off"),
      tracks: { a, c },
      sequence: 2,
      dirty: true,
    }),
  );
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (method === "PUT") return { ...(body as Checkpoint), revision: 4 };
    if (path.includes("/tracks/")) throw new APIError(404, "Gone");
    return saved;
  });
  render();
  await settle();
  expect(player.restore).toHaveBeenCalled();
  expect(queue.remaining).toEqual([]);
  expect(queue.current?.track.id).toBe("a");
});
it("restores legacy single-song checkpoints", async () => {
  delete saved.queue;
  render();
  await settle();
  expect(player.restore).toHaveBeenCalledWith(a, 42, undefined, undefined);
});

it("does not save an untouched empty queue after an initial network failure", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Offline"));
  render();
  await settle();
  await vi.advanceTimersByTimeAsync(10300);
  windowEvents.dispatchEvent(new Event("online"));
  await settle();
  expect(writes()).toEqual([]);
  expect(storage.size).toBe(0);
});
it("serializes writes and saves edits arriving while a request is pending", async () => {
  render();
  await settle();
  const put = deferred<Checkpoint>();
  vi.mocked(api).mockImplementationOnce(() => put.promise);
  queue = { ...queue, manual: [queueEntry(c)] };
  generation++;
  await flush();
  queue = { ...queue, manual: [] };
  generation++;
  await flush();
  expect(writes()).toHaveLength(1);
  put.resolve({ ...(writes()[0][2] as Checkpoint), revision: 4 });
  await settle();
  expect(writes()).toHaveLength(2);
  expect((writes()[1][2] as Checkpoint).queue?.manual).toEqual([]);
});
it("uses bounded progress-only keepalive for a large already-synced queue", async () => {
  saved.queue = saveQueue(
    startQueue(
      emptyQueue(),
      Array.from({ length: 1000 }, () => a),
      0,
      source,
    ),
    false,
    "off",
  );
  // PostgreSQL jsonb does not preserve the client's object key order.
  saved.queue = JSON.parse(JSON.stringify(saved.queue), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
  render();
  await settle();
  position = 55;
  windowEvents.dispatchEvent(new Event("pagehide"));
  await settle();
  expect(writes()[0][3]).toBe(true);
  expect(writes()[0][2]).not.toHaveProperty("queue");
  expect((writes()[0][2] as Checkpoint).position).toBe(55);
});
it("keeps unsaved large queue changes locally rather than dropping them on unload", async () => {
  render();
  await settle();
  queue = startQueue(
    queue,
    Array.from({ length: 1000 }, () => a),
    0,
    source,
  );
  generation++;
  windowEvents.dispatchEvent(new Event("pagehide"));
  await settle();
  expect(writes()).toHaveLength(0);
  expect(
    JSON.parse(storage.get("cadence:playback:user")!).queue.cycle,
  ).toHaveLength(1000);
});
it("ignores old account restoration after the account changes", async () => {
  const old = deferred<SavedPlayback>();
  vi.mocked(api).mockImplementationOnce(() => old.promise);
  render("old");
  render("new");
  await settle();
  expect(player.restore).toHaveBeenCalledTimes(1);
  old.resolve({ ...saved, position: 90 });
  await settle();
  expect(player.restore).toHaveBeenCalledTimes(1);
  expect(position).toBe(42);
});
