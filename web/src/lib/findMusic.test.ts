// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  defaultFind,
  naturalFiles,
  parseFind,
  quality,
  sourceQuality,
  sources,
} from "./findMusic";
import { parseRoute, routeURL } from "./navigation";
import type { SoulseekResult } from "./soulseek";
const file = (patch: Partial<SoulseekResult> = {}): SoulseekResult => ({
  filename: "Music/Record/02.flac",
  folder: "Music/Record",
  username: "peer",
  size: 100,
  queueLength: 0,
  hasFreeUploadSlot: true,
  uploadSpeed: 1024,
  bitDepth: 16,
  sampleRate: 44100,
  ...patch,
});
describe("Find source comparison", () => {
  it("groups normalized folders and deduplicates files without merging peers", () => {
    const rows = sources(
      [
        file(),
        file({ filename: "Music\\Record\\02.flac", folder: "Music\\Record" }),
        file({ filename: "Music/Record/10.mp3", bitRate: 320 }),
        file({ username: "other" }),
      ],
      defaultFind,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.result.username === "peer")?.files).toHaveLength(
      2,
    );
  });
  it("prioritizes slots, queues, then speed, with stable ties", () => {
    const rows = [
      file({ username: "busy", hasFreeUploadSlot: false }),
      file({ username: "queued", queueLength: 5 }),
      file({ username: "fast", uploadSpeed: 10000 }),
      file({ username: "slow" }),
    ];
    expect(sources(rows, defaultFind).map((r) => r.result.username)).toEqual([
      "fast",
      "slow",
      "queued",
      "busy",
    ]);
    expect(sources([...rows].reverse(), defaultFind).map((r) => r.key)).toEqual(
      sources(rows, defaultFind).map((r) => r.key),
    );
  });
  it("filters per file and never treats unknown bitrate as meeting a minimum", () => {
    const data = [
      file(),
      file({ filename: "Music/Record/song.mp3", bitRate: 320 }),
      file({
        filename: "Music/Record/low.mp3",
        bitRate: 128,
        hasFreeUploadSlot: false,
      }),
    ];
    const rows = sources(data, {
      ...defaultFind,
      format: "mp3",
      minBitrate: "256",
      freeSlots: true,
      filter: "song",
    });
    expect(rows[0].files).toHaveLength(1);
    expect(rows[0].files[0].bitRate).toBe(320);
    expect(sources(data, { ...defaultFind, sourceView: "files" })).toHaveLength(
      3,
    );
  });
  it("sorts natural track numbers and exposes mixed qualities", () => {
    expect(
      naturalFiles([
        file({ filename: "10.flac" }),
        file({ filename: "2.flac" }),
        file({ filename: "1.flac" }),
      ]).map((f) => f.filename),
    ).toEqual(["1.flac", "2.flac", "10.flac"]);
    expect(quality(file())).toBe("FLAC · 16 bit · 44.1 kHz");
    expect(
      sources([file(), file({ username: "hires", bitDepth: 24 })], {
        ...defaultFind,
        sort: "quality",
      })[0].result.username,
    ).toBe("hires");
  });
});
it("summarizes varying track qualities without repeating every bitrate", () => {
  expect(
    sourceQuality([
      file({ bitRate: 700 }),
      file({ bitRate: 1000 }),
      file({
        filename: "song.mp3",
        bitDepth: undefined,
        sampleRate: undefined,
        bitRate: 320,
      }),
    ]),
  ).toBe("FLAC · 16 bit · 44.1 kHz · 700–1000 kbps / MP3 · 320 kbps");
});
it("round-trips Find navigation and rejects malformed state", () => {
  const find = {
    ...defaultFind,
    tab: "direct" as const,
    sourceQuery: "Artist Album",
    filter: "track",
    freeSlots: true,
  };
  expect(
    parseRoute(
      new URL(routeURL({ view: "find", find }), "https://cadence.test"),
    ).find,
  ).toEqual(find);
  expect(parseFind("{bad")).toBeUndefined();
  expect(parseFind("null")).toBeUndefined();
  expect(
    parseFind(
      JSON.stringify({
        tab: "evil",
        freeSlots: "yes",
        selection: { id: "../../bad" },
      }),
    ),
  ).toEqual(defaultFind);
});
