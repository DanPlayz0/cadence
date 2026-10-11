// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { api, APIError, cover, stream, Track } from "../services/api";
import {
  countListening,
  qualifiedListen,
  type SyncPlayback,
} from "../lib/scrobbling";
import { flushListens, submitListen, submitNowPlaying } from "../services/sync";
import { volumeGain } from "../lib/volume";
import { completeBlob, SessionCache } from "../lib/cache";
import {
  playbackPolicy,
  originalCacheMode,
  type Quality,
  type PlaybackBlock,
} from "../lib/playbackPolicy";
export type { Quality } from "../lib/playbackPolicy";
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
  replaceUpcomingSource,
  type PlaybackQueue,
  type PlaybackSource,
  type QueueSection,
} from "../lib/queue";
import { saveQueue } from "../lib/queueSnapshot";
type Resume = {
  sync?: SyncPlayback;
  position: number;
  autoplay: boolean;
  event: string;
  heard: number;
  recorded: boolean;
};
type BlockedPlayback = {
  sequence: number;
  entryId: string;
  reason: PlaybackBlock;
  resume: Resume;
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
  const queueGeneration = useRef(0);
  const updateQueue = useCallback((value: PlaybackQueue) => {
    queueGeneration.current++;
    queueRef.current = value;
    setQueue(value);
    return value;
  }, []);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [quality, setQuality] = useState<Quality>("auto");
  const [allowMP3Session, setAllowMP3Session] = useState(false);
  const mp3Session = useRef(false);
  const mp3Entry = useRef<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedPlayback | null>(null);
  const blockedRef = useRef<BlockedPlayback | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | undefined>();
  const [shuffle, storeShuffle] = useState(false);
  const [repeat, setRepeatState] = useState<"off" | "all" | "one">("off");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [checkpointVersion, setCheckpointVersion] = useState(0);
  const state = useRef({ quality, shuffle, repeat });
  state.current = { quality, shuffle, repeat };
  const setRepeat = useCallback(
    (
      value:
        | "off"
        | "all"
        | "one"
        | ((previous: "off" | "all" | "one") => "off" | "all" | "one"),
    ) => {
      const next =
        typeof value === "function" ? value(state.current.repeat) : value;
      if (next === state.current.repeat) return;
      queueGeneration.current++;
      state.current.repeat = next;
      setRepeatState(next);
    },
    [],
  );
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
    resume: Resume;
    sync: SyncPlayback;
  } | null>(null);
  const pending = useRef(new Map<string, AbortController>());
  const callbacks = useRef({ onError, onExpired });
  callbacks.current = { onError, onExpired };
  const current = queue.current?.track;
  const cacheTrack = useCallback(async (t: Track, mode: string) => {
    const key = `${t.id}:${originalCacheMode(mode)}`;
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
  const stopUnsupported = useCallback((autoplay: boolean) => {
    const v = active.current;
    if (!v) return;
    const a = audio.current;
    const resume = {
      position: v.restorePosition ?? a.currentTime,
      autoplay,
      event: v.event,
      heard: v.heard,
      recorded: v.recorded,
      sync: v.sync,
    };
    const block = {
      sequence: loadSeq.current,
      entryId: queueRef.current.current?.id ?? "",
      reason: "unsupported" as const,
      resume,
    };
    blockedRef.current = block;
    setBlocked(block);
    setSourceLabel(undefined);
    a.pause();
    a.onloadedmetadata = null;
    a.removeAttribute("src");
    a.load();
    v.restorePosition = resume.position;
    setPlaying(false);
  }, []);
  const start = useCallback(
    async (t: Track, forced?: string, resume?: Resume) => {
      const seq = ++loadSeq.current;
      audio.current.pause();
      audio.current.onloadedmetadata = null;
      active.current = null;
      audio.current.removeAttribute("src");
      audio.current.load();
      blockedRef.current = null;
      setBlocked(null);
      setSourceLabel(undefined);
      setPosition(resume?.position ?? 0);
      setLength(t.duration);
      const entryId = queueRef.current.current?.id ?? "";
      if (mp3Entry.current !== entryId) mp3Entry.current = null;
      const policy = playbackPolicy(
        t,
        state.current.quality,
        !!audio.current.canPlayType(t.mime),
        mp3Session.current || mp3Entry.current === entryId,
      );
      let mode =
        state.current.quality === "lossless"
          ? policy.mode
          : (forced ?? policy.mode);
      let cached = cache.current.get(`${t.id}:${originalCacheMode(mode)}`);
      if (!cached && state.current.quality === "auto" && !navigator.onLine) {
        cached = cache.current.get(`${t.id}:high`);
        if (cached) mode = "high";
      }
      const playbackResume = resume ?? {
        position: 0,
        autoplay: true,
        event: eventID(),
        heard: 0,
        recorded: false,
      };
      active.current = {
        track: t,
        mode,
        event: playbackResume.event,
        heard: resume?.heard ?? 0,
        last: resume?.position ?? 0,
        recorded: resume?.recorded ?? false,
        fallback: forced === "high",
        restorePosition: resume?.position ?? 0,
        resume: playbackResume,
        sync: resume?.sync ?? {
          startedAt: 0,
          heard: 0,
          submitted: false,
          nowSent: false,
          position: resume?.position ?? 0,
          wall: performance.now(),
        },
      };
      if (policy.block) {
        const block = {
          sequence: seq,
          entryId,
          reason: policy.block,
          resume: active.current.resume,
        };
        blockedRef.current = block;
        setBlocked(block);
        setPlaying(false);
        return;
      }
      setSourceLabel(policy.label);
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
        if (
          state.current.quality === "lossless" &&
          e instanceof Error &&
          e.name === "NotSupportedError"
        ) {
          stopUnsupported(playbackResume.autoplay);
          return;
        }
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
    [cacheTrack, stopUnsupported],
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
    (
      track: Track | null,
      position: number,
      restored?: PlaybackQueue,
      settings?: { shuffle: boolean; repeat: "off" | "all" | "one" },
    ) => {
      if (settings) {
        state.current.shuffle = settings.shuffle;
        state.current.repeat = settings.repeat;
        storeShuffle(settings.shuffle);
        setRepeatState(settings.repeat);
      }
      updateQueue(
        restored ?? {
          ...emptyQueue(),
          manual: queueRef.current.manual,
          current: track ? queueEntry(track) : null,
        },
      );
      if (track)
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
    const current = queueRef.current.current;
    return {
      trackId: current?.track.id ?? "",
      position:
        current && v
          ? Math.max(0, v.restorePosition ?? audio.current.currentTime)
          : 0,
      playing: !audio.current.paused,
      queue: saveQueue(
        queueRef.current,
        state.current.shuffle,
        state.current.repeat,
      ),
      tracks: Object.fromEntries(
        queueEntries(queueRef.current).map((entry) => [
          entry.track.id,
          entry.track,
        ]),
      ),
    };
  }, []);
  const generation = useCallback(
    () => `${loadSeq.current}:${queueGeneration.current}`,
    [],
  );
  const seek = useCallback((n: number) => {
    if (!Number.isFinite(n)) return;
    const duration = active.current?.track.duration ?? 0;
    const target = Math.max(
      0,
      Math.min(
        n,
        Number.isFinite(audio.current.duration)
          ? audio.current.duration
          : duration || n,
      ),
    );
    if (blockedRef.current) {
      blockedRef.current.resume.position = target;
      if (active.current) active.current.restorePosition = target;
    } else {
      audio.current.currentTime = target;
      if (active.current) {
        active.current.last = target;
        active.current.restorePosition = null;
      }
    }
    setPosition(target);
    setCheckpointVersion((v) => v + 1);
  }, []);
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
    blockedRef.current = null;
    setBlocked(null);
    mp3Entry.current = null;
    mp3Session.current = false;
    setAllowMP3Session(false);
    setSourceLabel(undefined);
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
        blockedRef.current = null;
        setBlocked(null);
        setSourceLabel(undefined);
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
      if (blockedRef.current) return;
      setPosition(a.currentTime);
      const v = active.current;
      if (!v) return;
      const delta = a.currentTime - v.last;
      v.last = a.currentTime;
      if (delta > 0 && delta < 3 && !a.paused) v.heard += delta;
      countListening(
        v.sync,
        a.currentTime,
        performance.now(),
        !a.paused && !a.seeking && a.readyState >= 3,
      );
      const duration = v.track.duration > 0 ? v.track.duration : a.duration;
      if (
        !v.sync.submitted &&
        v.sync.startedAt > 0 &&
        qualifiedListen(duration, v.sync.heard)
      ) {
        v.sync.submitted = true;
        submitListen({
          eventId: v.event,
          trackId: v.track.id,
          startedAt: v.sync.startedAt,
          heard: v.sync.heard,
          duration,
        });
      }
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
    const playing = () => {
      const v = active.current;
      if (!v) return;
      v.sync.position = a.currentTime;
      v.sync.wall = performance.now();
      if (!v.sync.startedAt) v.sync.startedAt = Math.floor(Date.now() / 1000);
      if (!v.sync.nowSent) {
        v.sync.nowSent = true;
        submitNowPlaying({
          eventId: v.event,
          trackId: v.track.id,
          startedAt: v.sync.startedAt,
          heard: 0,
          duration:
            v.track.duration > 0
              ? v.track.duration
              : Number.isFinite(a.duration)
                ? a.duration
                : 0,
        });
      }
    };
    const discontinuity = () => {
      const v = active.current;
      if (v) {
        v.sync.position = a.currentTime;
        v.sync.wall = performance.now();
      }
    };
    const pause = () => setPlaying(false);
    const ended = () => {
      const s = state.current;
      if (s.repeat === "one" && queueRef.current.current)
        void start(queueRef.current.current.track);
      else next();
    };
    const error = () => {
      const v = active.current;
      if (!v || blockedRef.current || !a.src) return;
      if (
        v &&
        state.current.quality === "auto" &&
        v.mode === "original" &&
        !v.fallback &&
        navigator.onLine
      ) {
        void start(v.track, "high", {
          position: a.currentTime,
          autoplay: true,
          event: v.event,
          heard: v.heard,
          recorded: v.recorded,
          sync: v.sync,
        });
        return;
      }
      if (state.current.quality === "lossless") {
        stopUnsupported(!a.paused);
      } else
        callbacks.current.onError(
          "Audio could not be played. Check the connection or try another quality.",
        );
      setPlaying(false);
    };
    a.addEventListener("timeupdate", time);
    a.addEventListener("loadedmetadata", loaded);
    a.addEventListener("play", play);
    a.addEventListener("playing", playing);
    a.addEventListener("seeking", discontinuity);
    a.addEventListener("seeked", discontinuity);
    a.addEventListener("waiting", discontinuity);
    a.addEventListener("pause", pause);
    a.addEventListener("ended", ended);
    a.addEventListener("error", error);
    return () => {
      a.removeEventListener("timeupdate", time);
      a.removeEventListener("loadedmetadata", loaded);
      a.removeEventListener("play", play);
      a.removeEventListener("playing", playing);
      a.removeEventListener("seeking", discontinuity);
      a.removeEventListener("seeked", discontinuity);
      a.removeEventListener("waiting", discontinuity);
      a.removeEventListener("pause", pause);
      a.removeEventListener("ended", ended);
      a.removeEventListener("error", error);
    };
  }, [cacheTrack, start, next, stopUnsupported]);
  useEffect(() => {
    audio.current.volume = volumeGain(volume);
  }, [volume]);
  useEffect(() => {
    const online = () => {
      flushListens();
      setOffline(false);
      void refresh();
    };
    const off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    window.addEventListener("cadence-session", flushListens);
    flushListens();
    const syncTimer = window.setInterval(flushListens, 30000);
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => {
      clearInterval(timer);
      clearInterval(syncTimer);
      window.removeEventListener("cadence-session", flushListens);
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
    navigator.mediaSession.setActionHandler("play", () => {
      if (audio.current.paused) toggle();
    });
    navigator.mediaSession.setActionHandler("pause", () =>
      audio.current.pause(),
    );
    navigator.mediaSession.setActionHandler(
      "nexttrack",
      hasNext(queue, repeat === "all") ? () => next() : null,
    );
    navigator.mediaSession.setActionHandler("previoustrack", () => next(true));
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime !== undefined) seek(d.seekTime);
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
  }, [current, next, playing, length, queue, repeat, toggle, seek]);
  function resumeState(): Resume | undefined {
    const v = active.current;
    if (!v) return undefined;
    return (
      blockedRef.current?.resume ?? {
        position: v.restorePosition ?? audio.current.currentTime,
        autoplay: !audio.current.paused,
        event: v.event,
        heard: v.heard,
        recorded: v.recorded,
        sync: v.sync,
      }
    );
  }
  function resolveBlocked(
    block: BlockedPlayback,
    action: "track" | "session" | "skip",
  ) {
    if (
      blockedRef.current !== block ||
      block.sequence !== loadSeq.current ||
      block.entryId !== queueRef.current.current?.id
    )
      return;
    if (action === "skip") {
      // Skip never wraps back to the blocked track, even under Repeat all.
      const value = advanceQueue(
        queueRef.current,
        false,
        state.current.shuffle,
      );
      blockedRef.current = null;
      setBlocked(null);
      if (value === queueRef.current) {
        updateQueue({
          ...value,
          current: null,
          history: value.current
            ? [...value.history, value.current]
            : value.history,
        });
        active.current = null;
        setSourceLabel(undefined);
        return;
      }
      updateQueue(value);
      if (value.current) void start(value.current.track);
      return;
    }
    if (block.reason !== "mp3") return;
    if (action === "session") {
      mp3Session.current = true;
      setAllowMP3Session(true);
    } else mp3Entry.current = block.entryId;
    void start(queueRef.current.current!.track, undefined, block.resume);
  }
  function changeMP3Session(allowed: boolean) {
    mp3Session.current = allowed;
    setAllowMP3Session(allowed);
    if (!allowed) mp3Entry.current = null;
    const track = queueRef.current.current?.track;
    if (
      state.current.quality === "lossless" &&
      track?.codec.toLowerCase() === "mp3"
    )
      void start(track, undefined, resumeState());
  }
  function changeQuality(q: Quality) {
    state.current.quality = q;
    setQuality(q);
    const v = active.current;
    if (queueRef.current.current && v)
      void start(queueRef.current.current.track, undefined, {
        ...resumeState()!,
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
    blocked,
    resolveBlocked,
    allowMP3Session,
    changeMP3Session,
    sourceLabel,
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
    seek,
    enqueue: (t: Track) =>
      updateQueue({
        ...queueRef.current,
        manual: [...queueRef.current.manual, queueEntry(t)],
      }),
    clearManual: () => updateQueue({ ...queueRef.current, manual: [] }),
    replaceUpcoming: (tracks: Track[], source: PlaybackSource) => {
      const hadCurrent = !!queueRef.current.current;
      const value = replaceUpcomingSource(
        queueRef.current,
        tracks,
        source,
        state.current.shuffle,
      );
      if (value === queueRef.current) return;
      updateQueue(value);
      if (!hadCurrent && value.current) void start(value.current.track);
    },
    cached: (id: string) => cache.current.has(id),
    cacheBytes: cache.current.size,
  };
}
