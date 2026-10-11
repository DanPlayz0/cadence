// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it, vi } from "vitest";
import { api, type Track } from "../services/api";
import { playlistTracks } from "./playlistPlayback";

it("loads the entire playlist in order using successive pages", async () => {
  const tracks = Array.from(
    { length: 503 },
    (_, i) => ({ id: String(i) }) as Track,
  );
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ items: tracks.slice(0, 500), total: 503 })
    .mockResolvedValueOnce({ items: tracks.slice(500), total: 503 });
  expect(await playlistTracks("p", () => true, fetch as typeof api)).toEqual(
    tracks,
  );
  expect(fetch.mock.calls[1][0]).toContain("offset=500");
  expect(fetch.mock.calls[0][0]).not.toContain("q=");
});
it("does not apply superseded requests and propagates failures", async () => {
  let valid = true;
  const fetch = vi.fn(async () => {
    valid = false;
    return { items: [], total: 0 };
  });
  expect(
    await playlistTracks("p", () => valid, fetch as typeof api),
  ).toBeNull();
  const failed = vi.fn().mockRejectedValue(new Error("Unavailable"));
  await expect(
    playlistTracks("p", () => true, failed as typeof api),
  ).rejects.toThrow("Unavailable");
});
it("handles empty playlists and refuses a stalled partial load", async () => {
  const empty = vi.fn().mockResolvedValue({ items: [], total: 0 });
  expect(await playlistTracks("p", () => true, empty as typeof api)).toEqual(
    [],
  );
  const stalled = vi.fn().mockResolvedValue({ items: [], total: 10 });
  await expect(
    playlistTracks("p", () => true, stalled as typeof api),
  ).rejects.toThrow("changed while loading");
});
