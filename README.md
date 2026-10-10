# Cadence

Your music, at home. A self-hosted Go/PostgreSQL music server with a responsive React web client. Each instance owns its catalog, accounts, and listening data. Project code is **GPL-2.0-or-later**.

See [the validation record](docs/VALIDATION.md) for tested behavior, benchmarks, screenshots, and remaining release checks.

## Run with Docker

1. Run `node scripts/setup-env.mjs` to create `.env` with a cryptographically random database password. The script fills a missing or placeholder password and preserves existing configured values. Alternatively, copy `.env.example` to `.env` and supply your own database password.
2. Set `MUSIC_PATH` in `.env` to an existing absolute music-folder path. Keep `.env` private; it is excluded from Git.
3. Run `docker compose up -d --build`.
4. Open http://localhost:8080 and create the administrator account with a display name, lowercase username, and password (at least 3 characters, up to 72 bytes). Setup is available only until the first account is created. Display names preserve capitalization; usernames are normalized to lowercase and sign-in is case-insensitive.
5. Open **Instance settings → Library** and run a scan. Automatic incremental scans also run at startup and hourly by default.

Linux containers run as UID/GID 10001; the mounted music directory must be readable/traversable by that user. Cadence never writes into that mount. For more roots, add read-only bind mounts and set `MUSIC_ROOTS=/music;/more-music` on the app service. Keep roots non-overlapping.

## Listening and administration

- **Instance settings → Metadata review → Edit song metadata → Attribute filter / bulk edit** matches an attribute’s current catalog value exactly, ignoring case, and previews matching songs. Enter a replacement and save suggestions for every match, including songs on other pages. Leave Album empty to turn incorrectly tagged albums (such as `music`) into singles after accepting the suggestions. Other optional fields can also be cleared; title and artist must stay nonblank, and track/disc numbers must be 0–9999. Library exclusions are respected, files are untouched, and a changed match count requires refreshing the preview.

- Administrators can open a user card under **Instance settings → Users**, change **Administrator**, and click **Save user**. Role changes apply to existing sessions immediately and appear in Activity. The last administrator cannot be demoted.

- **Instance settings → Activity** shows persisted user and system events with All/User/System filters, search, and pages of 25 events. Events include sign-ins, session removal (sign-out, revocation, or expiration), failed logins, account/group/access changes, branding/enrichment changes, recorded plays, and library scan results. User events identify the affected listener, not necessarily the administrator who made the change. Play events mean a play was recorded in listening history, not a playback start or stop. Existing records are not backfilled. Activity survives session/user deletion; no passwords, session tokens, or CSRF values are stored. Scan details remain under **Scan activity**.

- **Instance settings → Devices** lists all listeners’ signed-in sessions, ordered by last activity, with browser/app versions, operating system, Cadence web version, and expandable user agents. Search by listener or client. Existing sessions appear when they next make an authenticated request; signing out, revoking sessions, or session expiration removes them. Activity is updated at most once per minute. Clients report their own identifying details.

- **Instance settings → Branding** lets administrators rename the instance. The name is saved in PostgreSQL and appears on the login screen, in the app header, and in the browser title. Names can contain 1–120 characters; surrounding whitespace is removed.

