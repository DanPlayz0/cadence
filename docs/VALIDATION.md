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

## Compact profile update (2026-10-09)

- Replaced separate avatar/name sections with a clickable avatar supporting dropped replacements, an explicit removal confirmation, and inline display-name editing. Password fields expand on demand. Administrator account fields and session controls remain available.
- Frontend tests, TypeScript/production build, formatting, and diff checks passed. Chromium API-fixture checks at 1280 and 390 pixels passed for name saves, avatar file selection/drop/removal/cancellation, password checks, and administrator editing. Profile dialogs had no internal overflow at the tested 844-pixel height, including expanded password fields; the phone screenshot was visually reviewed. Shorter viewports can still scroll to keep controls reachable. Physical touchscreen/file-picker and cross-browser checks were not run.

## URL navigation update (2026-10-09)

- Library collections, album/artist details, playlists, and administrator tabs use URL paths; searches use query parameters. Refresh and Back/Forward restore the route. Direct links survive the sign-in screen, and non-admin accounts are redirected out of administrator paths. Unknown/malformed paths recover to Home.
- Seven frontend tests, TypeScript/production build, formatting, and diff checks passed. URL tests cover encoded identifiers, Unicode, search punctuation, malformed URLs, and canonical routes. HTTP API race tests passed, including serving nested frontend paths while preserving API 404s.
- Chromium API-fixture checks at 1280 and 390 pixels passed for collection/detail refreshes, correct album/artist/playlist filters, encoded artist names, search restoration/clearing, administrator tab navigation, browser Back/Forward, direct-link sign-in return, and permission redirects, with no runtime errors or horizontal overflow. Cross-browser and live full-stack browser checks were not run.

## Queue, filename detection, and metadata editor update (2026-10-09)

- Queue moves are limited to upcoming songs; played/current positions remain fixed. Disabled arrow controls and the player enforce the same boundary. Filename fallback recognizes common artist/title download names, marked reversed names, movie credits, video labels, and YouTube IDs; embedded tags, meaningful parentheses, and featured credits are preserved.
- Replaced raw track-ID suggestion/restore forms with library search, song selection, eight editable metadata fields, multi-field suggestions, and per-field restoration. Partial saves retain unsaved edits without resubmitting successful fields. Added track/disc overrides, numeric validation, blank optional metadata, and migration 5 with an updated sort index.
- Eight frontend tests, TypeScript/production build, formatting, OpenAPI checks, Go vet, and the Go race suite passed with a disposable PostgreSQL database. Filename cases, FFprobe embedded-tag precedence, API bounds, numeric/blank overrides, full-scan preservation, extracted-value restoration, and migration preservation were checked. Chromium API-fixture checks at desktop/phone widths passed for queue boundaries, upcoming moves, metadata search/error recovery, populated fields, partial-save retry, numeric/blank values, restoration, and no horizontal overflow/runtime errors; editor screenshots were reviewed. Cross-browser and live full-stack browser checks were not run. Personal filename listings and test artifacts stay in ignored `.local/`.

## Live lyrics update (2026-10-09)

- Added Queue/Lyrics tabs and a microphone shortcut. LRC timestamps highlight the current line, support offsets/repeated timestamps, follow playback, and seek on click. Plain lyrics, instrumental tracks, missing lyrics, retries, and stale-response protection are included. Seeking updates the visible playback position immediately, including while paused.
- Authenticated server lookups use current accessible track metadata and check track access again after the external response. LRCLIB requests have timeouts, bounded response/cache sizes, serialized throttling, metadata-keyed positive/negative caches, and Retry-After backoff. No audio uploads, new database storage, or background library-wide lyrics requests were added.
- Ten frontend tests, TypeScript/production build, formatting, OpenAPI checks (39 paths), Go vet, and Go race checks passed. Backend tests cover authentication/exclusions even for cached lyrics, permission changes during lookup, metadata encoding, album fallback, positive/negative caching, concurrent request coalescing, instrumental handling, response bounds, and rate-limit backoff. PostgreSQL integration cases were skipped in this run; database code was unchanged.
- Chromium API-fixture checks at desktop/phone widths passed for synchronized highlights, forward/backward seeking while paused, auto-scroll/follow, keyboard tabs, plain/instrumental/missing/error/retry states, current-song changes, stale responses, and no runtime errors or horizontal overflow. Screenshots were visually reviewed. A read-only live LRCLIB request returned HTTP 503 (server busy); successful live-provider matching and cross-browser/device testing were not verified.

