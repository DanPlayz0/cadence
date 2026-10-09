// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  chooseCheckpoint,
  validCheckpoint,
  type LocalCheckpoint,
  type SavedPlayback,
} from "./playbackCheckpoint";

const local: LocalCheckpoint = {
  trackId: "song",
  position: 42,
  revision: 3,
  writer: "0123456789abcdef",
  sequence: 5,
  dirty: true,
};
const server: SavedPlayback = {
  ...local,
  position: 30,
  sequence: 4,
  revision: 4,
  track: null,
};
describe("playback checkpoint recovery", () => {
  it("keeps an unsent local update if the server has not advanced", () => {
    expect(
      chooseCheckpoint(
        { ...server, revision: 3, writer: "another-writer" },
        local,
      ),
    ).toBe(local);
  });
  it("recovers the latest local update while older writes from that tab finish", () => {
    expect(chooseCheckpoint(server, local)).toBe(local);
    expect(chooseCheckpoint({ ...server, sequence: 5 }, local)).not.toBe(local);
  });
  it("prefers newer progress from another device over stale local data", () => {
    const remote = { ...server, writer: "abcdef0123456789" };
    expect(chooseCheckpoint(remote, local)).toBe(remote);
    expect(chooseCheckpoint(server, { ...local, dirty: false })).toBe(server);
  });
  it("rejects corrupt or unreasonable stored checkpoints", () => {
    expect(validCheckpoint(local)).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { ...local, position: NaN },
      { ...local, position: -1 },
      { ...local, position: 172801 },
      { ...local, revision: -1 },
      { ...local, revision: 1.2 },
      { ...local, sequence: 0 },
      { ...local, writer: "bad" },
      { ...local, dirty: undefined },
    ])
      expect(validCheckpoint(value)).toBe(false);
  });
});
