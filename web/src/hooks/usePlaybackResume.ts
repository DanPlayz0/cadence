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
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    let live = true,
      ready = false,
      revision = 0,
      sequence = 0,
      lastAttempt = "";
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
        /* Server progress still works without storage. */
      }
    };
    const mark = (v: { trackId: string; position: number }) =>
      `${v.trackId}:${v.position.toFixed(3)}`;
    const flush = () => {
      if (!live) return;
      const snapshot = player.snapshot();
      if (!snapshot || !Number.isFinite(snapshot.position)) return;
      const checkpoint: LocalCheckpoint = {
        trackId: snapshot.trackId,
        position: Math.min(172800, snapshot.position),
        revision,
        writer,
        sequence: ++sequence,
        dirty: true,
      };
      if (mark(checkpoint) === lastAttempt) return;
      store(checkpoint);
      if (!ready || !navigator.onLine) return;
      lastAttempt = mark(checkpoint);
      const { dirty: _, ...body } = checkpoint;
      // Small authenticated keepalive request; never bypass CSRF protection.
      void api<Checkpoint>("/me/playback", "PUT", body, true)
        .then((saved) => {
          if (!live) return;
          revision = Math.max(revision, saved.revision);
          if (
            local?.writer === writer &&
            local.sequence === checkpoint.sequence
          )
            store({ ...saved, dirty: false });
        })
        .catch(async (error) => {
          if (!live) return;
          if (error instanceof APIError && error.status === 409) {
            try {
              const latest = await api<SavedPlayback>("/me/playback");
              if (live) revision = Math.max(revision, latest.revision);
            } catch {
              /* Retry on subsequent playback activity. */
            }
          } else if (mark(checkpoint) === lastAttempt) lastAttempt = "";
        });
    };
    save.current = flush;
    const before = player.generation();
    void (async () => {
      let chosen: Checkpoint | null = local;
      let track: Track | null = null;
      try {
        const server = await api<SavedPlayback>("/me/playback");
        if (!live) return;
        revision = server.revision;
        // A click during loading takes precedence over restoring saved playback.
        if (player.generation() !== before) return;
        chosen = chooseCheckpoint(server, local);
        if (chosen.trackId === server.trackId) track = server.track;
      } catch (error) {
        if (error instanceof APIError && error.status === 401) return;
        revision = local?.revision ?? 0;
      }
      if (!live || player.generation() !== before || !chosen?.trackId) return;
      try {
        track ??= await api<Track>(
          `/tracks/${encodeURIComponent(chosen.trackId)}`,
        );
        if (!live || player.generation() !== before) return;
        const position =
          track.duration > 0
            ? Math.min(chosen.position, Math.max(0, track.duration - 0.1))
            : chosen.position;
        player.restore(track, position);
        lastAttempt = mark({ trackId: track.id, position });
      } catch {
        /* Removed/excluded tracks and unavailable connections do not block the library. */
      }
    })().finally(() => {
      if (!live) return;
      ready = true;
      if (player.generation() !== before && !lastAttempt) flush();
    });
    const hidden = () => {
      if (document.hidden) flush();
    };
    const timer = window.setInterval(() => {
      if (player.snapshot()?.playing) flush();
    }, 10000);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    return () => {
      live = false;
      save.current = () => {};
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
    };
  }, [userID, player.restore, player.snapshot, player.generation]);
  useEffect(() => {
    const timer = window.setTimeout(() => save.current(), 300);
    return () => clearTimeout(timer);
  }, [userID, player.current?.id, player.playing, player.checkpointVersion]);
}