## Field-selectable bulk acceptance update (2026-10-09)

- Added themed metadata field choices, select-all/clear controls, and an Accept all action in Review changes. It covers pending rows beyond pagination, reports the accepted count, keeps unselected fields pending, and refreshes the review/search data. Conflicting suggestions use the newest value. Retry clears the preceding error and preserves field choices.
- Ten frontend tests, TypeScript/production build, formatting, OpenAPI validation (40 paths), Go vet, and the full Go race suite passed with a disposable PostgreSQL database. Added tests cover authentication/admin/CSRF enforcement, invalid selections, 107 changes beyond the 100-row page, field isolation, newest-value conflicts, repeat acceptance, and transaction rollback without partial updates.
- Chromium API-fixture checks at desktop/phone widths passed for field choices, disabled empty selection, failed-save retry, busy controls, acceptance of unloaded titles, preservation of artist suggestions, select-all behavior, success counts, and no runtime errors/horizontal overflow. The phone layout was visually reviewed. Cross-browser and live full-stack browser checks were not run.

## Automatic mini-player update (2026-10-09)

- Added a default-on, per-user browser preference in Listening settings and a manual player-bar shortcut. Native Document PiP displays the same audio player's track, transport, seek, and logarithmic volume controls through a React portal. Automatic Media Session requests require active playback; returning closes automatic windows, manual windows remain open, and sign-out/empty playback closes either. Hidden-window dismissal suppresses repeated automatic opening until the tab is visible again. Pending requests are checked against current user, playback, preference, and visibility before attaching controls.
- Ten frontend tests, TypeScript/production build, formatting, and diff checks passed. Chromium API-fixture checks at desktop/phone widths exercised real native PiP windows, shared transport/seek/dB gain, track changes, preference defaults/persistence/account isolation, manual paused opening, permission rejection, sign-out, and unsupported API/action/storage fallbacks. The mini-player was checked and visually reviewed at 360 by 280 pixels with no horizontal overflow or scrollbar at that size.
- Automatic callback/visibility, repeated-dismissal, and delayed-request cases were driven deterministically in the browser while using native PiP windows. Real browser-triggered automatic eligibility/site permission prompts, cross-browser behavior, live full-stack playback, and physical mobile devices were not verified. Document PiP requires a secure context (HTTPS or localhost); unsupported browsers retain system media controls. Browser permission and media eligibility rules still determine whether automatic opening occurs: see [Chrome's guidance](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback).

## Cross-device playback resume update (2026-10-09)

- Added per-account server checkpoints with migration 6 and authenticated GET/PUT `/me/playback`. The frontend restores the last accessible song and fractional position paused, saves every 10 seconds during playback and on playback changes/hidden/pagehide, and uses CSRF-protected keepalive requests plus local recovery for interrupted saves. New user playback takes precedence over a delayed restore. Removed/excluded songs do not block library use.
- Writer sequence numbers reject out-of-order updates from a tab, and server revisions protect device takeover from stale requests. Fourteen frontend tests, TypeScript/production build, formatting, OpenAPI validation (41 paths), Go vet, and the full database-backed Go race suite passed. Tests cover authentication/CSRF, invalid checkpoints, account isolation, inaccessible tracks, duration clamping, delayed updates, simultaneous device takeover, track deletion, and persistence across repository reopening/migration checks.
- Chromium API-fixture checks at desktop/phone widths passed for accidental reload recovery, paused restoration without autoplay/history writes, a fresh browser context resuming server progress, backward seek, exact fractional pagehide checkpoints with keepalive/CSRF, periodic saving, interrupted-save recovery/later sync, inactive-tab protection, separate accounts, inaccessible tracks, and delayed restore versus user playback. Real close-time delivery against a live server, abrupt termination, cross-browser/device testing, and physical mobile devices were not verified. Final unload delivery is best effort; previous checkpoints provide recovery, and offline progress reaches other devices after syncing.

## Safari dropdown activation fix (2026-10-09)

- Replaced blur-based dismissal with shared outside pointer/focus handling for the account menu and quality selector. A null focus destination no longer unmounts a tapped item before its click runs. Escape also closes the account menu when focus is on its trigger. This addresses Safari's [button focus behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button#clicking_and_focus).
- Reproduced the previous Instance settings failure at desktop/phone widths by simulating Safari's button blur without focusing the tapped button. After the fix, Chromium touch checks passed at 1280 and 390 pixels for administrator navigation/refresh, profile/listening settings/queue/sign-out, quality choices, null blur, outside focus/tap dismissal, keyboard navigation/activation/Escape, and no runtime errors or horizontal overflow. Fourteen frontend tests, TypeScript/production build, formatting, and diff checks passed. Native WebKit tooling was unavailable; physical iOS Safari was not tested.

## Individual artist credits update (2026-10-09)

- Comma-separated performer credits now create individual artist memberships and links in song rows, now-playing, queue, lyrics, and native PiP. Links preserve URL encoding, normal new-tab gestures, and uninterrupted playback. Queue/lyrics artist navigation closes the panel so the artist page is visible on phones. Source metadata remains intact, while trimmed names, empty credits, and exact duplicates are normalized for display/counts; other separators are preserved.
- Migration 7 adds an immutable artist-name function and a GIN index on effective credits. Existing songs and accepted overrides immediately participate in individual artist listing/filtering without rescanning. Fifteen frontend tests, TypeScript/production build, formatting, OpenAPI validation (41 paths), Go vet, and the full database-backed race suite passed. Artist tests cover collaborations, duplicate credits/counts, exact matching, pagination, Unicode/punctuation, unknown artists, existing-catalog upgrade, overrides/restoration, exclusions, and repository reopening.
- Chromium API-fixture checks at 1280 and 390 pixels passed for separate links, encoded routes and filters, refresh/Back, player/queue/lyrics/native PiP navigation, continued playback, no nested interactive elements, and no runtime errors or horizontal overflow. Phone and 360 by 280 mini-player screenshots were visually reviewed. Cross-browser, physical-device, and live full-stack browser checks were not run.

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

## Whole-frontend design and accessibility pass (2026-10-09)

- Frontend unit tests: 15 passed across seven files. TypeScript checking, Vite production build, Prettier, and whitespace checks passed.
- Chromium API-fixture checks passed at 1280, 900, 390, and 320 pixels: skip link, heading focus, Cmd/Ctrl+K, app/browser Back, protected playback shortcuts, keyboard administrator tabs, song menus, outside/Escape dismissal, playlist search/addition, and creating a playlist then returning to the originating song.
- Automated axe-core checks using WCAG 2 A/AA, 2.1 AA, and 2.2 AA tags reported no violations on the 13 library/admin routes and eight account/dialog/player surfaces at 1280, 390, and 320 pixels. Queue title targets and mobile seek spacing were corrected based on the initial failures. Further checks passed for the administrator user editor, expanded password reset/change forms, inline display-name editing, quality options, and sign-in.
- Verified Cmd/Ctrl+K from the mobile queue, reduced-motion rendering, and visible focus under forced colors. Safari-style null-blur regression checks passed at desktop and phone widths for account/quality menus and administrator navigation.
- Screenshots of desktop/phone song views, narrow administrator views, compact profiles, and lyrics were visually reviewed. Browser fixtures and downloaded QA dependencies remain ignored under `.local`; no generated tools or screenshots were committed.
- These are automated Chromium and fixture checks, not a certification of WCAG conformance. VoiceOver/NVDA and physical Safari/iOS/Android testing, real account mutations, live lyrics-provider responses, and real playback on these devices were not exercised in this pass. Backend behavior was unchanged.

## Collection loading and mutation follow-up (2026-10-09)

- Chromium fixtures at 1280 and 390 pixels deliberately failed/delayed collection requests. Switching collections removed previous rows and their play action immediately; retry showed only the newly requested collection. Delayed/failed likes disabled the like action, repeated clicks issued one request, unrelated menu actions retained keyboard focus, and failed saves left the original liked state intact and recoverable.
- Build and all 15 frontend tests passed. The full route/dialog accessibility sweep was repeated after introducing loading placeholders and retry controls. QA used controlled API responses; production network behavior and real account changes were not tested.
