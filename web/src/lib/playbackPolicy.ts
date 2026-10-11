// SPDX-License-Identifier: GPL-2.0-or-later
import type { Track } from "../services/api";

export type Quality = "auto" | "high" | "saver" | "lossless";
export type PlaybackBlock = "mp3" | "lossy" | "unsupported";
export function losslessCodec(codec: string): string | null {
  const value = codec.toLowerCase();
  if (value === "flac") return "FLAC";
  if (value === "alac") return "ALAC";
  // FFprobe also calls companded A-law/mu-law codecs PCM; these are lossy.
  if (
    /^pcm_(?:s|u)(?:8|16|24|32|64)(?:le|be)?$/.test(value) ||
    /^pcm_f(?:32|64)(?:le|be)$/.test(value)
  )
    return "PCM";
  return null;
}
export function playbackPolicy(
  track: Pick<Track, "codec" | "mime">,
  quality: Quality,
  supported: boolean,
  allowMP3 = false,
): {
  mode: "original" | "lossless" | "high" | "saver";
  block?: PlaybackBlock;
  label?: string;
} {
  if (quality !== "lossless")
    return {
      mode: quality === "auto" ? (supported ? "original" : "high") : quality,
    };
  const codec = losslessCodec(track.codec);
  const mp3 = track.codec.toLowerCase() === "mp3";
  if (!codec && !(mp3 && allowMP3))
    return { mode: "original", block: mp3 ? "mp3" : "lossy" };
  if (!supported)
    return { mode: codec ? "lossless" : "original", block: "unsupported" };
  return {
    mode: codec ? "lossless" : "original",
    label: codec ? `Lossless · ${codec}` : "MP3 · allowed",
  };
}
export function originalCacheMode(mode: string): string {
  return mode === "lossless" ? "original" : mode;
}
