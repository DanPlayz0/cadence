// SPDX-License-Identifier: GPL-2.0-or-later
import { test, expect, type Page } from "@playwright/test";
test.setTimeout(30000);
const id = "12345678-1234-1234-1234-123456789012";
const album = {
  id,
  kind: "album",
  name: "Warm Sounds",
  artist: "Test Artist",
  date: "2020",
  releaseType: "Album",
  disambiguation: "",
};
const file = {
  filename: "Music/Warm Sounds/02 Evening.flac",
  size: 10000000,
  bitDepth: 16,
  sampleRate: 44100,
  length: 180,
};
const result = {
  ...file,
  username: "fastpeer",
  folder: "Music/Warm Sounds",
  queueLength: 0,
  hasFreeUploadSlot: true,
  uploadSpeed: 1024000,
};
async function fixture(page: Page, allowed = true) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let posts = 0,
    polls = 0;
  let requested: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/status") body = { name: "Cadence", setupRequired: false };
    else if (path === "/me")
      body = {
        user: {
          id: "u1",
          username: "listener",
          displayName: "Listener",
          admin: false,
          groups: [],
          avatar: false,
          avatarVersion: 0,
        },
        csrf: "fixture",
      };
    else if (path === "/me/playback")
      body = {
        trackId: "",
        position: 0,
        revision: 0,
        writer: "",
        sequence: 0,
        track: null,
      };
    else if (path === "/tracks")
      body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === "/soulseek/capabilities")
      body = {
        configured: true,
        enabled: true,
        allowed,
        presentation: "separate",
        losslessOnly: true,
        allowedFormats: ["flac", "mp3"],
      };
    else if (path === "/catalog/search") {
      const type = url.searchParams.get("type");
      const item =
        type === "artist"
          ? {
              ...album,
              kind: "artist",
              name: "Test Artist",
              artist: "",
              disambiguation: "UK band",
            }
          : type === "song"
            ? { ...album, kind: "song", name: "Evening" }
            : album;
      body = { items: [item], total: 1, limit: 25, offset: 0 };
    } else if (path === `/catalog/artists/${id}/albums`)
      body = { items: [album], total: 1, limit: 25, offset: 0 };
    else if (path === `/catalog/albums/${id}`) body = album;
    else if (path === "/soulseek/searches" && req.method() === "POST") {
      posts++;
      body = { id: "search", state: "InProgress", results: [] };
    } else if (path === "/soulseek/searches/search") {
      polls++;
      body = {
        id: "search",
        state: "Completed",
        results: [
          result,
          { ...result, filename: "Music/Warm Sounds/10 Finale.flac" },
          {
            ...result,
            username: "busypeer",
            hasFreeUploadSlot: false,
            queueLength: 12,
          },
        ],
      };
    } else if (path === "/soulseek/folder-details")
      body = {
        files: [
          { ...file, filename: "Music/Warm Sounds/10 Finale.flac" },
          file,
        ],
        excludedAudioCount: 1,
      };
    else if (path === "/soulseek/requests" && req.method() === "POST") {
      const input = req.postDataJSON();
      body = {
        id: input.id,
        userId: "u1",
        username: input.username,
        folder: input.folder,
        files: [{ ...file, state: "Queued", bytesTransferred: 0 }],
        rule: { mode: "review", subject: "", libraryId: "", folder: "" },
        reviewTiming: "before",
        approved: false,
        state: "review_before",
        error: "",
        created: "2026-10-10T12:00:00Z",
      };
      requested = [body];
    } else if (path === "/soulseek/requests") body = requested;
    else if (
      path.startsWith("/soulseek/requests/") &&
      req.method() === "POST"
    ) {
      requested = requested.map((r) => ({
        ...(r as object),
        state: "cancelled",
      }));
      body = { ok: true };
    } else if (path === "/me/sync" || path === "/me/sync/status")
      body = { connections: [], providers: [] };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { errors, posts: () => posts, polls: () => polls };
}
for (const width of [1280, 390, 320]) {
  test(`catalog to folder download and navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    await page.goto("/find");
    await expect(page.locator(".find-music")).toBeVisible();
    await expect(page.locator(".search")).toBeHidden();
    await page.keyboard.press("Control+k");
    await expect(
      page.getByLabel("Search catalog", { exact: true }),
    ).toBeFocused();
    await page
      .getByLabel("Search catalog", { exact: true })
      .fill("Warm Sounds");
    await page
      .getByRole("button", { name: "Search catalog", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Warm Sounds.*Test Artist/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Warm Sounds", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Find downloads", exact: true })
      .click();
    await expect(
      page.getByLabel("Search Soulseek", { exact: true }),
    ).toHaveValue("Test Artist Warm Sounds");
    expect(state.posts()).toBe(0);
    await page
      .getByRole("button", { name: "Search Soulseek", exact: true })
      .click();
    await expect(page.locator(".find-source-row")).toHaveCount(2);
    expect(state.posts()).toBe(1);
    expect(state.polls()).toBe(1);
    await expect(page.locator(".find-source-row").first()).toContainText(
      "fastpeer",
    );
    const filter = page.getByLabel("Filter results");
    await filter.scrollIntoViewIfNeeded();
    const scroll = await page
      .locator("#main-content")
      .evaluate((e) => e.scrollTop);
    await filter.fill("Warm");
    await expect
      .poll(() => page.locator("#main-content").evaluate((e) => e.scrollTop))
      .toBe(scroll);
    await page.getByRole("checkbox", { name: "Free upload slots" }).check();
    await expect(page.locator(".find-source-row")).toHaveCount(1);
    await page
      .getByRole("button", { name: "View folder", exact: true })
      .click();
    const folder =
      width <= 700
        ? page.getByRole("dialog")
        : page.getByRole("complementary", { name: "Folder contents" });
    await expect(folder).toBeVisible();
    await expect(folder).toContainText("1 audio file excluded");
    await expect(
      folder.locator(".find-folder-files label").first(),
    ).toContainText("02 Evening");
    await folder
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    await expect(
      folder.getByRole("button", {
        name: "Request selected tracks",
        exact: true,
      }),
    ).toBeDisabled();
    await folder
      .getByRole("button", { name: "Select all", exact: true })
      .click();
    await folder
      .getByRole("button", { name: "Request selected tracks", exact: true })
      .click();
    await expect(folder.getByRole("status")).toHaveText(
      "Awaiting download approval",
    );
    await page.screenshot({
      path: `.local/find-review/folder-${width}.png`,
      fullPage: true,
    });
    if (width <= 700) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "View folder", exact: true }),
      ).toBeFocused();
    } else await folder.getByRole("button", { name: "Close folder" }).click();
    await page
      .getByRole("button", { name: "View downloads", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel request", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel request", exact: true })
      .click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(
      page.getByLabel("Search Soulseek", { exact: true }),
    ).toHaveValue("Test Artist Warm Sounds");
    await expect(
      page.getByRole("checkbox", { name: "Free upload slots" }),
    ).toBeChecked();
    await expect(page.locator(".find-source-row")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Your library", exact: true })
      .click();
    await page.goBack();
    await expect(page.locator(".find-source-row")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
}
test("discovery without Soulseek and artist exploration", async ({ page }) => {
  const state = await fixture(page, false);
  await page.goto("/find");
  await expect(page.locator(".find-music")).toBeVisible();
  await page
    .getByRole("group", { name: "Catalog search type" })
    .getByRole("button", { name: "Artists", exact: true })
    .click();
  await page.getByLabel("Search catalog", { exact: true }).fill("Test Artist");
  await page
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Test Artist.*Explore releases/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Albums by Test Artist" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Warm Sounds.*Test Artist/ }).click();
  await page
    .getByRole("button", { name: "Find downloads", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Downloads aren’t available" }),
  ).toBeVisible();
  expect(state.posts()).toBe(0);
  expect(state.errors).toEqual([]);
});

test("phone direct file search, filters, song request, and Downloads shortcut", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await page.goto("/find");
  await expect(page.locator(".find-music")).toBeVisible();
  await page
    .getByRole("button", { name: "Direct search", exact: true })
    .click();
  await page
    .getByLabel("Search Soulseek", { exact: true })
    .fill("Test Artist Evening");
  await page
    .getByRole("button", { name: "Search Soulseek", exact: true })
    .click();
  await expect(page.locator(".find-source-row")).toHaveCount(3);
  await page.getByLabel("Minimum bitrate").fill("256");
  await expect(page.locator(".find-source-row")).toHaveCount(0);
  await page.getByLabel("Minimum bitrate").fill("");
  await page.getByRole("combobox", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "MP3", exact: true }).click();
  await expect(page.locator(".find-source-row")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "All formats", exact: true }).click();
  await expect(page.locator(".find-source-row")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Request song", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Awaiting download approval" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View downloads", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel request", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByLabel("Search catalog", { exact: true }),
  ).toBeFocused();
  expect(state.errors).toEqual([]);
});
