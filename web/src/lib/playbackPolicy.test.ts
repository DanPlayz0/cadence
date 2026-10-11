// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  losslessCodec,
  originalCacheMode,
  playbackPolicy,
} from "./playbackPolicy";

describe("lossless source policy", () => {
  it.each([
    "flac",
    "FLAC",
    "alac",
    "pcm_s16le",
    "pcm_s24be",
    "pcm_u8",
    "pcm_f32le",
  ])("accepts %s", (codec) => {
    expect(losslessCodec(codec)).not.toBeNull();
    expect(
      playbackPolicy({ codec, mime: "audio/wav" }, "lossless", true).mode,
    ).toBe("lossless");
  });
  it.each([
    "mp3",
    "aac",
    "adpcm_ms",
    "pcm_alaw",
    "pcm_mulaw",
    "",
    "wav",
    "pcm_unknown",
  ])("blocks %s even in a WAV container", (codec) => {
    expect(losslessCodec(codec)).toBeNull();
    expect(
      playbackPolicy({ codec, mime: "audio/wav" }, "lossless", true).block,
    ).toBe(codec === "mp3" ? "mp3" : "lossy");
  });
  it("permits only explicit MP3 exceptions and never converts unsupported originals", () => {
    expect(
      playbackPolicy(
        { codec: "mp3", mime: "audio/mpeg" },
        "lossless",
        true,
        true,
      ),
    ).toEqual({ mode: "original", label: "MP3 · allowed" });
    expect(
      playbackPolicy(
        { codec: "aac", mime: "audio/mp4" },
        "lossless",
        true,
        true,
      ).block,
    ).toBe("lossy");
    expect(
      playbackPolicy({ codec: "flac", mime: "audio/flac" }, "lossless", false),
    ).toEqual({ mode: "lossless", block: "unsupported" });
  });
  it("keeps Auto, High, and Saver behavior and shares original caches", () => {
    const track = { codec: "flac", mime: "audio/flac" };
    expect(playbackPolicy(track, "auto", true).mode).toBe("original");
    expect(playbackPolicy(track, "auto", false).mode).toBe("high");
    expect(playbackPolicy(track, "high", true).mode).toBe("high");
    expect(playbackPolicy(track, "saver", true).mode).toBe("saver");
    expect(originalCacheMode("lossless")).toBe("original");
    expect(originalCacheMode("high")).toBe("high");
  });
});
