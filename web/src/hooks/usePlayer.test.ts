// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../services/api";

// A deterministic hook runner keeps these media/state tests independent of a DOM.
// Effects obey dependencies and cleanup; media loading and events are explicit.
const hooks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.cells))
      hooks.cells[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.cells[index],
      (value: any) => {
        hooks.cells[index] =
          typeof value === "function" ? value(hooks.cells[index]) : value;
      },
    ];
  },
  useRef: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.cells)) hooks.cells[index] = { current: initial };
    return hooks.cells[index];
  },
  useCallback: (callback: any, deps: any[]) => {
    const index = hooks.index++;
    const old = hooks.cells[index];
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i])))
      hooks.cells[index] = { callback, deps };
    return hooks.cells[index].callback;
  },
  useEffect: (effect: any, deps: any[]) => {
    const index = hooks.index++;
    const old = hooks.cells[index];
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
      hooks.effects.push(() => {
        old?.cleanup?.();
        hooks.cells[index] = { deps, cleanup: effect() };
      });
    }
  },
}));
vi.mock("../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api")>()),
  api: vi.fn(async () => ({})),
}));
import { api } from "../services/api";
import { usePlayer } from "./usePlayer";
import { SessionCache } from "../lib/cache";
vi.mock("../services/sync", () => ({
  flushListens: vi.fn(),
  submitListen: vi.fn(),
  submitNowPlaying: vi.fn(),
}));
import { submitListen, submitNowPlaying } from "../services/sync";

class TestAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 100;
  paused = true;
  volume = 1;
  supported = true;
  readyState = 4;
  seeking = false;
  onloadedmetadata: (() => void) | null = null;
  canPlayType() {
    return this.supported ? "probably" : "";
  }
  removeAttribute() {
    this.src = "";
  }
  load() {
    this.currentTime = 0;
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  async play() {
    this.paused = false;
    this.onloadedmetadata?.();
    this.dispatchEvent(new Event("play"));
    this.dispatchEvent(new Event("playing"));
  }
}
const track = (id: string, codec = "mp3"): Track => ({
  id,
  codec,
  mime: codec === "mp3" ? "audio/mpeg" : "audio/flac",
  title: id,
  artist: "Artist",
  number: 0,
  disc: 0,
  year: "",
  genre: "",
  duration: 100,
  artwork: false,
  liked: false,
});
let audio: TestAudio;
let player: ReturnType<typeof usePlayer>;
let errors: ReturnType<typeof vi.fn<(message: string) => void>>;
let actions: Map<string, () => void>;
function render() {
  hooks.index = 0;
  player = usePlayer(errors, vi.fn());
  for (const effect of hooks.effects.splice(0)) effect();
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  render();
}
beforeEach(() => {
  hooks.cells = [];
  hooks.effects = [];
  hooks.index = 0;
  errors = vi.fn();
  actions = new Map();
  vi.stubGlobal(
    "Audio",
    class extends TestAudio {
      constructor() {
        super();
        audio = this;
      }
    },
  );
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
  vi.stubGlobal("navigator", {
    onLine: true,
    mediaSession: {
      setActionHandler: (name: string, callback: () => void) =>
        actions.set(name, callback),
    },
  });
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(_value: unknown) {}
    },
  );
  vi.mocked(api).mockClear();
  vi.mocked(submitListen).mockClear();
  vi.mocked(submitNowPlaying).mockClear();
  render();
});
afterEach(() => {
  for (const cell of hooks.cells) cell?.cleanup?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Persistent queues", () => {
  it("switches playlist and clears manual songs without touching active audio", async () => {
    player.play([track("a"), track("b")]);
    await settle();
    audio.currentTime = 35;
    player.enqueue(track("manual"));
    render();
    const pause = vi.spyOn(audio, "pause");
    const load = vi.spyOn(audio, "load");
    player.replaceUpcoming([track("c"), track("d")], {
      name: "Next",
      route: { view: "playlist:p" },
    });
    render();
    expect(audio.currentTime).toBe(35);
    expect(audio.paused).toBe(false);
    expect(player.queue.current?.track.id).toBe("a");
    expect(player.queue.manual[0].track.id).toBe("manual");
    player.clearManual();
    render();
    expect(player.queue.manual).toEqual([]);
    expect(player.queue.remaining.map((e) => e.track.id)).toEqual(["c", "d"]);
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it("restores a full queue and settings paused at the saved position", async () => {
    player.play([track("a"), track("b")]);
    await settle();
    player.enqueue(track("manual"));
    render();
    const queue = player.queue;
    player.restore(track("a"), 42, queue, { shuffle: true, repeat: "all" });
    await settle();
    audio.onloadedmetadata?.();
    render();
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(42);
    expect(player.queue).toEqual(queue);
    expect(player.shuffle).toBe(true);
    expect(player.repeat).toBe("all");
  });
  it("counts manual edits as actions so delayed restoration cannot overwrite them", () => {
    const before = player.generation();
    player.enqueue(track("manual"));
    expect(player.generation()).not.toBe(before);
  });
});

describe("Lossless playback integration", () => {
  it("separates local play counts from qualified scrobbles and preserves identity across quality changes", async () => {
    let wall = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wall);
    player.play([track("scrobble", "flac")]);
    await settle();
    expect(submitNowPlaying).toHaveBeenCalledTimes(1);
    for (let second = 1; second <= 30; second++) {
      wall = second * 1000;
      audio.currentTime = second;
      audio.dispatchEvent(new Event("timeupdate"));
    }
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/plays")),
    ).toHaveLength(1);
    expect(submitListen).not.toHaveBeenCalled();
    player.changeQuality("high");
    await settle();
    expect(submitNowPlaying).toHaveBeenCalledTimes(1);
    for (let second = 31; second <= 60; second++) {
      wall = second * 1000;
      audio.currentTime = second;
      audio.dispatchEvent(new Event("timeupdate"));
    }
    expect(submitListen).toHaveBeenCalledTimes(1);
    const event = vi.mocked(submitListen).mock.calls[0][0];
    expect(event.eventId).toBe(
      vi.mocked(submitNowPlaying).mock.calls[0][0].eventId,
    );
    expect(event.heard).toBe(50);
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/plays")),
    ).toHaveLength(1);
  });
  it("does not qualify seeking, buffering, or paused time", async () => {
    let wall = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wall);
    player.play([track("timing", "flac")]);
    await settle();
    wall = 1000;
    audio.currentTime = 1;
    audio.dispatchEvent(new Event("timeupdate"));
    wall = 2000;
    audio.currentTime = 70;
    audio.dispatchEvent(new Event("seeking"));
    audio.dispatchEvent(new Event("seeked"));
    audio.dispatchEvent(new Event("timeupdate"));
    audio.readyState = 2;
    wall = 62000;
    audio.currentTime = 71;
    audio.dispatchEvent(new Event("timeupdate"));
    audio.pause();
    wall = 122000;
    audio.currentTime = 90;
    audio.dispatchEvent(new Event("timeupdate"));
    expect(submitListen).not.toHaveBeenCalled();
  });
  it("blocks MP3, clears previous audio, and prevents media controls from bypassing policy", async () => {
    player.play([track("flac", "flac")]);
    await settle();
    expect(audio.src).toContain("quality=original");
    player.changeQuality("lossless");
    await settle();
    expect(audio.src).toContain("quality=lossless");
    expect(player.sourceLabel).toBe("Lossless · FLAC");
    player.play([track("mp3")]);
    await settle();
    expect(player.blocked?.reason).toBe("mp3");
    expect(audio.src).toBe("");
    expect(audio.paused).toBe(true);
    player.toggle();
    actions.get("play")?.();
    expect(audio.paused).toBe(true);
  });
  it("allows one queue occurrence including repeat-one but blocks the next MP3", async () => {
    player.changeQuality("lossless");
    render();
    player.play([track("one"), track("two")]);
    render();
    const block = player.blocked!;
    player.resolveBlocked(block, "track");
    await settle();
    expect(audio.src).toContain("one/stream?quality=original");
    expect(player.sourceLabel).toBe("MP3 · allowed");
    player.setRepeat("one");
    render();
    audio.dispatchEvent(new Event("ended"));
    await settle();
    expect(player.blocked).toBeNull();
    player.next();
    render();
    expect(player.blocked?.reason).toBe("mp3");
    const newer = player.blocked;
    player.resolveBlocked(block, "session");
    render();
    expect(player.blocked).toBe(newer);
    expect(player.allowMP3Session).toBe(false);
  });
  it("allows MP3 for the session, revokes while preserving position, and resets on clear", async () => {
    player.changeQuality("lossless");
    render();
    player.play([track("one"), track("two")]);
    render();
    player.resolveBlocked(player.blocked!, "session");
    await settle();
    audio.currentTime = 12;
    player.changeMP3Session(false);
    render();
    expect(player.blocked?.resume.position).toBe(12);
    expect(audio.src).toBe("");
    player.resolveBlocked(player.blocked!, "session");
    await settle();
    expect(audio.currentTime).toBe(12);
    player.next();
    await settle();
    expect(player.blocked).toBeNull();
    player.clear();
    render();
    expect(player.allowMP3Session).toBe(false);
    player.play([track("one")]);
    render();
    expect(player.blocked?.reason).toBe("mp3");
  });
  it("skip bypasses repeat-one and stops at the end without repeat-all looping", async () => {
    player.changeQuality("lossless");
    player.setRepeat("one");
    render();
    player.play([track("one"), track("two")]);
    render();
    player.resolveBlocked(player.blocked!, "skip");
    render();
    expect(player.current?.id).toBe("two");
    player.setRepeat("all");
    render();
    player.resolveBlocked(player.blocked!, "skip");
    render();
    expect(player.current).toBeUndefined();
    expect(audio.src).toBe("");
  });
  it("preserves paused restoration through MP3 override and quality changes", async () => {
    player.changeQuality("lossless");
    render();
    player.restore(track("one"), 25);
    render();
    expect(player.snapshot()?.position).toBe(25);
    player.resolveBlocked(player.blocked!, "track");
    await settle();
    audio.onloadedmetadata?.();
    render();
    expect(audio.currentTime).toBe(25);
    expect(audio.paused).toBe(true);
    player.changeQuality("high");
    await settle();
    audio.onloadedmetadata?.();
    expect(audio.src).toContain("quality=high");
    expect(audio.currentTime).toBe(25);
    expect(audio.paused).toBe(true);
  });
  it("blocks unsupported and other lossy formats, and never falls back on Lossless decode errors", async () => {
    player.changeQuality("lossless");
    render();
    audio.supported = false;
    player.play([track("flac", "flac")]);
    render();
    expect(player.blocked?.reason).toBe("unsupported");
    expect(audio.src).toBe("");
    audio.supported = true;
    player.play([track("flac", "flac")]);
    await settle();
    audio.dispatchEvent(new Event("error"));
    await settle();
    expect(player.blocked?.reason).toBe("unsupported");
    expect(audio.src).toBe("");
    player.play([track("aac", "aac")]);
    render();
    expect(player.blocked?.reason).toBe("lossy");
    player.changeQuality("auto");
    await settle();
    audio.dispatchEvent(new Event("error"));
    await settle();
    expect(audio.src).toContain("quality=high");
  });
  it("uses only original caches offline and applies policy to cached MP3s", async () => {
    const get = vi
      .spyOn(SessionCache.prototype, "get")
      .mockImplementation((key) =>
        key.endsWith(":original") ? "blob:original" : "blob:high",
      );
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    player.changeQuality("lossless");
    render();
    player.play([track("flac", "flac")]);
    await settle();
    expect(audio.src).toBe("blob:original");
    expect(get).not.toHaveBeenCalledWith("flac:high");
    player.play([track("one")]);
    render();
    expect(player.blocked?.reason).toBe("mp3");
    expect(audio.src).toBe("");
  });
  it("handles a rejected decoder without relying on an audio error event", async () => {
    vi.spyOn(TestAudio.prototype, "play").mockRejectedValue(
      new DOMException("Unsupported codec", "NotSupportedError"),
    );
    player.changeQuality("lossless");
    render();
    player.play([track("flac", "flac")]);
    await settle();
    expect(player.blocked?.reason).toBe("unsupported");
    expect(audio.src).toBe("");
    expect(errors).not.toHaveBeenCalled();
  });
  it("keeps one listening-history event across quality changes and MP3 permission prompts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("No opportunistic cache"),
    );
    player.play([track("one")]);
    await settle();
    for (let i = 1; i <= 10; i++) {
      audio.currentTime = i * 2;
      audio.dispatchEvent(new Event("timeupdate"));
    }
    player.changeQuality("lossless");
    render();
    player.resolveBlocked(player.blocked!, "track");
    await settle();
    for (let i = 11; i <= 17; i++) {
      audio.currentTime = i * 2;
      audio.dispatchEvent(new Event("timeupdate"));
    }
    const plays = () =>
      vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/plays"));
    expect(plays()).toHaveLength(1);
    const event = plays()[0][2];
    player.changeQuality("auto");
    await settle();
    for (let i = 18; i <= 35; i++) {
      audio.currentTime = i * 2;
      audio.dispatchEvent(new Event("timeupdate"));
    }
    expect(plays()).toHaveLength(1);
    expect(plays()[0][2]).toEqual(event);
  });
  it("retains blocked seek positions and ignores a delayed load after navigating", async () => {
    player.changeQuality("lossless");
    render();
    player.restore(track("one"), 10);
    render();
    player.seek(22);
    render();
    expect(player.snapshot()?.position).toBe(22);
    player.changeQuality("auto");
    await settle();
    audio.onloadedmetadata?.();
    expect(audio.currentTime).toBe(22);
    let release!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as any,
    );
    player.play([track("old", "flac")]);
    player.changeQuality("lossless");
    player.play([track("new")]);
    render();
    release({});
    await settle();
    expect(player.current?.id).toBe("new");
    expect(player.blocked?.reason).toBe("mp3");
    expect(audio.src).toBe("");
  });
});
