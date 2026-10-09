# Validation record

Validated locally on Windows with an AMD Ryzen 5 2600 (6 cores), PostgreSQL 17.11, Go 1.26.9, Node 22.16, and FFmpeg 6.0. This describes observed checks, not a universal capacity guarantee.

- `go test -race ./...`: passed with a real disposable PostgreSQL database. Includes repository contracts, one-time setup/login, CSRF/origin rejection, private playlists, group exclusions, scan errors, unavailable mounts, source-file preservation, catalog override persistence, range seeking, simultaneous media requests, migration re-entry, and cache limits/cancellation.
- `go vet ./...`: passed.
- Frontend: TypeScript check, production Vite build, and three cache tests passed.
- `node scripts/check-openapi.mjs`: passed, 32 documented paths.
- `npm audit`: zero reported vulnerabilities. `govulncheck` using Go 1.26.9: zero vulnerabilities reachable from project code; one advisory remains in a required module for code paths the application does not invoke.
- `docker compose --env-file .env.example config --quiet`: passed. Official Go/Node base-image manifests resolved. A full container build/run was not tested locally because Docker Desktop's engine was not running; CI includes a container build.
- Real PostgreSQL custom-format backup and restore into a separate database preserved 1 test account, 3 generated audio tracks, 1 playlist, 1 like, and 8 recorded play events.
- In-app Chromium browser checks: first-run setup, original and 128 kbps converted playback, keyboard seeking, quality switching while paused with position preserved, mobile playlist creation, playlist membership, likes, rescans, and navigation. Cached audio played successfully after the Go server was stopped; the client displayed Offline session.
- Responsive views checked at 390 × 844 and 1280 × 800. Screenshots use generated sine-wave test fixtures, not a real music collection.

## Account and interaction update (2026-10-09)

- `npm test`: all three existing cache tests passed. `npm run build`: TypeScript checking and production Vite build passed. The project has no configured lint command; modified frontend files were checked with Prettier.
- Headless Chromium checks with isolated API fixtures passed at 1280 × 844, 900 × 844, and 390 × 844: avatar toggling, keyboard opening and arrow navigation, Escape and outside-click dismissal, profile details, dialog focus restoration and modal keyboard containment, immediate quality/volume changes, queue access, queue and playlist-add feedback, administrator navigation, hidden administration for listener accounts, and sign-out returning to sign-in.
- Desktop and mobile profile, listening-settings, and account-menu screenshots were visually inspected. Checks ran with reduced motion enabled and found no horizontal page overflow or browser runtime errors.
- Browser API responses were fixtures. These checks do not revalidate live backend logout, authorization enforcement, streaming, or transcoding. Profile editing and durable preference storage were not added. Temporary scripts and screenshots remain in ignored `.local/`.

## Playback controls and playlist dialog update (2026-10-09)

- Frontend: five tests passed, including dB/gain conversion, mute, full gain, and equal gain ratios for equal slider steps. TypeScript checking, production Vite build, and Prettier checks passed. No additional UI dependency was introduced.
- Go tests passed with race detection against a separate disposable PostgreSQL database. Go vet and the OpenAPI checker passed. Added tests cover playlist icon validation, API defaults and rejection, persistence, and upgrading existing playlists with a default icon. Scanner/HTTP integration checks also passed.
- Chromium fixture checks passed at 1280 × 844, 900 × 844, and 390 × 844: actual audio-element gain, volume popup, mute/unmute, keyboard quality selection, nested Escape dismissal, playlist icon/name selection, failed-save recovery, creation and reload, independently scrolling queue, and narrow-screen queue layout. No horizontal page overflow or browser runtime errors occurred. Dialogs, dropdowns, popups, and desktop/mobile queue layouts were visually reviewed.
- UI checks used isolated API fixtures; backend playlist checks used real PostgreSQL. Cross-browser and physical-device listening checks remain outside this update. Temporary browser scripts, screenshots, and test data stay in ignored `.local/`.

