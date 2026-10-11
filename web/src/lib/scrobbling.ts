// SPDX-License-Identifier: GPL-2.0-or-later
export type ListeningEvent = {
  eventId: string;
  trackId: string;
  startedAt: number;
  heard: number;
  duration: number;
};
export type SyncPlayback = {
  startedAt: number;
  heard: number;
  submitted: boolean;
  nowSent: boolean;
  position: number;
  wall: number;
};
export function qualifiedListen(duration: number, heard: number) {
  return (
    Number.isFinite(duration) &&
    Number.isFinite(heard) &&
    duration > 30 &&
    heard >= Math.min(duration / 2, 240)
  );
}
export function countListening(
  state: SyncPlayback,
  position: number,
  wall: number,
  running: boolean,
) {
  const delta = position - state.position;
  const elapsed = Math.max(0, (wall - state.wall) / 1000);
  if (running && delta > 0 && delta <= elapsed + 0.25)
    state.heard += Math.min(delta, elapsed);
  state.position = position;
  state.wall = wall;
}

type SessionIdentity = { userId: string; revision: number };
// Dependencies keep the persistence and account-switch boundary independently testable.
export class ListenOutbox {
  private running = false;
  constructor(
    private storage: Storage,
    private session: () => SessionIdentity,
    private send: (event: ListeningEvent) => Promise<unknown>,
    private permanent: (error: unknown) => boolean,
  ) {}
  private key(user: string) {
    return `cadence:sync-listens:${user}`;
  }
  private read(user: string): ListeningEvent[] {
    try {
      const value: unknown = JSON.parse(
        this.storage.getItem(this.key(user)) ?? "[]",
      );
      if (!Array.isArray(value)) return [];
      return value.filter(
        (e): e is ListeningEvent =>
          e &&
          typeof e.eventId === "string" &&
          typeof e.trackId === "string" &&
          Number.isFinite(e.startedAt) &&
          Number.isFinite(e.heard) &&
          Number.isFinite(e.duration) &&
          e.startedAt >= Date.now() / 1000 - 30 * 86400,
      );
    } catch {
      return [];
    }
  }
  private write(user: string, events: ListeningEvent[]) {
    try {
      this.storage.setItem(this.key(user), JSON.stringify(events));
    } catch {
      /* Storage can be unavailable or full. */
    }
  }
  enqueue(event: ListeningEvent) {
    const { userId } = this.session();
    if (!userId) return;
    const events = this.read(userId);
    if (!events.some((e) => e.eventId === event.eventId)) events.push(event);
    this.write(userId, events);
    void this.flush();
  }
  async flush() {
    if (this.running) return;
    const identity = this.session();
    if (!identity.userId) return;
    this.running = true;
    try {
      for (const event of this.read(identity.userId)) {
        const current = this.session();
        if (
          current.userId !== identity.userId ||
          current.revision !== identity.revision
        )
          break;
        try {
          await this.send(event);
        } catch (error) {
          if (!this.permanent(error)) break;
        }
        this.write(
          identity.userId,
          this.read(identity.userId).filter((e) => e.eventId !== event.eventId),
        );
      }
    } finally {
      this.running = false;
      // A session change during an in-flight request starts only the new account's queue.
      const current = this.session();
      if (
        current.userId &&
        (current.userId !== identity.userId ||
          current.revision !== identity.revision)
      )
        void this.flush();
    }
  }
}
