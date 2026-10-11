// SPDX-License-Identifier: GPL-2.0-or-later
import { api, APIError, syncSession } from "./api";
import { ListenOutbox, type ListeningEvent } from "../lib/scrobbling";

let outbox: ListenOutbox | undefined;
const memory = new Map<string, string>();
// Storage restrictions must never interrupt playback; keep a per-tab fallback.
const storage: Storage = {
  get length() {
    return memory.size;
  },
  key: (index) => [...memory.keys()][index] ?? null,
  clear: () => memory.clear(),
  removeItem: (key) => {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {}
  },
  getItem: (key) => {
    try {
      return localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem: (key, value) => {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
function queue() {
  if (!outbox)
    outbox = new ListenOutbox(
      storage,
      syncSession,
      (e) => api("/sync/listens", "POST", e),
      (e) => e instanceof APIError && [400, 404, 410].includes(e.status),
    );
  return outbox;
}
export function submitListen(event: ListeningEvent) {
  queue().enqueue(event);
}
export function flushListens() {
  if (navigator.onLine && syncSession().userId) void queue().flush();
}
export function submitNowPlaying(event: ListeningEvent) {
  if (navigator.onLine && syncSession().userId)
    void api("/sync/now-playing", "POST", event).catch(() => {});
}

export type Provider = "lastfm" | "listenbrainz";
export type Preferences = {
  plays: boolean;
  nowPlaying: boolean;
  likes: boolean;
};
export type Connection = Preferences & {
  provider: Provider;
  username: string;
  paused: boolean;
  error: string;
  lastSuccess: string | null;
  pending: number;
  waitingFeedback: number;
};
export type SyncStatus = {
  connections: Connection[];
  lastfmConfigured: boolean;
  lastfmAuthorizationAvailable: boolean;
};
export type ExportStatus = {
  id: string;
  eligible: number;
  previouslySent: number;
  excluded: number;
  pending: number;
  sent: number;
  rejected: number;
  cancelled: number;
  failures?: { title: string; artist: string; error: string }[];
};
