// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "vitest";
import assert from "node:assert/strict";
import { pwa } from "./pwa.mjs";

function worker() {
  const handlers = {};
  const cached = [];
  const deleted = [];
  const context = {
    URL,
    self: {
      location: { origin: "https://music.test" },
      addEventListener: (type, handler) => (handlers[type] = handler),
    },
    caches: {
      open: async () => ({
        addAll: async (files) => cached.push(...files),
        match: async (path) => `cached:${path}`,
      }),
      keys: async () => [
        "cadence-static-old",
        "cadence-static-test",
        "other-app",
      ],
      delete: async (key) => deleted.push(key),
    },
    fetch: async () => {
      throw new Error("offline");
    },
  };
  vm.runInNewContext(
    readFileSync(new URL("./service-worker.js", import.meta.url), "utf8")
      .replace("__CACHE_NAME__", '"cadence-static-test"')
      .replace("__PRECACHE__", '["/offline.html", "/assets/app.js"]'),
    context,
  );
  return { handlers, cached, deleted };
}
test("precache and cleanup only Cadence caches", async () => {
  const { handlers, cached, deleted } = worker();
  let pending;
  const event = { waitUntil: (value) => (pending = value) };
  handlers.install(event);
  await pending;
  assert.deepEqual(cached, ["/offline.html", "/assets/app.js"]);
  handlers.activate(event);
  await pending;
  assert.deepEqual(deleted, ["cadence-static-old"]);
});
test("offline deep links get fallback; static files use cache", async () => {
  const { handlers } = worker();
  for (const [path, mode, expected] of [
    ["/albums/123?q=hello", "navigate", "cached:/offline.html"],
    ["/assets/app.js", "cors", "cached:/assets/app.js"],
  ]) {
    let response;
    handlers.fetch({
      request: { url: `https://music.test${path}`, method: "GET", mode },
      respondWith: (value) => (response = value),
    });
    assert.equal(await response, expected);
  }
});
test("never intercept account, music, ranges, mutations or other origins", () => {
  const { handlers } = worker();
  for (const [url, method] of [
    ["https://music.test/api/v1/me", "GET"],
    ["https://music.test/api/v1/stream/1", "GET"],
    ["https://music.test/healthz", "GET"],
    ["https://music.test/assets/app.js", "POST"],
    ["https://other.test/assets/app.js", "GET"],
    ["https://music.test/artwork.jpg", "GET"],
  ]) {
    handlers.fetch({
      request: { url, method, mode: "cors" },
      respondWith: () => assert.fail("unexpected interception"),
    });
  }
});
test("build emits versioned worker with hashed assets and changes version on bundle change", () => {
  const plugin = pwa();
  let emitted;
  const build = (code) => {
    plugin.generateBundle.call(
      { emitFile: (file) => (emitted = file) },
      {},
      { "assets/app-123.js": { type: "chunk", code } },
    );
    return emitted.source;
  };
  const first = build("one");
  assert.equal(emitted.fileName, "sw.js");
  assert.match(first, /\/assets\/app-123.js/);
  assert.doesNotMatch(first, /__PRECACHE__|__CACHE_NAME__/);
  assert.equal(first, build("one"));
  assert.notEqual(first, build("two"));
});
