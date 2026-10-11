import { test, expect, type Page } from "@playwright/test";
const user = {
  id: "u1",
  username: "danny",
  displayName: "Danny",
  admin: true,
  groups: ["g1"],
  avatar: false,
  avatarVersion: 0,
};
const track = {
  id: "t1",
  title: "Evening Light",
  artist: "Test Artist",
  album: "Warm Sounds",
  albumId: "a1",
  number: 1,
  disc: 1,
  year: "2026",
  genre: "Jazz",
  duration: 120,
  codec: "mp3",
  mime: "audio/mpeg",
  artwork: false,
  liked: false,
};
const library = {
  id: "l1",
  name: "Music",
  folders: ["/music"],
  everyone: true,
  users: [],
  groups: [],
};
const playlist = { id: "p1", name: "Late Nights", icon: "music" };
const capabilities = {
  configured: true,
  enabled: true,
  allowed: true,
  presentation: "separate",
  losslessOnly: false,
  allowedFormats: ["mp3", "flac"],
};
async function fixture(
  page: Page,
  state: "populated" | "empty" | "error" = "populated",
) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  let deletes = 0,
    creates = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1", "");
    let body: unknown = {},
      status = 200;
    const items = <T>(value: T[]) => (state === "empty" ? [] : value);
    if (
      state === "error" &&
      ![
        "/status",
        "/me",
        "/libraries",
        "/playlists",
        "/me/playback",
        "/soulseek/capabilities",
      ].includes(path)
    ) {
      status = 500;
      body = { error: "Fixture request failed" };
    } else if (path === "/status")
      body = { name: "Cadence", setupRequired: false };
    else if (path === "/me" || path === "/login")
      body = { user, csrf: "fixture" };
    else if (path === "/libraries" || path === "/admin/libraries")
      body = items([library]);
    else if (path === "/playlists") {
      if (request.method() === "POST") {
        creates++;
        if (creates === 1) {
          status = 500;
          body = { error: "Playlist save failed" };
        } else body = { ...playlist, id: "p2", ...request.postDataJSON() };
      } else body = [playlist];
    } else if (path === "/playlists/p1" && request.method() === "DELETE") {
      deletes++;
      if (deletes === 1) {
        status = 500;
        body = { error: "Playlist deletion failed" };
      }
    } else if (path === "/me/playback")
      body = {
        trackId: "",
        position: 0,
        revision: 0,
        writer: "",
        sequence: 0,
        track: null,
      };
    else if (path === "/albums")
      body = items([
        {
          id: "a1",
          title: "Warm Sounds",
          artist: "Test Artist",
          tracks: 1,
          coverId: "",
        },
      ]);
    else if (path === "/artists")
      body = items([{ name: "Test Artist", tracks: 1 }]);
    else if (path === "/artists/albums")
      body = {
        albums: items([
          {
            id: "a1",
            title: "Warm Sounds",
            artist: "Test Artist",
            tracks: 1,
            coverId: "",
          },
        ]),
        singles: [],
      };
    else if (path === "/artists/profile") body = { profile: null };
    else if (path === "/tracks")
      body = {
        items: items([track]),
        total: state === "empty" ? 0 : 1,
        offset: 0,
        limit: 100,
      };
    else if (path === "/tracks/t1") body = track;
    else if (path === "/soulseek/capabilities") body = capabilities;
    else if (path === "/soulseek/requests")
      body = items([
        {
          id: "r1",
          userId: "u1",
          username: "peer",
          folder: "Album",
          files: [
            {
              filename: "Album/song.mp3",
              size: 100,
              bytesTransferred: 25,
              state: "InProgress",
            },
          ],
          rule: {
            subject: "",
            mode: "review",
            libraryId: "l1",
            folder: "/music",
          },
          reviewTiming: "before",
          approved: true,
          state: "downloading",
          error: "",
          created: "2026-10-10T12:00:00Z",
        },
      ]);
    else if (path === "/admin/soulseek")
      body = {
        configured: true,
        writableRoots: ["/music"],
        staging: "/staging",
        settings: {
          ...capabilities,
          users: ["u1"],
          groups: [],
          reviewTiming: "before",
          default: {
            subject: "",
            mode: "review",
            libraryId: "l1",
            folder: "/music",
          },
          userRules: [],
          groupRules: [],
          sharing: "selected",
          shareFolders: ["/music"],
          sharingError: "",
        },
      };
    else if (path === "/admin/users") body = items([user]);
    else if (path === "/admin/groups")
      body = items([{ id: "g1", name: "Listeners" }]);
    else if (path === "/admin/exclusions" || path === "/admin/suggestions")
      body = [];
    else if (path === "/admin/scans")
      body = items([
        {
          id: "scan1",
          started: "2026-10-10T12:00:00Z",
          finished: "2026-10-10T12:01:00Z",
          status: "completed",
          indexed: 1,
          errors: ["Example recoverable error"],
        },
      ]);
    else if (path === "/admin/config")
      body = { roots: ["/music"], settings: { enrichment: true } };
    else if (path === "/admin/devices")
      body = items([
        {
          id: "d1",
          user,
          userAgent: "Mozilla/5.0 fixture",
          clientVersion: "0.1.0",
          lastActive: "2026-10-10T12:00:00Z",
        },
      ]);
    else if (path === "/admin/activity") body = { items: [], total: 0 };
    else if (path === "/admin/library" || path === "/admin/folders")
      body = { items: [], total: 0, roots: ["/music"], limit: 50, offset: 0 };
    else if (path === "/admin/sync/lastfm")
      body = {
        configured: false,
        apiKey: "",
        callbackURL: "http://localhost/callback",
      };
    else if (path === "/sync")
      body = {
        connections: [
          {
            provider: "listenbrainz",
            username: "Danny",
            plays: true,
            nowPlaying: true,
            likes: true,
            paused: false,
            error: "",
            lastSuccess: null,
            pending: 0,
            waitingFeedback: 0,
          },
        ],
        lastfmConfigured: false,
        lastfmAuthorizationAvailable: false,
      };
    else if (path.includes("/lyrics"))
      body = { lyrics: "Evening light", synced: [], source: "fixture" };
    else if (path.includes("/stream")) {
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: Buffer.alloc(44),
      });
      return;
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return failures;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
const routes = [
  "/",
  "/search?q=Evening",
  "/library",
  "/songs",
  "/albums",
  "/artists",
  "/likes",
  "/history",
  "/albums/a1",
  "/artists/Test%20Artist",
  "/playlists/p1",
  "/find",
  ...[
    "dashboard",
    "branding",
    "devices",
    "library",
    "people",
    "permissions",
    "metadata",
    "suggestions",
    "activity",
    "scans",
    "soulseek",
    "sync",
  ].map((tab) => `/admin/${tab}`),
];
for (const viewport of [
  { width: 1280, height: 844 },
  { width: 900, height: 844 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 700, height: 390 },
]) {
  test(`all screens at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const failures = await fixture(page);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator(".auth")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(page.locator(".collection-placeholder")).toHaveCount(0);
      if (route === "/admin/soulseek")
        await expect(page.locator(".soulseek-card").first()).toBeVisible();
      if (route === "/admin/soulseek")
        await page.locator(".soulseek-card").first().scrollIntoViewIfNeeded();
      if (route === "/admin/people")
        await expect(
          page.getByRole("button", { name: "Manage Danny (@danny)" }),
        ).toBeVisible();
      await noOverflow(page);
      if (["/songs", "/admin/soulseek", "/admin/people"].includes(route))
        await page.screenshot({
          path: testInfo.outputPath(`${route.replaceAll("/", "-")}.png`),
          fullPage: true,
        });
    }
    await page.goto("/songs");
    await page.getByRole("button", { name: "Account menu for Danny" }).click();
    await page.getByRole("menuitem", { name: "Listening settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("combobox", { name: "Playback quality" }).click();
    await expect(page.getByRole("option", { name: /High/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Account menu for Danny" }).click();
    await page.getByRole("menuitem", { name: "Your profile" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(page.getByLabel("Current password")).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press("Escape");
    expect(failures).toEqual([]);
  });
}
for (const state of ["empty", "error"] as const) {
  test(`${state} states across frontend screens`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const failures = await fixture(page, state);
    for (const route of routes) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      if (state === "empty")
        await expect(page.locator(".collection-placeholder")).toHaveCount(0);
      else if (!["/library"].includes(route))
        await expect(
          page.getByText("Fixture request failed", { exact: false }).first(),
        ).toBeVisible();
      await noOverflow(page);
    }
    expect(failures).toEqual([]);
  });
}
test("playlist creation and deletion preserve failures for retry", async ({
  page,
}) => {
  const failures = await fixture(page);
  await page.goto("/library");
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .first()
    .click();
  await page.getByPlaceholder("e.g. Late nights").fill("New mix");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(page.getByText("Playlist save failed")).toBeVisible();
  await expect(page.getByPlaceholder("e.g. Late nights")).toHaveValue(
    "New mix",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/playlists/p1");
  await page
    .getByRole("button", { name: "Delete playlist", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete playlist", exact: true })
    .click();
  await expect(page.getByText("Playlist deletion failed")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete playlist", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("administrator editor, uploads and inline password validation", async ({
  page,
}, testInfo) => {
  const failures = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/people");
  await page.getByRole("button", { name: "Manage Danny (@danny)" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage user" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Administrator" }),
  ).toBeChecked();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Upload avatar" }).click();
  await chooser;
  await dialog
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await dialog
    .getByLabel("New password", { exact: true })
    .fill("validpassword");
  await dialog.getByLabel("Confirm new password").fill("differentpassword");
  await dialog
    .getByRole("button", { name: "Reset password", exact: true })
    .last()
    .click();
  await expect(dialog.getByText("New passwords do not match.")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("admin-editor-phone.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("loading state and authentication use themed controls", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Sign in" }),
    }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/status", async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto("/songs", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Connecting to your music…")).toBeVisible();
  release();
  await expect(page.locator(".auth")).toBeVisible();
  await page.locator(".auth").getByRole("button").click();
  await expect(
    page.locator(".auth input[aria-invalid=true]").first(),
  ).toBeFocused();
  await noOverflow(page);
});

test("playback tabs, phone sheets, sliders, mini player and offline fallback", async ({
  page,
}, testInfo) => {
  const failures = await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "documentPictureInPicture", {
      value: undefined,
    });
  });
  await page.route("**/api/v1/me/playback", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        trackId: "t1",
        position: 12.3,
        revision: 1,
        writer: "00000000-0000-4000-8000-000000000001",
        sequence: 1,
        track,
      }),
    }),
  );
  await page.goto("/songs");
  const volume = page.getByRole("slider", { name: "Volume" });
  await expect(volume).toBeVisible();
  await volume.focus();
  await page.keyboard.press("Home");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(volume).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Play queue", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Queue" })).toBeVisible();
  await page.getByRole("tab", { name: "Queue" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Lyrics" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Close lyrics", exact: true }).click();
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open mini player" }).click();
  const popup = await popupEvent;
  await popup.screenshot({ path: testInfo.outputPath("mini-player.png") });
  await expect(popup.getByRole("slider", { name: "Volume" })).toBeVisible();
  await popup.getByRole("slider", { name: "Volume" }).focus();
  await popup.keyboard.press("Home");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");
  await popup.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Open Now Playing/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Seek" })).toBeVisible();
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Queue" })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("queue-phone.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/offline.html");
  await expect(
    page.getByRole("heading", { name: "You're offline" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  expect(failures).toEqual([]);
});

async function playlistFixture(page: Page) {
  await fixture(page);
  const state = {
    ids: new Set(["p1"]),
    loads: 0,
    saves: 0,
    failLoad: false,
    failSave: false,
    creates: 0,
    delay: 0,
  };
  await page.route("**/api/v1/tracks/t1/playlists", async (route) => {
    state.loads++;
    await route.fulfill({
      status: state.failLoad ? 500 : 200,
      json: state.failLoad
        ? { error: "Membership failed" }
        : { playlistIds: [...state.ids] },
    });
  });
  await page.route("**/api/v1/playlists**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/playlists") {
      if (request.method() === "POST") {
        state.creates++;
        await route.fulfill({
          json: { ...playlist, id: "p2", ...request.postDataJSON() },
        });
      } else
        await route.fulfill({
          json: [playlist, { id: "p2", name: "Morning", icon: "sun" }],
        });
    } else if (path.includes("/tracks")) {
      state.saves++;
      if (state.delay)
        await new Promise((resolve) => setTimeout(resolve, state.delay));
      if (state.failSave)
        await route.fulfill({
          status: 500,
          json: { error: "Membership save failed" },
        });
      else {
        const id = path.split("/")[2];
        if (request.method() === "POST") state.ids.add(id);
        else state.ids.delete(id);
        await route.fulfill({ json: {} });
      }
    } else await route.fallback();
  });
  await page.goto("/songs");
  await expect(
    page.getByRole("button", { name: "Actions for Evening Light" }),
  ).toBeVisible();
  return state;
}
async function openPlaylistSubmenu(page: Page, rightClick = false) {
  if (rightClick) await page.locator(".track-row").click({ button: "right" });
  else
    await page
      .getByRole("button", { name: "Actions for Evening Light" })
      .click();
  await page
    .getByRole("menuitem", { name: "Add to playlist", exact: true })
    .click();
}
test("playlist submenu persists bookmarks and toggles through both menu entry points", async ({
  page,
}) => {
  const state = await playlistFixture(page);
  await openPlaylistSubmenu(page);
  const saved = page.getByRole("menuitemcheckbox", {
    name: "Late Nights: Added",
  });
  await expect(saved).toHaveAttribute("aria-checked", "true");
  await expect(saved.locator(".lucide-bookmark")).toHaveAttribute(
    "fill",
    "currentColor",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await saved.click();
  const empty = page.getByRole("menuitemcheckbox", {
    name: "Late Nights: Not added",
  });
  await expect(empty.locator(".lucide-bookmark")).toHaveAttribute(
    "fill",
    "none",
  );
  await empty.click();
  await expect(saved).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openPlaylistSubmenu(page, true);
  await expect(saved).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await openPlaylistSubmenu(page);
  await expect(saved).toHaveAttribute("aria-checked", "true");
  expect(state.loads).toBe(3);
  expect(state.saves).toBe(2);
});
test("playlist submenu handles search, keyboard, failures and narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const state = await playlistFixture(page);
  state.failLoad = true;
  await openPlaylistSubmenu(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Membership failed" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox")).toHaveCount(0);
  state.failLoad = false;
  await page.getByRole("menuitem", { name: "Retry loading playlists" }).click();
  const saved = page.getByRole("menuitemcheckbox", {
    name: "Late Nights: Added",
  });
  await expect(saved).toBeVisible();
  const bounds = await page.locator(".playlist-submenu").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await page.getByRole("textbox", { name: "Find a playlist" }).fill("Late");
  await expect(page.getByRole("menuitemcheckbox")).toHaveCount(1);
  state.failSave = true;
  await saved.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Membership save failed" }),
  ).toBeVisible();
  await expect(saved).toHaveAttribute("aria-checked", "true");
  state.failSave = false;
  state.delay = 200;
  await saved.dblclick();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Late Nights: Not added" }),
  ).toBeVisible();
  expect(state.saves).toBe(2);
  await page.keyboard.press("Escape");
  const trigger = page.getByRole("menuitem", {
    name: "Add to playlist",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Late Nights: Not added" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("textbox", { name: "Find a playlist" }),
  ).toBeFocused();
  await page.keyboard.type("Morning");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Morning: Not added" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Morning: Added" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
test("playlist submenu creates and adds without duplicating a playlist on retry", async ({
  page,
}) => {
  const state = await playlistFixture(page);
  await openPlaylistSubmenu(page);
  await page.getByRole("menuitem", { name: "Create playlist" }).click();
  const dialog = page.getByRole("dialog", { name: "Create playlist" });
  await dialog.getByRole("textbox", { name: "Playlist name" }).fill("New mix");
  state.failSave = true;
  await dialog
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText("Membership save failed");
  expect(state.creates).toBe(1);
  state.failSave = false;
  await dialog
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(state.creates).toBe(1);
  expect(state.ids.has("p2")).toBe(true);
});

test.describe("touch playlist submenu", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("toggles membership with touch", async ({ page }) => {
    await playlistFixture(page);
    await page.getByRole("button", { name: "Actions for Evening Light" }).tap();
    await page
      .getByRole("menuitem", { name: "Add to playlist", exact: true })
      .tap();
    await page
      .getByRole("menuitemcheckbox", { name: "Late Nights: Added" })
      .tap();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Late Nights: Not added" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});
