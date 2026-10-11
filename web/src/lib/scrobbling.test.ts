// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect, vi } from "vitest";
import {
  countListening,
  qualifiedListen,
  ListenOutbox,
  type ListeningEvent,
  type SyncPlayback,
} from "./scrobbling";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
const event = (id: string): ListeningEvent => ({
  eventId: id,
  trackId: "track",
  startedAt: Math.floor(Date.now() / 1000) - 300,
  duration: 300,
  heard: 150,
});
describe("scrobble eligibility and playback time", () => {
  it("requires more than 30 seconds and half duration or four minutes", () => {
    expect(qualifiedListen(30, 30)).toBe(false);
    expect(qualifiedListen(300, 149)).toBe(false);
    expect(qualifiedListen(300, 150)).toBe(true);
    expect(qualifiedListen(900, 240)).toBe(true);
    expect(qualifiedListen(Infinity, 240)).toBe(false);
  });
  it("counts playback, including background intervals, without seek/pause/buffering time", () => {
    const s: SyncPlayback = {
      startedAt: 1,
      heard: 0,
      submitted: false,
      nowSent: false,
      position: 0,
      wall: 0,
    };
    countListening(s, 1, 1000, true);
    countListening(s, 26, 26000, true);
    expect(s.heard).toBe(26);
    countListening(s, 100, 27000, true); // Seek cannot create listening time.
    countListening(s, 101, 28000, false);
    countListening(s, 101, 29000, true); // Buffering has no media progress.
    countListening(s, 102, 30000, true);
    expect(s.heard).toBe(27);
  });
});
describe("persistent listen outbox", () => {
  it("retains failed submissions, deduplicates and survives a new instance", async () => {
    const storage = new MemoryStorage();
    const session = () => ({ userId: "a", revision: 1 });
    const failed = vi.fn().mockRejectedValue(new Error("offline"));
    const first = new ListenOutbox(storage, session, failed, () => false);
    first.enqueue(event("one"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    first.enqueue(event("one"));
    await first.flush();
    expect(JSON.parse(storage.getItem("cadence:sync-listens:a")!)).toHaveLength(
      1,
    );
    const sent = vi.fn().mockResolvedValue({});
    const second = new ListenOutbox(storage, session, sent, () => false);
    await second.flush();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem("cadence:sync-listens:a")!)).toEqual([]);
  });
  it("never replays another account's queued listens across a session switch", async () => {
    const storage = new MemoryStorage();
    let identity = { userId: "a", revision: 1 };
    storage.setItem(
      "cadence:sync-listens:a",
      JSON.stringify([event("a1"), event("a2")]),
    );
    storage.setItem("cadence:sync-listens:b", JSON.stringify([event("b1")]));
    let release!: () => void;
    const sent: string[] = [];
    const outbox = new ListenOutbox(
      storage,
      () => identity,
      async (e) => {
        sent.push(e.eventId);
        if (e.eventId === "a1")
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      () => false,
    );
    const flushing = outbox.flush();
    identity = { userId: "b", revision: 2 };
    release();
    await flushing;
    await vi.waitFor(() => expect(sent).toEqual(["a1", "b1"]));
    expect(JSON.parse(storage.getItem("cadence:sync-listens:a")!)).toHaveLength(
      1,
    );
    identity = { userId: "a", revision: 3 };
    await outbox.flush();
    expect(sent).toEqual(["a1", "b1", "a2"]);
  });
  it("drops permanent rejection but preserves later events when authentication expires", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "cadence:sync-listens:a",
      JSON.stringify([event("bad"), event("auth"), event("later")]),
    );
    const sent = vi.fn(async (e: ListeningEvent) => {
      throw e.eventId === "bad" ? "permanent" : "expired";
    });
    const queue = new ListenOutbox(
      storage,
      () => ({ userId: "a", revision: 1 }),
      sent,
      (e) => e === "permanent",
    );
    await queue.flush();
    expect(sent).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(storage.getItem("cadence:sync-listens:a")!).map(
        (e: ListeningEvent) => e.eventId,
      ),
    ).toEqual(["auth", "later"]);
  });
});
