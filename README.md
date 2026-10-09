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

- Open your avatar for profile details, listening settings, the play queue, and sign-out. Administrators also find **Instance settings** here. Volume and playback quality changes apply immediately in the current tab.
- Library pages, album/artist details, playlists, and administrator tabs have shareable URL paths (for example `/songs`, `/albums/<id>`, `/playlists/<id>`, and `/admin/people`). Refresh restores the page, Back/Forward follows navigation, and search text persists as `?q=...`. Signing in from a direct link opens that page; access still depends on the signed-in account's permissions.
- In **Your profile**, update your display name, upload/remove an avatar, or change your password by entering your current password. A password change keeps this session signed in and revokes your other sessions. JPEG/PNG avatars are limited to 2 MiB, center-cropped and resized, and stored in PostgreSQL with the account.
- In **Instance settings → People**, click a listener to edit their username/display name, assign groups, upload/remove their avatar, revoke sessions, or reset their password without the current password. Administrator password resets revoke all of that user's sessions, including your own if you reset your own account. Account metadata and expired sessions refresh each minute, on window focus, and on reconnection.
- Volume uses a dB-based curve and shows percentage plus attenuation on hover or keyboard focus; zero mutes playback. Quality uses a custom selector with bitrate descriptions. Create playlists in a dialog with a name and one of six built-in icons; icons are saved on the server. On wide screens the queue occupies its own column; on smaller screens it opens as a dedicated view.
- Browse albums/artists, search words in tags, like songs, create personal playlists, and edit the play queue. **Play loaded songs** queues the currently fetched tracks; use Load more for larger collections.
- Auto plays original supported audio and falls back to MP3 320 kbps on unsupported formats/playback errors. High and Saver explicitly convert to 320/128 kbps. Seeking in converted audio works once conversion finishes; initial conversion can take time. FFmpeg workers and disk cache are bounded by configuration.
- A play is recorded after 30 seconds or half the track, whichever is shorter. Recently played complete audio is fetched opportunistically into a 256 MiB memory cache. Cached tracks can play through connection loss in the open tab. This is **not durable offline downloading**: reloading/closing the page clears the cache. No new server views load while disconnected.
- Create invited accounts and groups in settings. All music is accessible unless an assigned group excludes a folder, album, or track. Exclusions also apply to administrators' listening requests. IDs are available in API responses; folder paths are container paths. Every artist/album count includes only visible tracks.
- Scans preserve extracted tags and catalog overrides separately. A full scan can generate whitespace-cleanup suggestions and optional external suggestions. Accept/dismiss changes in settings; acceptance changes only the database. Remove an override to restore its extracted value. Moving files externally creates new track IDs; playlists/history do not automatically follow moves.
- External enrichment is off by default. Set `METADATA_USER_AGENT` to an identifying application/contact string, enable lookup, and run a full scan. MusicBrainz release IDs in tags are preferred; otherwise a high-confidence album search yields **suggestions**, never automatic corrections. Missing covers are cached as artwork suggestions. MusicBrainz requests are limited to one per second, so enriched full scans can be slow.
- Online permission refresh runs each minute and on reconnection. Cached tracks that are no longer accessible are removed. Audio already received by a disconnected client cannot be immediately revoked.

## Remote access

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
