// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { api, APIError, cover, stream, Track } from "./api";
import { volumeGain } from "./volume";
import { completeBlob, SessionCache } from "./cache";
import { canMoveQueueItem } from "./queue";
export type Quality = "auto" | "high" | "saver";
type Resume = {
  position: number;
  autoplay: boolean;
  event: string;
  heard: number;
  recorded: boolean;
};
function eventID() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : [...crypto.getRandomValues(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
export function usePlayer(
  onError: (message: string) => void,
  onExpired: () => void,
) {
  const [audioElement] = useState(() => new Audio());
  const [sessionCache] = useState(() => new SessionCache());
  const audio = useRef(audioElement);
  const cache = useRef(sessionCache);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [quality, setQuality] = useState<Quality>("auto");
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cacheVersion, setCacheVersion] = useState(0);
  const state = useRef({ queue, index, quality, shuffle, repeat });
  state.current = { queue, index, quality, shuffle, repeat };
  const loadSeq = useRef(0);
  const active = useRef<{
    track: Track;
    mode: string;
    event: string;
    heard: number;
    last: number;
    recorded: boolean;
    fallback: boolean;
  } | null>(null);
  const pending = useRef(new Map<string, AbortController>());
  const callbacks = useRef({ onError, onExpired });
  callbacks.current = { onError, onExpired };
  const current = queue[index];
  const modeFor = useCallback(
    (t: Track, q: Quality) =>
      q === "auto"
        ? audio.current.canPlayType(t.mime)
          ? "original"
          : "high"
        : q,
    [],
  );
  const cacheTrack = useCallback(async (t: Track, mode: string) => {
    const key = `${t.id}:${mode}`;
    if (cache.current.get(key) || pending.current.size >= 1) return;
    const controller = new AbortController();
    pending.current.set(key, controller);
    try {
      const res = await fetch(stream(t.id, mode), {
        signal: controller.signal,
      });
      const blob = await completeBlob(res);
      if (!controller.signal.aborted && cache.current.put(key, t.id, blob))
        setCacheVersion((v) => v + 1);
    } catch {
      /* Caching is opportunistic; playback errors are handled by the audio element. */
    } finally {
      if (pending.current.get(key) === controller) pending.current.delete(key);
    }
  }, []);
  const start = useCallback(
    async (t: Track, idx: number, forced?: string, resume?: Resume) => {
      const seq = ++loadSeq.current;
      audio.current.pause();
      audio.current.onloadedmetadata = null;
      setPosition(resume?.position ?? 0);
      setLength(t.duration);
      setIndex(idx);
      let mode = forced ?? modeFor(t, state.current.quality);
      let cached = cache.current.get(`${t.id}:${mode}`);
      if (!cached && state.current.quality === "auto" && !navigator.onLine) {
        cached = cache.current.get(`${t.id}:high`);
        if (cached) mode = "high";
      }
      active.current = {
        track: t,
        mode,
        event: resume?.event ?? eventID(),
        heard: resume?.heard ?? 0,
        last: resume?.position ?? 0,
        recorded: resume?.recorded ?? false,
        fallback: forced === "high",
      };
      try {
        if (navigator.onLine) {
          try {
            await api(`/tracks/${t.id}`);
            setOffline(false);
          } catch (e) {
            if (e instanceof APIError) throw e;
            if (!cached && state.current.quality === "auto") {
              cached = cache.current.get(`${t.id}:high`);
              if (cached) {
                mode = "high";
                if (active.current) active.current.mode = mode;
              }
            }
            if (!cached) throw e;
            setOffline(true);
          }
        }
        if (!navigator.onLine && !cached)
          throw new Error(
            "This track is not available in the temporary session cache.",
          );
        if (seq !== loadSeq.current) return;
        if (resume && resume.position > 0)
          audio.current.onloadedmetadata = () => {
            if (seq === loadSeq.current) {
              audio.current.currentTime = Math.min(
                resume.position,
                Math.max(0, audio.current.duration - 0.1),
              );
              audio.current.onloadedmetadata = null;
            }
          };
        audio.current.src = cached ?? stream(t.id, mode);
        audio.current.load();
        if (resume?.autoplay !== false) await audio.current.play();
        if (resume?.recorded && navigator.onLine) void cacheTrack(t, mode);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        if (e instanceof APIError && e.status === 401) {
          callbacks.current.onExpired();
          return;
        }
        callbacks.current.onError(
          e instanceof Error ? e.message : "Playback failed",
        );
        setPlaying(false);
      }
    },
    [modeFor, cacheTrack],
  );
  const next = useCallback(
    (back = false) => {
      const s = state.current;
      if (!s.queue.length) return;
      let idx = s.index + (back ? -1 : 1);
      if (s.shuffle && s.queue.length > 1) {
        do {
          idx = Math.floor(Math.random() * s.queue.length);
        } while (idx === s.index);
      }
      if (idx >= s.queue.length) {
        if (s.repeat === "all") idx = 0;
        else {
          audio.current.pause();
          return;
        }
      }
      if (idx < 0) idx = s.queue.length - 1;
      void start(s.queue[idx], idx);
    },
    [start],
  );
  const play = useCallback(
    (tracks: Track[], idx = 0) => {
      if (!tracks[idx]) return;
      state.current.queue = tracks;
      state.current.index = idx;
      setQueue(tracks);
      void start(tracks[idx], idx);
    },
    [start],
  );
  const toggle = useCallback(() => {
    if (!audio.current.src) return;
    if (audio.current.paused)
      void audio.current
        .play()
        .catch((e) => callbacks.current.onError(e.message));
    else audio.current.pause();
  }, []);
  const clear = useCallback(() => {
    loadSeq.current++;
    audio.current.pause();
    audio.current.removeAttribute("src");
    audio.current.load();
    cache.current.clear();
    for (const c of pending.current.values()) c.abort();
    pending.current.clear();
    setQueue([]);
    setIndex(-1);
    active.current = null;
    setCacheVersion((v) => v + 1);
  }, []);
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    const ids = [
      ...new Set([
        ...cache.current.keys(),
        ...state.current.queue.map((t) => t.id),
      ]),
    ];
    try {
      const allowed = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const v = await api<{ allowed: string[] }>(
          "/permissions/check",
          "POST",
          { ids: ids.slice(i, i + 500) },
        );
        v.allowed.forEach((id) => allowed.add(id));
      }
      cache.current.retain(allowed);
      for (const [key, c] of pending.current)
        if (!allowed.has(key.split(":")[0])) {
          c.abort();
          pending.current.delete(key);
        }
      const old = state.current;
      const nextQueue = old.queue.filter((t) => allowed.has(t.id));
      const activeId = active.current?.track.id;
      setQueue(nextQueue);
      setIndex(
        activeId && allowed.has(activeId) && old.index >= 0
          ? old.queue.slice(0, old.index).filter((t) => allowed.has(t.id))
              .length
          : -1,
      );
      if (activeId && !allowed.has(activeId)) {
        audio.current.pause();
        audio.current.removeAttribute("src");
        active.current = null;
        callbacks.current.onError("Access to the current track has changed.");
      }
      setCacheVersion((v) => v + 1);
    } catch (e) {
      if (e instanceof APIError && e.status === 401) {
        clear();
        callbacks.current.onExpired();
      }
    }
  }, [clear]);
  useEffect(() => {
    const a = audio.current;
    const time = () => {
      setPosition(a.currentTime);
      const v = active.current;
      if (!v) return;
      const delta = a.currentTime - v.last;
      v.last = a.currentTime;
      if (delta > 0 && delta < 3 && !a.paused) v.heard += delta;
      const threshold = Math.min(
        30,
        Math.max(1, (a.duration || v.track.duration) / 2),
      );
      if (!v.recorded && v.heard >= threshold) {
        v.recorded = true;
        if (navigator.onLine) {
          void api(`/tracks/${v.track.id}/plays`, "POST", {
            eventId: v.event,
          }).catch(() => {});
          void cacheTrack(v.track, v.mode);
        }
      }
    };
    const loaded = () =>
      setLength(
        Number.isFinite(a.duration)
          ? a.duration
          : (active.current?.track.duration ?? 0),
      );
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const ended = () => {
      const s = state.current;
      if (s.repeat === "one" && s.queue[s.index])
        void start(s.queue[s.index], s.index);
      else next();
    };
    const error = () => {
      const v = active.current;
      if (v && v.mode === "original" && !v.fallback && navigator.onLine) {
        void start(v.track, state.current.index, "high", {
          position: a.currentTime,
          autoplay: true,
          event: v.event,
          heard: v.heard,
          recorded: v.recorded,
        });
        return;
      }
      callbacks.current.onError(
        "Audio could not be played. Check the connection or try another quality.",
      );
      setPlaying(false);
    };
    a.addEventListener("timeupdate", time);
    a.addEventListener("loadedmetadata", loaded);
    a.addEventListener("play", play);
    a.addEventListener("pause", pause);
    a.addEventListener("ended", ended);
    a.addEventListener("error", error);
    return () => {
      a.removeEventListener("timeupdate", time);
      a.removeEventListener("loadedmetadata", loaded);
      a.removeEventListener("play", play);
      a.removeEventListener("pause", pause);
      a.removeEventListener("ended", ended);
      a.removeEventListener("error", error);
    };
  }, [cacheTrack, start, next]);
  useEffect(() => {
    audio.current.volume = volumeGain(volume);
  }, [volume]);
  useEffect(() => {
    const online = () => {
      setOffline(false);
      void refresh();
    };
    const off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      clear();
    };
  }, [refresh, clear]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: current.artwork
        ? [{ src: new URL(cover(current.id), location.origin).href }]
        : [],
    });
    navigator.mediaSession.setActionHandler(
      "play",
      () => void audio.current.play(),
    );
    navigator.mediaSession.setActionHandler("pause", () =>
      audio.current.pause(),
    );
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("previoustrack", () => next(true));
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime !== undefined) audio.current.currentTime = d.seekTime;
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [current, next, playing]);
  function changeQuality(q: Quality) {
    state.current.quality = q;
    setQuality(q);
    const s = state.current;
    const v = active.current;
    if (s.queue[s.index] && v)
      void start(s.queue[s.index], s.index, undefined, {
        position: audio.current.currentTime,
        autoplay: !audio.current.paused,
        event: v.event,
        heard: v.heard,
        recorded: v.recorded,
      });
  }
  function remove(idx: number) {
    if (idx === state.current.index) {
      audio.current.pause();
      active.current = null;
      setIndex(-1);
    } else if (idx < state.current.index) setIndex((i) => i - 1);
    setQueue((q) => q.filter((_, i) => i !== idx));
  }
  function move(idx: number, direction: number) {
    const q = [...state.current.queue];
    const target = idx + direction;
    if (!canMoveQueueItem(idx, direction, state.current.index, q.length))
      return;
    [q[idx], q[target]] = [q[target], q[idx]];
    const i = state.current.index;
    setQueue(q);
    if (i === idx) setIndex(target);
    else if (i === target) setIndex(idx);
  }
  return {
    queue,
    index,
    current,
    playing,
    position,
    length,
    volume,
    setVolume,
    quality,
    changeQuality,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    offline,
    cacheVersion,
    play,
    toggle,
    next,
    clear,
    refresh,
    remove,
    move,
    seek: (n: number) => {
      if (!Number.isFinite(n)) return;
      const target = Math.max(0, Math.min(n, length || n));
      audio.current.currentTime = target;
      setPosition(target);
    },
    enqueue: (t: Track) => setQueue((q) => [...q, t]),
    cached: (id: string) => cache.current.has(id),
    cacheBytes: cache.current.size,
  };
}
