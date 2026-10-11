// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { pwa } from "./pwa.mjs";

describe("playlist icon offline caching", () => {
  it("excludes icon chunks from installation precaching", () => {
    let output;
    pwa().generateBundle.call(
      {
        emitFile: (file) => {
          output = file.source;
        },
      },
      {},
      {
        "assets/index.js": { type: "chunk", code: "main" },
        "assets/playlist-icon-tree-pine-test.js": {
          type: "chunk",
          code: "icon",
        },
      },
    );
    const files = JSON.parse(output.match(/const FILES = (.*);/)[1]);
    expect(files).toContain("/assets/index.js");
    expect(files).not.toContain("/assets/playlist-icon-tree-pine-test.js");
  });
  it("caches icon chunks after use and serves them offline", async () => {
    const listeners = {};
    const entries = new Map();
    const response = {
      ok: true,
      clone() {
        return this;
      },
    };
    const fetch = vi.fn().mockResolvedValue(response);
    const cache = {
      match: async (key) => entries.get(key),
      put: async (key, value) => entries.set(key, value),
    };
    const source = readFileSync(
      new URL("./service-worker.js", import.meta.url),
      "utf8",
    )
      .replace("__CACHE_NAME__", JSON.stringify("test-cache"))
      .replace("__PRECACHE__", "[]");
    runInNewContext(source, {
      URL,
      fetch,
      caches: { open: async () => cache },
      self: {
        location: { origin: "http://example.test" },
        addEventListener: (name, handler) => {
          listeners[name] = handler;
        },
      },
    });
    async function request(path) {
      let result;
      listeners.fetch({
        request: { method: "GET", url: `http://example.test${path}` },
        respondWith: (promise) => {
          result = promise;
        },
      });
      return result;
    }
    expect(await request("/assets/playlist-icon-tree-pine-test.js")).toBe(
      response,
    );
    fetch.mockRejectedValue(new Error("offline"));
    expect(await request("/assets/playlist-icon-tree-pine-test.js")).toBe(
      response,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await request("/api/v1/playlists")).toBeUndefined();
  });
  it("does not cache failed icon responses", async () => {
    const listeners = {};
    const put = vi.fn();
    const response = { ok: false };
    runInNewContext(
      readFileSync(new URL("./service-worker.js", import.meta.url), "utf8")
        .replace("__CACHE_NAME__", '"test"')
        .replace("__PRECACHE__", "[]"),
      {
        URL,
        fetch: async () => response,
        caches: { open: async () => ({ match: async () => undefined, put }) },
        self: {
          location: { origin: "http://example.test" },
          addEventListener: (name, handler) => {
            listeners[name] = handler;
          },
        },
      },
    );
    let result;
    listeners.fetch({
      request: {
        method: "GET",
        url: "http://example.test/assets/playlist-icon-coffee-test.js",
      },
      respondWith: (promise) => {
        result = promise;
      },
    });
    expect(await result).toBe(response);
    expect(put).not.toHaveBeenCalled();
  });
});
