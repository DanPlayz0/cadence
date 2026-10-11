// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackActions } from "../tracks/TrackActions";
import { api, type Track } from "../../services/api";
vi.mock("../../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api")>()),
  api: vi.fn(),
}));
const track = { id: "song", title: "Song", liked: false } as Track;
const playlists = [
  { id: "p1", name: "Night", icon: "music" },
  { id: "p2", name: "Day", icon: "music" },
];
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  vi.mocked(api).mockReset();
});
afterEach(cleanup);
async function open(toggle = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  const view = render(
    <TrackActions
      track={track}
      playlists={playlists}
      liking={false}
      onLike={vi.fn()}
      onQueue={vi.fn()}
      onAdd={vi.fn()}
      onPlaylistToggle={toggle}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Actions for Song" }));
  await user.click(screen.getByRole("menuitem", { name: "Add to playlist" }));
  return { user, toggle, view };
}
it("loads persisted membership, keeps the submenu open, and toggles bookmark fill", async () => {
  vi.mocked(api).mockResolvedValue({ playlistIds: ["p1"] });
  const { user, toggle } = await open();
  const saved = await screen.findByRole("menuitemcheckbox", {
    name: "Night: Added",
  });
  expect(saved.getAttribute("aria-checked")).toBe("true");
  expect(saved.querySelector(".lucide-bookmark")?.getAttribute("fill")).toBe(
    "currentColor",
  );
  fireEvent.click(saved);
  expect(toggle).toHaveBeenCalledWith(playlists[0], false);
  const removed = await screen.findByRole("menuitemcheckbox", {
    name: "Night: Not added",
  });
  expect(removed.querySelector(".lucide-bookmark")?.getAttribute("fill")).toBe(
    "none",
  );
  fireEvent.click(removed);
  await screen.findByRole("menuitemcheckbox", { name: "Night: Added" });
  expect(toggle).toHaveBeenLastCalledWith(playlists[0], true);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("preserves membership on mutation failure and retries loading instead of assuming empty", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Load failed"))
    .mockResolvedValue({ playlistIds: ["p1"] });
  const toggle = vi.fn().mockRejectedValue(new Error("Save failed"));
  const { user } = await open(toggle);
  await screen.findByText("Load failed");
  expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Retry loading playlists" }),
  );
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Night: Added" }),
  );
  await screen.findByText("Save failed");
  expect(
    screen
      .getByRole("menuitemcheckbox", { name: "Night: Added" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});
it("prevents duplicate saves and searches without triggering menu typeahead", async () => {
  vi.mocked(api).mockResolvedValue({ playlistIds: [] });
  let finish!: () => void;
  const toggle = vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { user } = await open(toggle);
  const entry = await screen.findByRole("menuitemcheckbox", {
    name: "Night: Not added",
  });
  fireEvent.click(entry);
  fireEvent.click(entry);
  expect(toggle).toHaveBeenCalledTimes(1);
  finish();
  await screen.findByRole("menuitemcheckbox", { name: "Night: Added" });
  await user.type(
    screen.getByRole("textbox", { name: "Find a playlist" }),
    "Night",
  );
  expect(
    screen.queryByRole("menuitemcheckbox", { name: "Day: Not added" }),
  ).toBeNull();
});
it("ignores a membership response after the session changes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { view } = await open();
  window.dispatchEvent(new Event("cadence-session"));
  finish({ playlistIds: ["p1"] });
  await waitFor(() =>
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull(),
  );
  view.unmount();
});

it("ignores the old track's response after switching tracks", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ playlistIds: ["p2"] });
  const { view } = await open();
  view.rerender(
    <TrackActions
      track={{ ...track, id: "next" }}
      playlists={playlists}
      liking={false}
      onLike={vi.fn()}
      onQueue={vi.fn()}
      onAdd={vi.fn()}
      onPlaylistToggle={vi.fn()}
    />,
  );
  await screen.findByRole("menuitemcheckbox", { name: "Day: Added" });
  finish({ playlistIds: ["p1"] });
  await waitFor(() =>
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Night: Not added" })
        .getAttribute("aria-checked"),
    ).toBe("false"),
  );
  expect(api).toHaveBeenCalledTimes(2);
});
