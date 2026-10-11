// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FindMusic } from "./FindMusic";
import { api } from "../services/api";
import { defaultFind } from "../lib/findMusic";
import type { SoulseekCapabilities } from "../lib/soulseek";
vi.mock("../services/api", () => ({ api: vi.fn() }));
const call = vi.mocked(api);
const capabilities: SoulseekCapabilities = {
  configured: true,
  enabled: true,
  allowed: true,
  presentation: "separate",
  losslessOnly: true,
  allowedFormats: ["flac", "mp3"],
};
const result = {
  filename: "Music/Record/02.flac",
  folder: "Music/Record",
  username: "peer",
  size: 100,
  queueLength: 0,
  hasFreeUploadSlot: true,
  uploadSpeed: 1024,
  bitDepth: 16,
  sampleRate: 44100,
};
const nav = {
  ...defaultFind,
  tab: "direct" as const,
  sourceQuery: "Artist Record",
};
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  call.mockReset();
  call.mockImplementation(async (path) =>
    path.startsWith("/soulseek/requests")
      ? []
      : { id: "search", state: "Completed", results: [result] },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not overlap slow progress polls", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  let polls = 0;
  call.mockImplementation(async (path, method) => {
    if (path === "/soulseek/searches" && method === "POST")
      return { id: "search", state: "InProgress", results: [] };
    if (path === "/soulseek/searches/search") {
      polls++;
      return new Promise((r) => {
        resolve = r;
      });
    }
    return [];
  });
  render(<FindMusic capabilities={capabilities} navigation={nav} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Search Soulseek" }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7500);
  });
  expect(polls).toBe(1);
  await act(async () => {
    resolve({ id: "search", state: "Completed", results: [result] });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7500);
  });
  expect(polls).toBe(1);
});
async function search() {
  fireEvent.click(screen.getByRole("button", { name: "Search Soulseek" }));
  await screen.findByRole("button", { name: "View folder" });
}
it("offers catalog without download permission and only starts downloads on submit", async () => {
  call.mockImplementation(async (path) =>
    path.startsWith("/catalog/search")
      ? {
          items: [
            {
              id: "12345678-1234-1234-1234-123456789012",
              kind: "song",
              name: "Record",
              artist: "Artist",
              date: "",
              releaseType: "",
              disambiguation: "",
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
        }
      : [],
  );
  render(<FindMusic capabilities={{ ...capabilities, allowed: false }} />);
  fireEvent.click(screen.getByRole("button", { name: "Songs" }));
  fireEvent.change(screen.getByLabelText("Search catalog"), {
    target: { value: "Record" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Record.*Artist/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Find downloads" }));
  expect(screen.getByText("Downloads aren’t available")).toBeTruthy();
  expect(call.mock.calls.some(([path]) => path === "/soulseek/searches")).toBe(
    false,
  );
});
it("suppresses a stale folder response when a new search starts", async () => {
  let resolve!: (value: unknown) => void;
  call.mockImplementation(async (path) =>
    path === "/soulseek/folder-details"
      ? new Promise((r) => {
          resolve = r;
        })
      : path.startsWith("/soulseek/requests")
        ? []
        : { id: "search", state: "Completed", results: [result] },
  );
  render(<FindMusic capabilities={capabilities} navigation={nav} />);
  await search();
  fireEvent.click(screen.getByRole("button", { name: "View folder" }));
  await search();
  resolve({ files: [result], excludedAudioCount: 0 });
  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: "Folder contents" }),
    ).toBeNull(),
  );
});
it("retains the idempotency key after failure and prevents repeat successful requests", async () => {
  let attempts = 0;
  call.mockImplementation(async (path, method) => {
    if (path === "/soulseek/requests" && method === "POST") {
      if (++attempts === 1) throw new Error("Request interrupted");
      return { state: "review_before" };
    }
    if (path === "/soulseek/folder-details")
      return { files: [result], excludedAudioCount: 2 };
    return path.startsWith("/soulseek/requests")
      ? []
      : { id: "search", state: "Completed", results: [result] };
  });
  render(<FindMusic capabilities={capabilities} navigation={nav} />);
  await search();
  fireEvent.click(screen.getByRole("button", { name: "View folder" }));
  const button = await screen.findByRole("button", {
    name: "Request selected tracks",
  });
  fireEvent.click(button);
  await screen.findByText("Request interrupted");
  fireEvent.click(button);
  await screen.findAllByText("Awaiting download approval");
  fireEvent.click(button);
  await screen.findAllByText(/already been requested/);
  const posts = call.mock.calls.filter(
    ([p, m]) => p === "/soulseek/requests" && m === "POST",
  );
  expect(posts).toHaveLength(2);
  expect((posts[0][2] as { id: string }).id).toBe(
    (posts[1][2] as { id: string }).id,
  );
  expect(screen.getByText(/2 audio files excluded/)).toBeTruthy();
});
it("clears sources and blocks actions when permission is revoked", async () => {
  const { rerender } = render(
    <FindMusic capabilities={capabilities} navigation={nav} />,
  );
  await search();
  rerender(
    <FindMusic
      capabilities={{ ...capabilities, allowed: false }}
      navigation={nav}
    />,
  );
  expect(screen.queryByRole("button", { name: "View folder" })).toBeNull();
  expect(screen.getByText("Downloads aren’t available")).toBeTruthy();
});
it("serializes progress polling and resumes after a retry", async () => {
  let polls = 0;
  call.mockImplementation(async (path, method) => {
    if (path === "/soulseek/searches" && method === "POST")
      return { id: "search", state: "InProgress", results: [] };
    if (path === "/soulseek/searches/search") {
      if (++polls === 1) throw new Error("Poll failed");
      return { id: "search", state: "Completed", results: [result] };
    }
    return [];
  });
  render(<FindMusic capabilities={capabilities} navigation={nav} />);
  fireEvent.click(screen.getByRole("button", { name: "Search Soulseek" }));
  await screen.findByText("Poll failed", {}, { timeout: 3000 });
  fireEvent.click(
    screen.getByRole("button", { name: "Retry search progress" }),
  );
  await screen.findByRole("button", { name: "View folder" }, { timeout: 3000 });
  expect(polls).toBe(2);
});
