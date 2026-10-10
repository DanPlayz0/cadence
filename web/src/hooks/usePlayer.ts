// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { api, APIError, cover, stream, Track } from "../services/api";
import { volumeGain } from "../lib/volume";
import { completeBlob, SessionCache } from "../lib/cache";
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
  type PlaybackQueue,
  type PlaybackSource,
  type QueueSection,
} from "../lib/queue";
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
  const [queue, setQueue] = useState(emptyQueue);
  const queueRef = useRef(queue);
  const updateQueue = useCallback((value: PlaybackQueue) => {
    queueRef.current = value;
    setQueue(value);
    return value;
  }, []);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [quality, setQuality] = useState<Quality>("auto");
  const [shuffle, storeShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [checkpointVersion, setCheckpointVersion] = useState(0);
  const state = useRef({ quality, shuffle, repeat });
  state.current = { quality, shuffle, repeat };
  const loadSeq = useRef(0);
  const sessionGeneration = useRef(0);
  const active = useRef<{
    track: Track;
    mode: string;
    event: string;
    heard: number;
    last: number;
    recorded: boolean;
    fallback: boolean;
    restorePosition: number | null;
  } | null>(null);
  const pending = useRef(new Map<string, AbortController>());
  const callbacks = useRef({ onError, onExpired });
  callbacks.current = { onError, onExpired };
  const current = queue.current?.track;
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
    async (t: Track, forced?: string, resume?: Resume) => {
      const seq = ++loadSeq.current;
      audio.current.pause();
      audio.current.onloadedmetadata = null;
      setPosition(resume?.position ?? 0);
      setLength(t.duration);
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
        restorePosition: resume?.position ?? 0,
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
        audio.current.onloadedmetadata = () => {
          if (seq === loadSeq.current) {
            const duration = Number.isFinite(audio.current.duration)
              ? audio.current.duration
              : t.duration;
            audio.current.currentTime = Math.min(
              resume?.position ?? 0,
              Math.max(0, duration - 0.1),
            );
            if (active.current) active.current.restorePosition = null;
            setPosition(audio.current.currentTime);
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
      const q = queueRef.current;
      if (
        back &&
        q.current &&
        (audio.current.currentTime >= 3 || !q.history.length)
      ) {
        audio.current.currentTime = 0;
        if (active.current) {
          active.current.last = 0;
          active.current.restorePosition = null;
        }
        setPosition(0);
        setCheckpointVersion((v) => v + 1);
        return;
      }
      const value = back
        ? previousQueue(q)
        : advanceQueue(
            q,
            state.current.repeat === "all",
            state.current.shuffle,
          );
      if (value === q) {
        if (!back) audio.current.pause();
        return;
      }
      updateQueue(value);
      if (value.current) void start(value.current.track);
    },
    [start, updateQueue],
  );
  const play = useCallback(
    (tracks: Track[], idx = 0, source?: PlaybackSource) => {
      const value = startQueue(
        queueRef.current,
        tracks,
        idx,
        source,
        state.current.shuffle,
      );
      if (value === queueRef.current) return;
      updateQueue(value);
      if (value.current) void start(value.current.track);
    },
    [start, updateQueue],
  );
  const restore = useCallback(
    (track: Track, position: number) => {
      updateQueue({
        ...emptyQueue(),
        manual: queueRef.current.manual,
        current: queueEntry(track),
      });
      void start(track, undefined, {
        position,
        autoplay: false,
        event: eventID(),
        heard: 0,
        recorded: false,
      });
    },
    [start, updateQueue],
  );
  const jump = useCallback(
    (section: QueueSection, id: string, keepEarlier = false) => {
      const value = jumpQueue(queueRef.current, section, id, keepEarlier);
      if (value === queueRef.current) return;
      updateQueue(value);
      if (value.current) void start(value.current.track);
    },
    [start, updateQueue],
  );
  const snapshot = useCallback(() => {
    const v = active.current;
    return v
      ? {
          trackId: v.track.id,
          position: Math.max(0, v.restorePosition ?? audio.current.currentTime),
          playing: !audio.current.paused,
        }
      : null;
  }, []);
  const generation = useCallback(() => loadSeq.current, []);
  const toggle = useCallback(() => {
    if (!queueRef.current.current) {
      next();
      return;
    }
    if (!audio.current.src) return;
    if (audio.current.paused)
      void audio.current
        .play()
        .catch((e) => callbacks.current.onError(e.message));
    else audio.current.pause();
  }, [next]);
  const clear = useCallback(() => {
    sessionGeneration.current++;
    loadSeq.current++;
    audio.current.pause();
    audio.current.removeAttribute("src");
    audio.current.load();
    cache.current.clear();
    for (const c of pending.current.values()) c.abort();
    pending.current.clear();
    updateQueue(emptyQueue());
    setPosition(0);
    setLength(0);
    setPlaying(false);
    active.current = null;
    setCacheVersion((v) => v + 1);
  }, [updateQueue]);
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return;
    const ids = [
      ...new Set([
        ...cache.current.keys(),
        ...queueEntries(queueRef.current).map((entry) => entry.track.id),
      ]),
    ];
    const checked = new Set(ids);
    const checkedSession = sessionGeneration.current;
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
      // Apply checks to the latest queue without discarding entries added during the request.
      if (checkedSession !== sessionGeneration.current) return;
      cache.current.retain(
        new Set([
          ...allowed,
          ...cache.current.keys().filter((id) => !checked.has(id)),
        ]),
      );
      for (const [key, c] of pending.current)
        if (checked.has(key.split(":")[0]) && !allowed.has(key.split(":")[0])) {
          c.abort();
          pending.current.delete(key);
        }
      updateQueue(
        retainQueue(
          queueRef.current,
          (id) => !checked.has(id) || allowed.has(id),
        ),
      );
      const activeId = active.current?.track.id;
      if (activeId && checked.has(activeId) && !allowed.has(activeId)) {
        loadSeq.current++;
        audio.current.pause();
        audio.current.onloadedmetadata = null;
        audio.current.removeAttribute("src");
        audio.current.load();
        active.current = null;
        setPlaying(false);
        setPosition(0);
        setLength(0);
        callbacks.current.onError("Access to the current track has changed.");
      }
      setCacheVersion((v) => v + 1);
    } catch (e) {
      if (checkedSession !== sessionGeneration.current) return;
      if (e instanceof APIError && e.status === 401) {
        clear();
        callbacks.current.onExpired();
      }
    }
  }, [clear, updateQueue]);
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
      if (s.repeat === "one" && queueRef.current.current)
        void start(queueRef.current.current.track);
      else next();
    };
    const error = () => {
      const v = active.current;
      if (v && v.mode === "original" && !v.fallback && navigator.onLine) {
        void start(v.track, "high", {
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
    if (!("mediaSession" in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      for (const action of [
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
        "seekto",
      ] as MediaSessionAction[])
        navigator.mediaSession.setActionHandler(action, null);
      return;
    }
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
    navigator.mediaSession.setActionHandler(
      "nexttrack",
      hasNext(queue, repeat === "all") ? () => next() : null,
    );
    navigator.mediaSession.setActionHandler("previoustrack", () => next(true));
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime !== undefined && Number.isFinite(d.seekTime)) {
        audio.current.currentTime = Math.max(
          0,
          Math.min(d.seekTime, length || d.seekTime),
        );
        if (active.current) active.current.restorePosition = null;
        setPosition(audio.current.currentTime);
        setCheckpointVersion((v) => v + 1);
      }
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    return () => {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      for (const action of [
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
        "seekto",
      ] as MediaSessionAction[])
        navigator.mediaSession.setActionHandler(action, null);
    };
  }, [current, next, playing, length, queue, repeat]);
  function changeQuality(q: Quality) {
    state.current.quality = q;
    setQuality(q);
    const v = active.current;
    if (queueRef.current.current && v)
      void start(queueRef.current.current.track, undefined, {
        position: audio.current.currentTime,
        autoplay: !audio.current.paused,
        event: v.event,
        heard: v.heard,
        recorded: v.recorded,
      });
  }
  function remove(section: QueueSection, id: string) {
    updateQueue(removeQueueEntry(queueRef.current, section, id));
  }
  function reorder(section: QueueSection, id: string, targetId: string) {
    updateQueue(reorderQueue(queueRef.current, section, id, targetId));
  }
  function move(section: QueueSection, id: string, direction: number) {
    if (direction !== -1 && direction !== 1) return;
    const entries = queueRef.current[section];
    const index = entries.findIndex((entry) => entry.id === id);
    const target = entries[index + direction];
    if (index >= 0 && target) reorder(section, id, target.id);
  }
  function setShuffle(value: boolean | ((previous: boolean) => boolean)) {
    const enabled =
      typeof value === "function" ? value(state.current.shuffle) : value;
    if (enabled === state.current.shuffle) return;
    state.current.shuffle = enabled;
    storeShuffle(enabled);
    updateQueue(shuffleRemaining(queueRef.current, enabled));
  }
  return {
    queue,
    current,
    canPrevious: !!current,
    canNext: hasNext(queue, repeat === "all"),
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
    restore,
    snapshot,
    generation,
    checkpointVersion,
    toggle,
    next,
    clear,
    refresh,
    remove,
    move,
    reorder,
    jump,
    seek: (n: number) => {
      if (!Number.isFinite(n)) return;
      const target = Math.max(0, Math.min(n, length || n));
      audio.current.currentTime = target;
      if (active.current) active.current.restorePosition = null;
      setPosition(target);
      setCheckpointVersion((v) => v + 1);
    },
    enqueue: (t: Track) =>
      updateQueue({
        ...queueRef.current,
        manual: [...queueRef.current.manual, queueEntry(t)],
      }),
    cached: (id: string) => cache.current.has(id),
    cacheBytes: cache.current.size,
  };
}
