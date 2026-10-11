# Frontend review

Cadence should feel like a music library: artwork, collections, and playback come first. The supplied Bloop guidelines provide useful principles for purposeful interaction, responsive layouts, accessibility, and focused components. Chat previews, games, emoji effects, and a new framework or animation library would not help this interface. Keep the current React, TypeScript, CSS, and Lucide stack and its warm, subdued palette.

## Improvements implemented

- Find music opens in a MusicBrainz catalog for all signed-in listeners, with Albums, Artists, and Songs discovery, album overviews, and explicit handoff to Direct search. Download access remains separately controlled. Compact folder/file source rows support quality and availability comparison, filters, and sorting; eligible folder tracks open beside results or in a full-screen phone dialog with focus restoration. Downloads has its own tab. Find uses one search field and retains Ctrl/Cmd+K, navigation inputs, and current session results.

- The avatar opens an account dropdown with profile details, listening settings, play queue, administrator-only instance settings, and sign-out. Account actions move out of the music sidebar. The dropdown supports keyboard navigation, Escape, outside clicks, and focus restoration. Profile and settings use native modal dialogs.
- Profile editing supports display names, uploaded avatars, avatar removal, and password changes with current-password verification. Changes update the account menu immediately. Usernames are changed through the administrator user editor.
- Listening settings connect directly to the existing player volume and quality controls. Queue, lyrics, quality, and volume controls are also visible in the tablet player. Changes apply immediately in the current tab.
- Volume uses equal dB steps from -60 to 0 dB, with zero explicitly muted. The audio gain is `10^(dB/20)`; 50% slider position is -30 dB, not half the signal amplitude. The popup shows slider percentage and attenuation relative to full gain, not measured room loudness. Gain is a signal multiplier, as described in the [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#GainNode).
- A shared custom quality selector replaces native quality inputs in the player and listening settings. Options include bitrate descriptions, selected-state indicators, keyboard navigation, and Escape dismissal.
- The queue reserves a separate desktop column with independent scrolling. At widths of 1100 pixels and below it replaces the library view while open, rather than covering the library scrollbar. Escape and the close button return to the library.
- Playlist creation uses one shared dialog for desktop and mobile, with a name, icon preview, six built-in icons, a pending state, and recoverable inline errors. Icons persist through the API and PostgreSQL migration; existing playlists receive the music icon.
- Playlist creation, adding a song to a playlist, and queue additions now show success feedback. Deleting a playlist asks for confirmation and explains that library songs remain available.
- Album cards use a navigation chevron instead of suggesting that clicking the artwork starts playback. Keyboard focus reveals the same affordance as hover.
- Search has a visible focus state; likes and shuffle expose their toggle state; the queue trigger exposes its expanded state. Playback and seeking controls are disabled when unavailable. Loading animation and album transitions respect reduced motion.

- People rows open a user editor with themed group checkboxes, username/display name editing, avatar uploads/removal, session revocation, and password resets. Saves provide inline feedback and preserve inputs after errors. Self password changes revoke other sessions; administrator resets revoke all target sessions.

## Whole-frontend accessibility and interaction pass

The review covered authentication, navigation/search, album and artist details, songs, playlists, account editing, listening settings, player/queue/lyrics, and all administrator tabs. The design borrows patterns rather than reproducing another product's appearance:

- Consistent control sizes, identifiable actions, and visible states, informed by [Apple's button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons).
- Distinct heading, body, and label sizes and deliberate navigation/interaction states, informed by [Material foundations](https://m3.material.io/foundations/) and [typography roles](https://m3.material.io/styles/typography/applying-type).
- Cmd/Ctrl+K search, as used in [Spotify](https://support.spotify.com/us/article/keyboard-shortcuts/) and [Notion](https://www.notion.com/help/keyboard-shortcuts/).
- Contrast and target-size checks based on [WCAG contrast guidance](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum) and [WCAG 2.2 target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum). The AA target minimum is 24 CSS pixels with exceptions; key touch controls here aim for 44 pixels.

Implemented in this pass:

- Named navigation landmarks, current-page indicators, a skip link, heading focus on page changes, a real history-based Back button, and correct mobile artist navigation. Search typing retains focus. Search also opens from the queue via Cmd/Ctrl+K.
- Safe playback shortcuts: Space leaves links, inputs, editable content, modified key presses, and dialogs alone. Seeking exposes elapsed and total time to assistive technology. The virtualized song region can receive keyboard focus for scrolling.
- An explicit song menu with written labels, arrow/Home/End navigation, Escape, outside dismissal, and focus restoration. It renders outside the virtualized list so it is not clipped. Desktop likes remain available directly; phones use the same menu.
- A searchable per-song playlist picker replaces the page-wide destination selector. It supports creating a playlist and returning to the original song, pending feedback, duplicate-submit prevention, and recoverable errors.
- Administrator tabs now follow tablist/tabpanel semantics and keyboard navigation. Library scan and enrichment options reuse the custom checkbox component used elsewhere.
- Larger song, artist, album, time, and settings text; brighter secondary text; clearer focus states; consistent action sizes; and quieter admin surfaces. Collection headings use plain labels.
- A mobile player with separate track, transport/seek, and utility rows, safe-area space, visible shuffle/repeat controls, and generous touch targets. Tablet layouts retain utility controls. Phone text inputs use 16px text, and queue titles and seeking targets no longer crowd nearby actions.
- Reduced-motion handling across transitions and animations, plus forced-color focus/border/selection states.
- Collection loading is tied to the requested route/search so the previous collection cannot be played under a new heading. Failed loads offer retry, and stable loading space avoids empty-state flashes. Likes prevent duplicate requests, preserve their state on failure, and expose pending/confirmation feedback; responses from a previous account do not update the current account's UI.

The warm Cadence palette, existing component stack, and compact profile layout remain the basis of the design.

## Recommended next changes

| Priority | Area              | Proposed change                                                                                                                                  | Reason / dependency                                                                                                                                             |
| -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Mobile navigation | Replace the icon rail plus collection dropdown with named Home, Search, and Library destinations. Keep collections and playlists within Library. | The current navigation divides related tasks between two controls and consumes space on small screens. Needs a coordinated navigation and player layout change. |
| Medium   | Play next         | Add a distinct Play next operation to song menus.                                                                                                | Define queue insertion around the current track and shuffle state before introducing this action. Queue additions and playlist selection are implemented.       |
| Medium   | Home              | Replace some of the static welcome banner with recently played music and shortcuts to liked songs and playlists.                                 | Useful entry points reduce the distance to playback. Reuse actual history and playlists, without implying algorithmic recommendations.                          |
| Medium   | Collection pages  | Add a consistent play/shuffle action near album and playlist titles, with total duration and song count.                                         | Playback should be the primary action. Define whether it plays the fetched page or the entire collection before changing the existing loaded-song behavior.     |
| Low      | Playlist removal  | Add per-song pending feedback to removals and a themed deletion confirmation.                                                                    | Creation/addition and likes already have pending states; deletion currently uses the browser's confirmation.                                                    |
| Medium   | Permissions       | Replace manual track/album IDs with searchable catalog choices.                                                                                  | Keep folder/path exclusions explicit, and account for catalog permissions when supplying choices.                                                               |

Playback resumption is now account-backed; durable offline downloads still need persistence design before adding controls for them.

## Verification

Verification for this change is recorded in [VALIDATION.md](VALIDATION.md). Browser fixtures verify interface behavior, not live server authentication, media conversion, or account permissions enforced by the backend.

## shadcn/ui integration (2026-10-09)

Review found the highest-value adoption points in the custom account and song menus and in playlist/profile dialogs, where positioning, focus trapping, keyboard navigation, and dismissal were maintained separately. These now use locally owned shadcn/ui Radix component patterns in `web/src/components/ui`: Button, Input, Dialog, and DropdownMenu. Account/profile/listening settings, playlist creation, and playlist selection use Dialog; account and song actions use DropdownMenu. Buttons and playlist text inputs share the new primitives.

This is a manual, CSS-adapted integration: Cadence's warm palette, typography, responsive sizing, and existing styles replace upstream Tailwind utility classes. Tailwind and the shadcn CLI are not configured; future upstream components require the same CSS adaptation. Radix handles menu typeahead, keyboard navigation, focus management, portals, and collision positioning. Song menus remain non-modal so other library controls stay accessible. Dialog saves block Escape/outside dismissal while pending; global playback shortcuts recognize Radix dialogs and menus.

The remaining controls were subsequently migrated in the app-wide component pass below. Administrator navigation remains page navigation rather than tabs. See [VALIDATION.md](VALIDATION.md) for checks and limitations.

## Expandable queue and lyrics (2026-10-09)

Queue and lyrics now share a resizable playback panel. Drag its left edge on desktop or top edge on screens at or below 1100px. The header's expand button uses the largest size that preserves library space; restore returns to the preceding custom size. Close/reopen and switching tabs keep the size, and separate desktop/stacked preferences are saved in this browser.

The focused separator supports arrow keys in 20px steps (Shift for 80px), Home/End for minimum/maximum, and Enter or double-click for the default size. Desktop limits reserve at least 300px for the panel and 360px for the library. Stacked layouts reserve at least 200px for the panel and 160px for the library, keeping both visible instead of replacing the library. Player controls retain their existing minimum sizes. Very short screens scroll the page to preserve minimum heights. Queue content and lyrics scroll independently within the available panel space.

## Phone playback sheets (2026-10-10)

At 700px and below, Queue and Lyrics open in a modal bottom sheet above the library. Expand fills the visible viewport; Restore returns to the sheet, and reopening starts at the sheet size. The sheet includes Previous, Play/Pause, Next, and seeking, so playback remains accessible while the background is modal. Close, Escape, and the backdrop dismiss it and restore focus to the opener. Artist and source links close the sheet when navigating.

The layout uses dynamic viewport height and safe-area padding. Header actions, tabs, and transport stay visible while queue entries or lyrics scroll. Short landscape screens use a compact lyric heading. Live lyrics recenter when the viewport changes, unless following has been paused by manual scrolling. Desktop and tablet panels retain resizing, expansion, and their saved size preferences. Phone collection headings can wrap without forcing horizontal overflow.

The sheet uses the existing Radix dialog primitives for focus containment and background scroll locking. Queue operations, lyrics providers, playback APIs, and database schemas are unchanged. Swipe-to-dismiss is not implemented. See VALIDATION.md for checks and device/browser limitations.

## Mobile tabs and compact playback (2026-10-10)

Phones at 700px and below use Home, Search, and Library bottom navigation. Home retains the existing album content; Search has its own /search URL and song results; /library provides named collection links, playlist creation, playlists, and the accessible-library selector. Existing album, artist, song, and playlist URLs remain supported. Account actions stay in the header avatar. Tablets and desktops retain the sidebar and full player; the new tab-root URLs also work at those sizes.

The current track appears in a compact player above the tabs. Its track area opens full-screen Now Playing, with artwork, transport/seeking, shuffle/repeat, quality, volume, queue, and lyrics. Queue and Lyrics open inside the same dialog and provide Back to Now Playing. Direct queue access retains its sheet expansion/restoration. Account/profile/listening settings, playlist dialogs, and metadata editing use full-screen phone dialogs; the bottom bars are hidden while dialogs are open. Instance settings hide the bars and offer Back with a Library fallback for direct entry. Playback continues independently of these screens.

Tab destinations and scroll positions are remembered in memory for the signed-in session. Album, artist, and playlist details inherit their opening tab; direct detail links default to Library, and legacy song-query links default to Search. Browser history preserves tab ownership. Subpages provide a breadcrumb back to their tab overview; Search restores its last query when returning from an artist or album. Loaded catalog pages are cached in a bounded session cache to restore paginated/virtualized lists, with invalidation for account changes, permission refreshes, edits, and playlist/like mutations. Deleted playlist destinations and revoked library selections recover safely. The separate Soulseek page stays mounted to retain active results/folder selection across tab switches; it clears with the signed-in session.

The interface preserves Cadence's existing theme and uses its existing React, CSS, Lucide, and Radix components. It does not add backend APIs or change playback persistence. Verification and remaining browser/device limitations are recorded in VALIDATION.md.

## App-wide UI component migration (2026-10-10)

All frontend screens now use shared UI controls. The CSS-adapted Radix component set includes Select, Slider, Checkbox, RadioGroup, Collapsible, Tabs, Progress, AlertDialog, and Popover, alongside the existing Button, Input, Dialog, and DropdownMenu. Raw interactive control tags are confined to shared primitives. The warm palette and existing desktop, tablet, and phone layouts remain the basis of the design.

Quality selection uses the shared Select with descriptions, all seeking and volume controls use Slider, and Queue/Lyrics use linked Tabs. The administrator user editor uses Dialog with pending-save dismissal protection. Playlist deletion uses AlertDialog with cancellation, a pending state, recoverable errors, and retry. Administrator destinations retain their URLs and page-navigation semantics.

Forms show inline validation and focus the first invalid field. Named selects preserve empty values, form submission, default selection, and reset. Composite controls inherit dynamic disabled fieldsets. Radio choices support group keyboard navigation. FileUpload keeps the native file input hidden behind themed upload actions and retains drag-and-drop; the operating system file picker is allowed. DateField accepts optional local dates as `YYYY-MM-DD`, validates real calendar dates, and blocks invalid export requests. FolderInput replaces browser datalist popups with themed suggestions while retaining free path entry.

An AST test enforces the component policy and rejects browser prompts and specialized generic Inputs. The contributor policy and browser-test instructions are documented in `web/README.md`. Backend endpoints, payloads, and schemas are unchanged. Browser fixtures and remaining limitations are recorded in VALIDATION.md.