- Open your avatar for profile details, listening settings, the play queue, and sign-out. Administrators also find **Instance settings** here. Volume and playback quality changes apply immediately in the current tab.
- The last song and playback position are saved to your account every 10 seconds during playback, on pause/seek/song changes, and when the tab is hidden or leaves. Reload or sign in on another device to restore the song and position, then press **Play** to continue. A per-account browser checkpoint also recovers interrupted saves on the same device. Removed or excluded songs are skipped. Final close/reload saves use authenticated [keepalive requests](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive); abrupt browser/device termination can fall back to the preceding checkpoint, and offline progress becomes available on other devices after it syncs.
- **Listening settings → Automatically open mini player** is on by default and saved per account in this browser. On supported desktop browsers, switching away while music plays can open floating playback, seek, and volume controls; returning closes an automatically opened window. The player-bar mini-player button also opens it manually, including while paused. It uses Document Picture-in-Picture on HTTPS or localhost. Automatic opening requires the browser's site permission and media eligibility rules; allow automatic picture-in-picture for this site if prompted. [Chrome's automatic PiP guidance](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback) explains these requirements. On HTTP LAN addresses (such as `http://192.168.0.29:8080`) and browsers without Document PiP, the manual button opens a regular popout sharing the same playback controls. Allow popups for the site if blocked. This fallback does not stay always on top and does not open automatically; native PiP requires HTTPS or localhost. System media controls remain available.
- Library pages, album/artist details, playlists, and administrator tabs have shareable URL paths (for example `/songs`, `/albums/<id>`, `/playlists/<id>`, and `/admin/people`). Refresh restores the page, Back/Forward follows navigation, and search text persists as `?q=...`. Signing in from a direct link opens that page; access still depends on the signed-in account's permissions.
- Scanning uses embedded tags first. Missing tags fall back to common `Artist - Title` filenames, remove recognized video labels/YouTube IDs, and recognize `Title (From Movie) Artists` and marked `Title [Official Video] - Artist` names. Meaningful parentheses and featured credits remain. Run a full scan to refresh existing fallback metadata; music files and accepted overrides are preserved.
- **Instance settings → Library → Rescan only missing metadata or artwork** rechecks incomplete tracks even when their files are unchanged, and indexes new files. Completeness uses current catalog values, including accepted edits: blank title/artist, unknown artist, missing album artist on an album track, or absent/unavailable artwork qualify. Singles do not require album metadata. Optional year, genre, and track/disc numbers do not qualify by themselves. Complete tracks are skipped; full-scan mode is disabled while this option is selected. Enable external lookups separately if you want enrichment suggestions.
- Songs without album metadata are classified as **Single**, omit album attributes from API responses, and stay out of album lists. Clearing a song’s album in the metadata editor makes it a single after acceptance. Scans use embedded album tags or explicit soundtrack names in filenames; folder names no longer become albums. Run a full rescan to correct previously inferred folder albums; accepted album overrides remain preserved. Singles skip external album enrichment.
- Artist pages include saved profiles. Administrators can use **Fetch artist profile** for MusicBrainz facts, genres, and links, plus Wikipedia biographies and Wikimedia photos where available. Set `METADATA_USER_AGENT` with project/contact information first. Enter a MusicBrainz artist UUID to resolve ambiguous names or select a specific artist; profile lookups are explicit and do not require global enrichment to be enabled. Biography and photo attribution links stay visible. Saved profiles are readable only when the listener can access that artist’s songs.
- **Refresh this artist’s songs** starts an artist-scoped scan, with an option to limit it to missing metadata/artwork. It preserves accepted corrections and skips other artists. External song enrichment still follows the Instance settings toggle, and suggested corrections are reviewed there.
- Commas in artist credits separate performers: `Artist A, Artist B` appears on both individual artist pages, with each song counted once per performer. Song rows, the player, queue, lyrics, and mini player link each name separately. Existing library entries and accepted artist edits gain these links without a rescan; original metadata text stays intact. Spaces and repeated/empty names are cleaned up for display. Other text, such as `&` or `feat.`, remains part of the artist name.
- In **Your profile**, update your display name, upload/remove an avatar, or change your password by entering your current password. A password change keeps this session signed in and revokes your other sessions. JPEG/PNG avatars are limited to 2 MiB, center-cropped and resized, and stored in PostgreSQL with the account.
- In **Instance settings → People**, click a listener to edit their username/display name, assign groups, upload/remove their avatar, revoke sessions, or reset their password without the current password. Administrator password resets revoke all of that user's sessions, including your own if you reset your own account. Account metadata and expired sessions refresh each minute, on window focus, and on reconnection.
- Volume uses a dB-based curve and shows percentage plus attenuation on hover or keyboard focus; zero mutes playback. Quality uses a custom selector with bitrate descriptions. Create playlists in a dialog with a name and one of six built-in icons; icons are saved on the server. On wide screens the queue occupies its own column; on smaller screens it opens as a dedicated view.
- Browse albums/artists, search words in tags, like songs, create personal playlists, and edit the play queue. Artist pages also show albums containing their accessible server songs, including collaboration credits, with artwork and links to each album. **Play loaded songs** queues the currently fetched tracks; use Load more for larger collections.
- Open the microphone button or the playback panel's **Lyrics** tab for the current song. [LRCLIB](https://lrclib.net/docs) supplies synchronized lyrics with highlighting, automatic following, and click-to-seek lines; plain lyrics and instrumental/missing states are supported. Manual scrolling pauses following until you enable it again. Lookups run on demand through the server and send title, artist, album, and duration to LRCLIB, never the audio file. Accurate tags and a matching recording duration improve matches. Successful lookups are cached in memory for 24 hours, misses for 5 minutes, with a 64-entry limit; outages/rate limits show a retry state.
- Auto plays original supported audio and falls back to MP3 320 kbps on unsupported formats/playback errors. High and Saver explicitly convert to 320/128 kbps. Seeking in converted audio works once conversion finishes; initial conversion can take time. FFmpeg workers and disk cache are bounded by configuration.
- A play is recorded after 30 seconds or half the track, whichever is shorter. Recently played complete audio is fetched opportunistically into a 256 MiB memory cache. Cached tracks can play through connection loss in the open tab. This is **not durable offline downloading**: reloading/closing the page clears the cache. No new server views load while disconnected.
- Create invited accounts and groups in settings. All music is accessible unless an assigned group excludes a folder, album, or track. Exclusions also apply to administrators' listening requests. IDs are available in API responses; folder paths are container paths. Every artist/album count includes only visible tracks.
- Scans preserve extracted tags and catalog overrides separately. A full scan can generate whitespace-cleanup suggestions and optional external suggestions. Accept/dismiss changes in settings; acceptance changes only the database. Remove an override to restore its extracted value. Moving files externally creates new track IDs; playlists/history do not automatically follow moves.
- In **Instance settings → Suggestions**, browse indexed server roots/folders or search songs, then select a file to edit title, artist/performer, album, album artist, year, genre, track number, and disc number. Save proposals and use **Choose suggested metadata** to compare current values against each source, edit replacements, preview artwork, and apply individual fields atomically. Competing candidates for replaced fields are dismissed; kept fields stay pending. Stale comparisons reject the whole update. Unsaved edits and failed saves are preserved; each field can restore its extracted value. See [Metadata workflow and reference review](docs/METADATA_WORKFLOW.md).
- **Review changes → Bulk accept by field → Accept all selected fields** accepts all pending suggestions for your chosen fields, including pages not yet loaded. Select titles, albums, artists, or any combination, including artwork. The batch is atomic; when one song has conflicting values for a field, the newest suggestion wins. Music files remain intact.
- External enrichment is off by default. Set `METADATA_USER_AGENT` to an identifying application/contact string, enable lookup, and run a full scan. MusicBrainz release IDs in tags are preferred; otherwise a high-confidence album search yields **suggestions**, never automatic corrections. Missing covers are cached as artwork suggestions. MusicBrainz requests are limited to one per second, so enriched full scans can be slow.
- Online permission refresh runs each minute and on reconnection. Cached tracks that are no longer accessible are removed. Audio already received by a disconnected client cannot be immediately revoked.

