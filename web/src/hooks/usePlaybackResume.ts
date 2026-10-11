// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef } from "react";
import { api, APIError, type Track } from "../services/api";
import type { usePlayer } from "./usePlayer";
import {
  chooseCheckpoint,
  validCheckpoint,
  type Checkpoint,
  type LocalCheckpoint,
  type SavedPlayback,
} from "../lib/playbackCheckpoint";
import { restoreQueue, savedEntries } from "../lib/queueSnapshot";

export function usePlaybackResume(
  player: ReturnType<typeof usePlayer>,
  userID: string | undefined,
) {
  const save = useRef<() => void>(() => {});
  useEffect(() => {
    if (!userID) return;
    const key = `cadence:playback:${userID}`;
    const writer =
      crypto.randomUUID?.() ??
      [...crypto.getRandomValues(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    let live = true,
      ready = false,
      pending = false,
      revision = 0,
      sequence = 0,
      lastAttempt = "",
      syncedQueue = "";
    let local: LocalCheckpoint | null = null;
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
      if (validCheckpoint(value)) local = value;
    } catch {
      /* Storage is optional. */
    }
    const store = (value: LocalCheckpoint) => {
      local = value;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Server saving still works. */
      }
    };
    const mark = (v: {
      trackId: string;
      position: number;
      queue?: Checkpoint["queue"];
    }) => `${v.trackId}:${v.position.toFixed(3)}:${JSON.stringify(v.queue)}`;
    const flush = (unloading = false) => {
      if (!live) return;
      if (!ready && player.generation() === before) return;
      const snapshot = player.snapshot();
      if (!Number.isFinite(snapshot.position)) return;
      // A failed initial read must not turn an untouched empty player into a
      // checkpoint that later overwrites a saved queue when connectivity returns.
      if (
        player.generation() === before &&
        !savedEntries(snapshot.queue).length
      )
        return;
      const requestMark = mark(snapshot);
      if (
        requestMark === lastAttempt &&
        (!local?.dirty || mark(local) === requestMark)
      )
        return;
      const checkpoint: LocalCheckpoint = {
        trackId: snapshot.trackId,
        queue: snapshot.queue,
        tracks: snapshot.tracks,
        position: Math.min(172800, snapshot.position),
        revision,
        writer,
        sequence: ++sequence,
        dirty: true,
      };
      store(checkpoint);
      if (!ready || pending || !navigator.onLine || requestMark === lastAttempt)
        return;
      const { dirty: _, tracks: __, ...body } = checkpoint;
      const queueMark = JSON.stringify(body.queue);
      if (
        unloading &&
        new TextEncoder().encode(JSON.stringify(body)).length > 48000
      ) {
        // Never let progress-only unloads overtake an unsaved queue replacement.
        if (queueMark !== syncedQueue || !body.trackId) return;
        delete body.queue;
      }
      pending = true;
      lastAttempt = requestMark;
      void api<Checkpoint>("/me/playback", "PUT", body, unloading)
        .then((saved) => {
          if (!live) return;
          revision = Math.max(revision, saved.revision);
          if (body.queue) syncedQueue = queueMark;
          if (local?.writer === writer && mark(local) === requestMark)
            store({ ...checkpoint, revision: saved.revision, dirty: false });
        })
        .catch(async (error) => {
          if (!live) return;
          lastAttempt = "";
          if (error instanceof APIError && error.status === 409) {
            try {
              const latest = await api<SavedPlayback>("/me/playback");
              if (live) revision = Math.max(revision, latest.revision);
            } catch {
              /* Retry on subsequent activity. */
            }
          }
        })
        .finally(() => {
          pending = false;
          if (live && mark(player.snapshot()) !== requestMark) flush();
        });
    };
    save.current = flush;
    const before = player.generation();
    void (async () => {
      let chosen: Checkpoint | null = local;
      let server: SavedPlayback | null = null;
      try {
        server = await api<SavedPlayback>("/me/playback");
        if (!live) return;
        revision = server.revision;
        if (player.generation() !== before) return;
        chosen = chooseCheckpoint(server, local);
        syncedQueue = JSON.stringify(server.queue);
      } catch (error) {
        if (error instanceof APIError && error.status === 401) return;
        revision = local?.revision ?? 0;
      }
      if (!live || player.generation() !== before || !chosen) return;
      const tracks: Record<string, Track> = {};
      const ids = [
        ...new Set(
          chosen.queue
            ? savedEntries(chosen.queue).map((e) => e.trackId)
            : chosen.trackId
              ? [chosen.trackId]
              : [],
        ),
      ];
      const serverChosen = chosen === server;
      for (let offset = 0; offset < ids.length; offset += 8) {
        await Promise.all(
          ids.slice(offset, offset + 8).map(async (id) => {
            const hydrated =
              server?.tracks?.[id] ??
              (server?.track?.id === id ? server.track : null);
            if (hydrated) {
              tracks[id] = hydrated;
              return;
            }
            if (serverChosen) return;
            try {
              tracks[id] = await api<Track>(
                `/tracks/${encodeURIComponent(id)}`,
              );
            } catch (error) {
              if (!(error instanceof APIError) && local?.tracks?.[id])
                tracks[id] = local.tracks[id];
            }
          }),
        );
        if (!live || player.generation() !== before) return;
      }
      if (!live || player.generation() !== before) return;
      const queue = chosen.queue
        ? restoreQueue(chosen.queue, tracks)
        : undefined;
      const track = queue
        ? (queue.current?.track ?? null)
        : (tracks[chosen.trackId] ?? null);
      if (!queue && !track) return;
      const position = track?.duration
        ? Math.min(chosen.position, Math.max(0, track.duration - 0.1))
        : chosen.position;
      player.restore(track, position, queue, chosen.queue);
      if (serverChosen) {
        // Normalize server JSON into the client's field order before comparing
        // snapshots for bounded unload saves.
        const restored = player.snapshot();
        syncedQueue = JSON.stringify(restored.queue);
        lastAttempt = mark(restored);
        store({
          trackId: restored.trackId,
          position: restored.position,
          queue: restored.queue,
          tracks: restored.tracks,
          revision: chosen.revision,
          writer: chosen.writer,
          sequence: chosen.sequence,
          dirty: false,
        });
      }
    })().finally(() => {
      if (!live) return;
      ready = true;
      if (player.generation() !== before && !lastAttempt) flush();
    });
    const hidden = () => {
      if (document.hidden) flush(true);
    };
    const pagehide = () => flush(true);
    const online = () => flush();
    const timer = window.setInterval(() => {
      if (player.snapshot().playing || local?.dirty) flush();
    }, 10000);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("online", online);
    return () => {
      live = false;
      save.current = () => {};
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("online", online);
    };
  }, [userID, player.restore, player.snapshot, player.generation]);
  useEffect(() => {
    const timer = window.setTimeout(() => save.current(), 300);
    return () => clearTimeout(timer);
  }, [
    userID,
    player.queue,
    player.shuffle,
    player.repeat,
    player.playing,
    player.checkpointVersion,
  ]);
}
