# Soulseek downloads

Cadence can use the optional [slskd](https://github.com/slskd/slskd) container to search Soulseek and download songs or complete audio folders. Existing installations and listening features work without it. Soulseek search is always an explicit action; typing in library search does not send queries to Soulseek.

## Start the container

1. Run `node scripts/setup-env.mjs`. It generates missing database, slskd API, and slskd administrator secrets while preserving configured values. Keep `.env` private.
2. Set `SOULSEEK_USERNAME` and `SOULSEEK_PASSWORD` in `.env` to the instance's Soulseek account. All Cadence users use this one network account. Configure `SOULSEEK_PEER_PORT` if necessary, and forward that TCP port on your router for inbound peer connectivity.
3. Run `docker compose -f compose.yaml -f compose.soulseek.yaml up -d --build`.
4. Open **Instance settings → Soulseek**, enable the integration, select user/group grants, and configure routing and review. Administrators have access when enabled; listeners start without access.

The slskd image is pinned to 0.26.0. Its HTTP API stays on the internal Docker network; no public web UI is published. Cadence uses an API key for transfers and a server-side administrator login for sharing configuration. Remote configuration is enabled for that purpose. Credentials and raw slskd configuration are never sent to the Cadence browser.

Use the same Compose file list for later `up`, `logs`, and `down` commands. Omitting the Soulseek override from a new app deployment removes its connection configuration without deleting persisted settings or download volumes. Do not use `down -v` if you want to keep data.

## Writable import folders

slskd writes incomplete files and completed staging files into separate Docker volumes. Staging is excluded from Cadence scans, including scans of an ancestor folder. Cadence copies approved audio into existing library folders; it does not alter existing music or overwrite files.

Import destinations must exist inside a configured library, be within `MUSIC_ROOTS` and `SOULSEEK_WRITABLE_ROOTS`, and be writable by UID/GID 10001. The existing Compose music mount is read-only until you explicitly change it.

Copy [compose.soulseek.storage.example.yaml](../compose.soulseek.storage.example.yaml) to the ignored `compose.override.yaml`, replace the host path, and create the destination subfolder on the host. Linux paths work the same way, for example `/srv/music`. Then run:

```sh
docker compose -f compose.yaml -f compose.soulseek.yaml -f compose.override.yaml up -d --build
```

When you specify `-f`, include `compose.override.yaml` explicitly. Choose the library and its destination folder in Soulseek settings. Multiple destination folders are allowed through semicolon-separated writable roots and additional mounts. Mount changes require container recreation; routing changes do not.

## Access, routing, and review

Access grants and routing are separate. Grant a listener or one of their groups access first. Routing uses an explicit user rule, then the first matching group rule in administrator-defined order, then the instance default. A rule chooses review or automatic import and can supply a destination library/folder. Automatic user/group rules can bypass the default review policy.

The instance-wide review timing applies to newly created requests. **Before download** holds reviewed requests until an administrator approves a destination; successfully downloaded files then import. **After download** transfers into staging and holds completed files for approval. Routing and review timing are snapshotted when requested. Administrators can change the destination when approving a reviewed or blocked request.

Removing a listener's grant blocks subsequent searches and transfer actions, while existing jobs remain. Disabling the integration pauses reconciliation except cancellation and sharing removal. Existing requests resume when enabled. Library deletion, changed folder configuration, unavailable mounts, and failed copies hold imports for administrator action. Library grants and group exclusions continue to determine who can listen to imported songs.

Downloads use an isolated staging folder per batch. Imported files retain their names inside a `Soulseek-<request ID>` folder, keeping album files together. Audio content and expected size are checked before import. Per-file progress survives restart, and finalized files are matched by SHA-256 when recovering an interrupted publication. Hard-link support on the destination filesystem is required for atomic publication without overwrites. Successfully imported files trigger an incremental library scan.

**Find music** shows search progress and peer results. Album downloads fetch the full peer folder listing, not just matching search results. Requests have progress, failure, cancel, and retry controls; administrators also approve, reject, and explicitly delete staging for terminal requests. Rejection retains staging. Staging is not automatically cleaned up; monitor disk usage and delete terminal batches through the administrator controls.

## Download quality

**Instance settings → Soulseek → Download quality** defaults to **Lossless audio only**, with all supported formats selected: FLAC, WAV, M4A, MP3, AAC, OGG, and Opus. Administrators can turn off lossless-only or restrict the format checklist; at least one format is required. M4A can contain ALAC or AAC.

Lossless eligibility matches the [slskd 0.26.0 `islossless` filter](https://github.com/slskd/slskd/blob/0.26.0/src/web/src/lib/searches.js): peers must report both sample rate and bit depth. A FLAC extension alone does not qualify. Format restrictions and lossless eligibility both apply to search results, folder listings, and server-validated requests. Album requests omit ineligible tracks and fail if no eligible audio remains.

Each new request captures its quality policy. Settings changes do not affect existing requests, approvals, retries, or resumed jobs. Requests predating this feature retain unrestricted audio behavior; older settings default to lossless-only and all supported formats.

Before import, Cadence verifies the actual codec and accepts FLAC, ALAC, or uncompressed PCM under lossless-only. Incorrect peer metadata can allow lossy content into staging, but it is blocked before publication into the library. Choose another source or change the administrator policy and create a new request. This checks the encoding, not whether a lossless file was previously converted from a lossy source. These controls govern Cadence requests; they do not modify slskd's independent web UI or API downloads.

## Soulseek sharing

Sharing defaults to **Disabled**. Administrators can select mounted folders or share only successfully imported request folders. slskd must see these folders at the same container paths as Cadence; the storage example mounts them read-only into slskd. Sharing is independent of Cadence's library listening grants: selecting a folder makes its contents available to Soulseek peers.

Cadence installs shares under dedicated `Cadence-…` aliases and removes only those managed entries when settings change. Operator-configured shares remain intact. A Cadence share filter hides unpublished `.cadence-….part` import copies while preserving existing filters. Staging cannot be selected or automatically shared. Sharing synchronization failures appear in settings and are retried by the worker.

Back up PostgreSQL, the three Soulseek volumes, and imported music folders. PostgreSQL stores settings, request ownership, routing snapshots, and import markers; slskd storage holds transfer/configuration state. Keep slskd transfer history available while Cadence jobs are active.