## Remote access

Cadence is an installable PWA in production builds. Use your browser's **Install app** action, or Safari's **Share → Add to Home Screen** on iPhone/iPad. Installation and service workers require HTTPS (localhost also works); plain HTTP on a LAN address does not enable offline support. Development mode does not register a service worker.

The service worker caches only public static assets and shows an offline page when navigation cannot reach the server. Account responses, artwork, and audio are not stored in its persistent cache. Installation does not download music: the existing per-tab audio cache still clears on reload. Updates wait until all Cadence tabs/app windows close before activating, so playback is not interrupted. Reopen the app online to use the latest build.

Run behind an owner-managed HTTPS reverse proxy. Set `PUBLIC_URL=https://music.example.com`; this enables Secure cookies and fixes the accepted mutation origin. Leave PostgreSQL unexposed. Example Caddy configuration when Caddy runs on the host:

```caddy
music.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

When the proxy runs in Docker, connect it to the app's network and proxy to `app:8080`. Configure sufficient proxy read timeouts for conversion. LAN-only HTTP can use `BIND_ADDRESS=0.0.0.0` and a matching HTTP `PUBLIC_URL`; use HTTPS for internet access. Authentication throttling uses the direct peer address, so proxy users share that rate limit. Use proxy-side login throttling for per-client controls.

## Development

Requires Go 1.26.9+, Node 22.16+, PostgreSQL 17+, FFmpeg and FFprobe on PATH. Go automatically selects the patched toolchain declared by go.mod.

```powershell
# Terminal 1: use an existing local PostgreSQL database
$env:DATABASE_URL='postgres://cadence:password@localhost:5432/cadence?sslmode=disable'
$env:MUSIC_ROOTS='C:\Music'
$env:PUBLIC_URL='http://localhost:5173'
go run ./cmd/cadence
# Terminal 2
cd web
npm ci
npm run dev
```

For a production local build, run `npm run build` in `web`, set `PUBLIC_URL=http://localhost:8080`, and run the Go server from the project root. The server serves `web/dist`. Health: `/healthz`. API: `/api/v1`; contract: [docs/openapi.yaml](docs/openapi.yaml).

