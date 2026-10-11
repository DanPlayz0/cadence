// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../services/api", async (original) => ({
  ...(await original<typeof import("../services/api")>()),
  api: vi.fn(),
}));
import {
  api,
  APIError,
  type Album,
  type Artist,
  type Page,
  type Track,
} from "../services/api";
import {
  CollectionStore,
  watchLibraries,
  type CollectionContext,
} from "./collection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 10; ++i) await Promise.resolve();
};
// Vitest erases the generic result parameter; fixtures supply the matching endpoint shape.
const createStore = (
  fetch: ReturnType<typeof vi.fn<typeof api>>,
  expired = () => {},
) => new CollectionStore(fetch as typeof api, expired);
const context = (
  overrides: Partial<CollectionContext> = {},
): CollectionContext => ({
  userId: "user",
  key: "songs",
  view: "songs",
  query: "",
  debounced: "",
  libraryId: "",
  artist: "",
  reload: 0,
  ...overrides,
});
const tracks = (prefix: string, count = 100): Track[] =>
  Array.from(
    { length: count },
    (_, i) => ({ id: `${prefix}-${i}`, title: prefix, liked: false }) as Track,
  );
const page = (prefix: string, count = 100, total = 300): Page => ({
  items: tracks(prefix, count),
  total,
  limit: 100,
  offset: 0,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("collection background refresh", () => {
  it("restarts an initial load interrupted by a collection mutation", async () => {
    const oldRequest = deferred<Page>();
    const fetch = vi
      .fn<typeof api>()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(page("latest"));
    const store = createStore(fetch);
    store.configure(context());
    store.invalidate();
    await flush();
    oldRequest.resolve(page("stale"));
    await flush();
    expect(store.getSnapshot()).toMatchObject({ key: "songs", loading: false });
    expect(store.getSnapshot().tracks[0].title).toBe("latest");
  });

  it("ignores an older refresh after an explicit collection reload", async () => {
    const pending = deferred<Page>();
    const fetch = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(page("old"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page("latest"));
    const store = createStore(fetch);
    store.configure(context());
    await flush();
    store.refresh();
    store.configure(context({ reload: 1 }));
    await flush();
    pending.resolve(page("stale"));
    await flush();
    expect(store.getSnapshot().tracks[0].title).toBe("latest");
  });

  it("keeps the initial loading placeholder until a collection arrives", async () => {
    const pending = deferred<Page>();
    const fetch = vi.fn<typeof api>().mockReturnValue(pending.promise);
    const store = createStore(fetch);
    store.configure(context());
    expect(store.getSnapshot()).toMatchObject({
      key: "",
      loading: true,
      refreshing: false,
    });
    pending.resolve(page("initial"));
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      key: "songs",
      loading: false,
      total: 300,
    });
  });

  it.each(["songs", "albums", "artists"])(
    "keeps %s visible until an atomic refresh completes",
    async (view) => {
      const old =
        view === "songs"
          ? page("old")
          : view === "albums"
            ? [{ id: "old", title: "old" } as Album]
            : [{ name: "old" } as Artist];
      const next =
        view === "songs"
          ? page("new")
          : view === "albums"
            ? [{ id: "new", title: "new" } as Album]
            : [{ name: "new" } as Artist];
      const pending = deferred<typeof next>();
      const fetch = vi
        .fn<typeof api>()
        .mockResolvedValueOnce(old)
        .mockReturnValueOnce(pending.promise);
      const store = createStore(fetch);
      store.configure(context({ view, key: view }));
      await flush();
      const before = store.getSnapshot();
      store.refresh();
      expect(store.getSnapshot()).toMatchObject({
        key: view,
        loading: false,
        refreshing: true,
      });
      expect(store.getSnapshot().tracks).toBe(before.tracks);
      expect(store.getSnapshot().albums).toBe(before.albums);
      expect(store.getSnapshot().artists).toBe(before.artists);
      store.refresh();
      expect(fetch).toHaveBeenCalledTimes(2);
      pending.resolve(next);
      await flush();
      expect(store.getSnapshot()).toMatchObject({
        key: view,
        loading: false,
        refreshing: false,
      });
      expect(JSON.stringify(store.getSnapshot())).toContain("new");
    },
  );

  it("stages every loaded page and updates totals/pagination together", async () => {
    const first = deferred<Page>();
    const second = deferred<Page>();
    const fetch = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(page("old-first"))
      .mockResolvedValueOnce(page("old-second"))
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const store = createStore(fetch);
    store.configure(context());
    await flush();
    await store.loadMore();
    const before = store.getSnapshot();
    expect(before.tracks).toHaveLength(200);
    store.refresh();
    first.resolve(page("new-first", 100, 150));
    await flush();
    expect(store.getSnapshot().tracks).toBe(before.tracks);
    expect(store.getSnapshot()).toMatchObject({
      offset: 100,
      total: 300,
      more: true,
      refreshing: true,
    });
    expect(fetch.mock.calls[3][0]).toContain("offset=100");
    second.resolve(page("new-second", 50, 150));
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      offset: 100,
      total: 150,
      more: false,
      refreshing: false,
    });
    expect(store.getSnapshot().tracks).toHaveLength(150);
    expect(store.getSnapshot().tracks[0].title).toBe("new-first");
  });

  it.each(["albums", "artists"])(
    "refreshes multiple loaded %s pages",
    async (view) => {
      const items = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, i) =>
          view === "albums"
            ? ({ id: `${prefix}-${i}`, title: prefix } as Album)
            : ({ name: `${prefix}-${i}` } as Artist),
        );
      const fetch = vi
        .fn<typeof api>()
        .mockResolvedValueOnce(items("old-a", 100))
        .mockResolvedValueOnce(items("old-b", 100))
        .mockResolvedValueOnce(items("new-a", 100))
        .mockResolvedValueOnce(items("new-b", 25));
      const store = createStore(fetch);
      store.configure(context({ view, key: view }));
      await flush();
      await store.loadMore();
      store.refresh();
      await flush();
      expect(
        view === "albums"
          ? store.getSnapshot().albums
          : store.getSnapshot().artists,
      ).toHaveLength(125);
      expect(store.getSnapshot()).toMatchObject({ offset: 100, more: false });
    },
  );

  it("retains all old pages on partial refresh failure and retries the full range", async () => {
    const fetch = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(page("old-a"))
      .mockResolvedValueOnce(page("old-b"))
      .mockResolvedValueOnce(page("new-a"))
      .mockRejectedValueOnce(new Error("Offline"));
    const store = createStore(fetch);
    store.configure(context());
    await flush();
    await store.loadMore();
    const before = store.getSnapshot();
    store.refresh();
    await flush();
    expect(store.getSnapshot().tracks).toBe(before.tracks);
    expect(store.getSnapshot()).toMatchObject({
      refreshing: false,
      error: { key: "songs", message: "Offline" },
    });
    fetch
      .mockResolvedValueOnce(page("retry-a"))
      .mockResolvedValueOnce(page("retry-b", 10, 110));
    store.configure(context({ reload: 1 }));
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      error: null,
      total: 110,
      more: false,
    });
    expect(store.getSnapshot().tracks).toHaveLength(110);
  });

  it("invalidates inactive caches while refreshing the active collection", async () => {
    const fetch = vi.fn<typeof api>().mockResolvedValue(page("data"));
    const store = createStore(fetch);
    store.configure(context());
    await flush();
    store.configure(context({ key: "likes", view: "likes" }));
    await flush();
    store.configure(context());
    expect(fetch).toHaveBeenCalledTimes(2);
    store.refresh();
    await flush();
    store.configure(context({ key: "likes", view: "likes" }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each(["navigation", "account", "logout", "unmount"])(
    "ignores late refresh responses after %s",
    async (change) => {
      const pending = deferred<Page>();
      const fetch = vi
        .fn<typeof api>()
        .mockResolvedValueOnce(page("old"))
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(page("destination"));
      const store = createStore(fetch);
      store.configure(context());
      await flush();
      store.refresh();
      if (change === "navigation")
        store.configure(context({ key: "likes", view: "likes" }));
      if (change === "account")
        store.configure(context({ userId: "new-user" }));
      if (change === "logout") store.configure(context({ userId: undefined }));
      if (change === "unmount") store.dispose();
      await flush();
      const before = store.getSnapshot();
      pending.resolve(page("late"));
      await flush();
      expect(store.getSnapshot()).toBe(before);
      if (change === "logout")
        expect(store.getSnapshot().tracks).toHaveLength(0);
      if (change === "account")
        expect(store.getSnapshot().userId).toBe("new-user");
    },
  );

  it("clears inaccessible data and ignores requests from the removed library", async () => {
    const pending = deferred<Page>();
    const fetch = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(page("restricted"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page("accessible"));
    const store = createStore(fetch);
    store.configure(context({ libraryId: "removed", key: "restricted" }));
    await flush();
    store.refresh();
    store.invalidate(true);
    expect(store.getSnapshot()).toMatchObject({ key: "", tracks: [] });
    store.configure(context());
    await flush();
    pending.resolve(page("restricted-late"));
    await flush();
    expect(store.getSnapshot().tracks[0].title).toBe("accessible");
  });

  it("lets pagination supersede refresh and then refreshes the expanded range", async () => {
    const pending = deferred<Page>();
    const fetch = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(page("initial"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page("extra"))
      .mockResolvedValueOnce(page("fresh-first"))
      .mockResolvedValueOnce(page("fresh-second"));
    const store = createStore(fetch);
    store.configure(context());
    await flush();
    store.refresh();
    await store.loadMore();
    await flush();
    pending.resolve(page("outdated"));
    await flush();
    expect(store.getSnapshot().tracks).toHaveLength(200);
    expect(store.getSnapshot().tracks[0].title).toBe("fresh-first");
    expect(store.getSnapshot().tracks[100].title).toBe("fresh-second");
  });

  it("does not let refresh overwrite a successful like mutation", async () => {
    const pending = deferred<Page>();
    const fetch = vi
      .fn<typeof api>()
      .mockResolvedValueOnce(page("track", 1, 1))
      .mockReturnValueOnce(pending.promise);
    const store = createStore(fetch);
    store.configure(context());
    await flush();
    store.refresh();
    store.setTracks((items) =>
      items.map((track) => ({ ...track, liked: true })),
    );
    pending.resolve(page("track", 1, 1));
    await flush();
    expect(store.getSnapshot().tracks[0].liked).toBe(true);
    expect(store.getSnapshot().refreshing).toBe(false);
  });

  it("expires unauthorized sessions and keeps empty search/non-collection views idle", async () => {
    const expired = vi.fn();
    const fetch = vi
      .fn<typeof api>()
      .mockRejectedValue(new APIError(401, "Expired"));
    const store = createStore(fetch, expired);
    store.configure(context());
    await flush();
    expect(expired).toHaveBeenCalledOnce();
    fetch.mockClear();
    for (const view of ["admin", "library", "find", "search"]) {
      store.configure(context({ view, key: view }));
      store.refresh();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      key: "search",
      loading: false,
      refreshing: false,
      tracks: [],
    });
  });
});

describe("automatic library refresh triggers", () => {
  function browser() {
    vi.useFakeTimers();
    const events = new EventTarget();
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      setInterval,
      clearInterval,
    });
    vi.stubGlobal("navigator", { onLine: true });
    return events;
  }
  it.each(["focus", "online", "timer"])(
    "refreshes in the background on %s",
    async (trigger) => {
      const events = browser();
      const pending = deferred<Page>();
      const fetch = vi
        .fn<typeof api>()
        .mockResolvedValueOnce(page("old"))
        .mockResolvedValueOnce(page("old"))
        .mockReturnValueOnce(pending.promise);
      const store = createStore(fetch);
      store.configure(context());
      await flush();
      vi.mocked(api).mockResolvedValue([]);
      const stop = watchLibraries(() => store.refresh(), vi.fn());
      await flush();
      const before = store.getSnapshot();
      if (trigger === "timer") vi.advanceTimersByTime(60000);
      else events.dispatchEvent(new Event(trigger));
      await flush();
      expect(store.getSnapshot()).toMatchObject({
        key: "songs",
        loading: false,
        refreshing: true,
      });
      expect(store.getSnapshot().tracks).toBe(before.tracks);
      pending.resolve(page("fresh"));
      await flush();
      expect(store.getSnapshot().tracks[0].title).toBe("fresh");
      stop();
    },
  );
  it("coalesces library requests and cleans up listeners, timers and late results", async () => {
    const events = browser();
    const pending = deferred<[]>();
    vi.mocked(api).mockReturnValue(pending.promise);
    const update = vi.fn();
    const stop = watchLibraries(update, vi.fn());
    events.dispatchEvent(new Event("focus"));
    events.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(60000);
    expect(api).toHaveBeenCalledOnce();
    stop();
    pending.resolve([]);
    await flush();
    events.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(60000);
    expect(api).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
  it("skips offline requests and reports errors without clearing the collection", async () => {
    const events = browser();
    vi.stubGlobal("navigator", { onLine: false });
    const update = vi.fn();
    const error = vi.fn();
    const stop = watchLibraries(update, error);
    expect(api).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
    vi.mocked(api).mockRejectedValue(new Error("Offline"));
    events.dispatchEvent(new Event("online"));
    await flush();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Offline" }),
    );
    expect(update).not.toHaveBeenCalled();
    stop();
  });
});
