// SPDX-License-Identifier: GPL-2.0-or-later
import type { Track } from "./api";

export type Checkpoint = {
  trackId: string;
  position: number;
  revision: number;
  writer: string;
  sequence: number;
};
export type SavedPlayback = Checkpoint & { track: Track | null };
export type LocalCheckpoint = Checkpoint & { dirty: boolean };

export function validCheckpoint(value: unknown): value is LocalCheckpoint {
  if (!value || typeof value !== "object") return false;
  const v = value as LocalCheckpoint;
  return (
    typeof v.trackId === "string" &&
    !!v.trackId &&
    typeof v.writer === "string" &&
    /^[a-f0-9-]{16,64}$/.test(v.writer) &&
    Number.isFinite(v.position) &&
    v.position >= 0 &&
    v.position <= 172800 &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 0 &&
    Number.isSafeInteger(v.sequence) &&
    v.sequence > 0 &&
    typeof v.dirty === "boolean"
  );
}

export function chooseCheckpoint(
  server: SavedPlayback,
  local: LocalCheckpoint | null,
): Checkpoint {
  if (
    local?.dirty &&
    (local.revision === server.revision ||
      (local.writer === server.writer && local.sequence > server.sequence))
  )
    return local;
  return server;
}