```text
go test ./...
go vet ./...
node scripts/check-openapi.mjs
cd web && npm test && npm run build
```

Set `TEST_DATABASE_URL` to a **disposable test database** to run PostgreSQL/HTTP integration tests. Tests create and drop isolated `cadence_test_*` schemas. Set it before `go test ./...`. FFmpeg integration tests skip if tools are absent. Scale benchmark: `go test ./internal/postgres -run '^$' -bench BenchmarkLargeLibrary -benchtime=3x -timeout=10m` with that variable set. Results reflect your hardware; the 250,000-track/20-listener targets are not universal capacity guarantees.

## Storage, backups, upgrades

Account migration preserves existing login names as display names and lowercases usernames. If legacy accounts differ only by case or surrounding spaces, migration stops without changing data; rename those conflicting accounts in the old database before upgrading.

Back up the PostgreSQL database, app data volume, and original music separately. For a consistent catalog/app-data snapshot, stop app activity during backup. PostgreSQL example:

```sh
docker compose stop app
docker compose exec -T db pg_dump -U cadence -d cadence -Fc > cadence.dump
docker run --rm -v <project>_app_data:/data:ro -v "$PWD/backups:/backup" debian:bookworm-slim tar czf /backup/app-data.tar.gz -C /data .
docker compose start app
```

Find the actual app volume with `docker volume ls`. Restore the dump into an empty database using `pg_restore -U cadence -d cadence --no-owner`; restore app-data into its volume and ensure UID 10001 owns it. On Windows, use a binary-safe shell or pg_dump's `-f` with a bind-mounted backup directory rather than Windows PowerShell 5 stdout redirection for custom-format dumps.

Before upgrading, back up both volumes. Update code and run `docker compose up -d --build`. Schema migrations run transactionally with an advisory lock. Database schema rollback uses the backup; avoid booting an older binary against a newer schema. PostgreSQL major upgrades require a separate dump/restore or pg_upgrade procedure. Do not use `docker compose down -v` unless you intend to delete persistent data. The transcoding cache limit applies to retained files; allow additional temporary disk space up to that limit per FFmpeg worker.

## Architecture and limits

`internal/domain` defines repository contracts; `internal/postgres` owns SQL and migration details. The scanner and HTTP layer depend on domain interfaces. Future SQLite/MySQL/MongoDB adapters must pass equivalent repository contract tests; they are not implemented in v1.

One application process owns an instance. There is no public registration, centralized hosting, music-upload endpoint, recommendation engine, native app, or persistent offline download. Queue/temporary cache are per-tab. Album grouping uses source directory, album artist, and album tags; catalog renaming does not change album IDs. Original files with missing/unknown duration may not show an accurate progress bar.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [COPYING](COPYING), and [LICENSE](LICENSE) for distribution information.
