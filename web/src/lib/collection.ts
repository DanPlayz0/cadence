// SPDX-License-Identifier: GPL-2.0-or-later
import {
  api,
  APIError,
  type Album,
  type Artist,
  type Page,
  type Track,
} from "../services/api";
import type { LibrarySummary } from "./libraries";

export type CollectionContext = {
  userId?: string;
  key: string;
  view: string;
  query: string;
  debounced: string;
  libraryId: string;
  albumId?: string;
  artist: string;
  reload: number;
};
const empty = () => ({
  albums: [] as Album[],
  artists: [] as Artist[],
  tracks: [] as Track[],
  total: 0,
  offset: 0,
  more: false,
});
export type CollectionState = ReturnType<typeof empty> & {
  userId?: string;
  key: string;
  loading: boolean;
  refreshing: boolean;
  error: { key: string; message: string } | null;
};

// Owns request ordering and atomic page replacement independently of rendering.
export class CollectionStore {
  private state: CollectionState = {
    ...empty(),
    key: "",
    loading: false,
    refreshing: false,
    error: null,
  };
  private context?: CollectionContext;
  private generation = 0;
  private listeners = new Set<() => void>();
  private cache = new Map<string, CollectionState>();
  private pendingRefresh = false;
  constructor(
    private fetch = api,
    private onExpired = () => {},
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: CollectionState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private remember() {
    if (!this.state.key || this.state.loading || this.state.refreshing) return;
    this.cache.set(this.state.key, this.state);
    if (this.cache.size > 20)
      this.cache.delete(this.cache.keys().next().value!);
  }
  invalidate = (clearDisplayed = false) => {
    const interruptedLoad = this.state.loading;
    ++this.generation;
    this.pendingRefresh = false;
    this.cache.clear();
    this.publish({
      ...this.state,
      ...(clearDisplayed ? { ...empty(), key: "", error: null } : {}),
      loading: false,
      refreshing: false,
    });
    // A mutation during an initial load must not leave its placeholder stranded.
    if (interruptedLoad && !clearDisplayed) this.refresh();
  };
  setTracks = (update: Track[] | ((tracks: Track[]) => Track[])) => {
    this.invalidate();
    this.publish({
      ...this.state,
      tracks: typeof update === "function" ? update(this.state.tracks) : update,
    });
    this.remember();
  };
  configure(next: CollectionContext) {
    const previous = this.context;
    const changedUser = previous?.userId !== next.userId;
    const reload = previous?.reload !== next.reload;
    this.remember();
    ++this.generation;
    this.pendingRefresh = false;
    this.context = next;
    if (changedUser || reload) this.cache.clear();
    if (changedUser)
      this.publish({
        ...empty(),
        userId: next.userId,
        key: "",
        loading: false,
        refreshing: false,
        error: null,
      });
    if (!next.userId || ["admin", "find", "library"].includes(next.view)) {
      this.publish({ ...this.state, loading: false, refreshing: false });
      return;
    }
    if (next.query !== next.debounced) {
      this.publish({ ...this.state, loading: true, refreshing: false });
      return;
    }
    if (next.view === "search" && !next.query) {
      this.publish({
        ...empty(),
        userId: next.userId,
        key: next.key,
        loading: false,
        refreshing: false,
        error: null,
      });
      return;
    }
    const cached = this.cache.get(next.key);
    if (cached && !reload) {
      this.publish(cached);
      return;
    }
    void this.load(false);
  }
  refresh = () => {
    this.cache.clear();
    if (
      !this.context?.userId ||
      ["admin", "find", "library"].includes(this.context.view)
    )
      return;
    if (this.context.query !== this.context.debounced) return;
    // An initial fetch already obtains current data. Pagination gets a full refresh afterwards.
    if (this.state.loading || this.state.refreshing) {
      if (this.state.loading && this.state.key === this.context.key)
        this.pendingRefresh = true;
      return;
    }
    if (this.context.view === "search" && !this.context.query) return;
    void this.load(false);
  };
  loadMore = async () => {
    if (
      !this.context ||
      this.state.key !== this.context.key ||
      !this.state.more ||
      this.state.loading
    )
      return;
    this.pendingRefresh = this.state.refreshing;
    await this.load(true);
  };
  private async load(append: boolean) {
    const context = this.context!;
    const id = ++this.generation;
    const current = this.state;
    const retained =
      current.key === context.key && current.userId === context.userId;
    const background = retained && !append;
    const finalOffset = retained ? current.offset : 0;
    let result = append
      ? {
          albums: current.albums,
          artists: current.artists,
          tracks: current.tracks,
          total: current.total,
          offset: current.offset,
          more: current.more,
        }
      : empty();
    this.publish({
      ...current,
      loading: !background,
      refreshing: background,
      error: null,
    });
    try {
      for (
        let offset = append ? current.offset + 100 : 0;
        offset <= (append ? current.offset + 100 : finalOffset);
        offset += 100
      ) {
        const params = new URLSearchParams({
          limit: "100",
          offset: String(offset),
          q: context.debounced,
        });
        if (context.libraryId) params.set("libraryId", context.libraryId);
        if (context.albumId) params.set("album", context.albumId);
        if (context.artist) params.set("artist", context.artist);
        if (["likes", "history"].includes(context.view))
          params.set("collection", context.view);
        if (context.view.startsWith("playlist:"))
          params.set("playlist", context.view.slice(9));
        if (context.view === "home" || context.view === "albums") {
          const items = await this.fetch<Album[]>(`/albums?${params}`);
          result = {
            ...result,
            albums: [...result.albums, ...items],
            offset,
            more: items.length === 100,
          };
        } else if (context.view === "artists") {
          const items = await this.fetch<Artist[]>(`/artists?${params}`);
          result = {
            ...result,
            artists: [...result.artists, ...items],
            offset,
            more: items.length === 100,
          };
        } else {
          const page = await this.fetch<Page>(`/tracks?${params}`);
          result = {
            ...result,
            tracks: [...result.tracks, ...page.items],
            total: page.total,
            offset,
            more: offset + page.items.length < page.total,
          };
        }
        if (id !== this.generation) return;
        if (!result.more) break;
      }
      this.publish({
        ...result,
        key: context.key,
        userId: context.userId,
        loading: false,
        refreshing: false,
        error: null,
      });
      this.remember();
    } catch (error) {
      if (id !== this.generation) return;
      if (error instanceof APIError && error.status === 401) this.onExpired();
      else
        this.publish({
          ...this.state,
          error: { key: context.key, message: (error as Error).message },
        });
    } finally {
      if (id === this.generation) {
        this.publish({ ...this.state, loading: false, refreshing: false });
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.refresh();
        }
      }
    }
  }
  dispose = () => {
    ++this.generation;
    this.pendingRefresh = false;
  };
}

// Focus, reconnect and polling share one in-flight library request.
export function watchLibraries(
  update: (libraries: LibrarySummary[]) => void,
  onError: (error: Error) => void,
) {
  let live = true;
  let busy = false;
  const refresh = async () => {
    if (!live || busy || !navigator.onLine) return;
    busy = true;
    try {
      const libraries = await api<LibrarySummary[]>("/libraries");
      if (live) update(libraries);
    } catch (error) {
      if (live) onError(error as Error);
    } finally {
      busy = false;
    }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 60000);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  return () => {
    live = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("online", refresh);
  };
}