## People administrator checkbox update (2026-10-09)

- Replaced the administrator field with a themed checkbox component: 24-pixel check indicator, a larger clickable label, permission description, visible keyboard focus, and disabled styling. Native checkbox semantics and FormData behavior are preserved.
- Five frontend tests, TypeScript/production build, and Prettier checks passed. Chromium fixture checks at 1280 × 844 and 390 × 844 passed for label and Space-key toggling, visual checked state, disabling during submission, true/false administrator payloads, form reset, and no horizontal overflow or runtime errors. Desktop and mobile screenshots were reviewed. Account creation responses were fixtures; backend behavior was unchanged.

## Account editing update (2026-10-09)

- Added persistent avatar storage and a migration preserving existing account names/passwords with empty-avatar defaults. Avatars are authenticated JPEG responses; uploaded JPEG/PNG data is bounded by byte/dimension/pixel limits, cropped, resized, and re-encoded.
- Go tests passed with race detection and a separate disposable PostgreSQL database. Tests cover wrong/missing current passwords, password bounds, preserved current session, revocation of other sessions, administrator resets/revocation, stale-password login protection, CSRF and non-admin rejection, name normalization, username conflicts, atomic username/group rollback, avatar upload/removal/versioning, private avatar reads, invalid/oversized images, and avatar migration. Go vet and the OpenAPI checker passed with 38 documented paths.
- Frontend tests, TypeScript/production build, and Prettier checks passed. Chromium fixture checks at 1280 × 844 and 390 × 844 passed for profile name/avatar changes, immediate header updates, password confirmation and current-password errors, password-field clearing on success, clickable user rows, group/username edits, save-error recovery, administrator reset without current password, session revocation, avatar removal, focus restoration, account refresh on focus, self-reset sign-out, and no page overflow/runtime errors. Profile and user-editor screenshots were visually reviewed.
- Browser requests used isolated fixtures; backend account checks used real PostgreSQL. Cross-browser, physical-device avatar picking, and simultaneous multi-device UI refresh remain outside this update. Temporary scripts, images, and databases were excluded from Git.

## Modal dismissal update (2026-10-09)

- Account/profile, listening settings, user editor, and playlist dialogs now dismiss on an outside click or tap. Both ends of a pointer gesture must be outside; dialog padding, scrollbars, and drags from inside do not dismiss. Pending saves continue to block dismissal.
- Frontend tests, TypeScript/production build, formatting, and diff checks passed. Chromium fixture checks at desktop and phone widths passed for dismissal, focus restoration, padding, drag gestures, and pending-save protection. The desktop-only playlist trigger was invoked programmatically at phone width to check its dialog. Cross-browser and physical touchscreen checks were not run.

## Catalog benchmark

PostgreSQL seeded with 250,000 synthetic catalog rows; three iterations per case, warm cache. These are catalog measurements, not timing of 250,000 FFprobe filesystem scans.

| Operation | Mean |
| --- | ---: |
| First 100 tracks with full-library count | 70.3 ms |
| Exact-word full-text search | 4.9 ms |
| Batch of 20 concurrent full-text searches | 16.6 ms |

An additional integration scenario passed 20 concurrent audio range requests sharing a 320 kbps conversion. Sustained bandwidth, 20 distinct concurrent transcodes, browser-specific codec behavior, and end-to-end 250,000-file scan duration remain deployment-dependent.

## Remaining release checks

Run the complete Compose stack on a Docker-enabled machine and verify ownership of real read-only music mounts. Cross-browser playback still needs dedicated Firefox, Safari, iOS, and Android device checks; the in-app Chromium test is not a substitute for those. Live external metadata-provider responses were not exercised: enrichment was tested with a controlled HTTP transport and is off by default.

![Desktop](screenshots/cadence-desktop.jpg)

![Mobile](screenshots/cadence-mobile.jpg)
