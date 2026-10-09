# Frontend review

Cadence should feel like a music library: artwork, collections, and playback come first. The supplied Bloop guidelines provide useful principles for purposeful interaction, responsive layouts, accessibility, and focused components. Chat previews, games, emoji effects, and a new framework or animation library would not help this interface. Keep the current React, TypeScript, CSS, and Lucide stack and its warm, subdued palette.

## Improvements implemented

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

| Priority | Area | Proposed change | Reason / dependency |
| --- | --- | --- | --- |
| High | Mobile navigation | Replace the icon rail plus collection dropdown with named Home, Search, and Library destinations. Keep collections and playlists within Library. | The current navigation divides related tasks between two controls and consumes space on small screens. Needs a coordinated navigation and player layout change. |
| Medium | Play next | Add a distinct Play next operation to song menus. | Define queue insertion around the current track and shuffle state before introducing this action. Queue additions and playlist selection are implemented. |
| Medium | Home | Replace some of the static welcome banner with recently played music and shortcuts to liked songs and playlists. | Useful entry points reduce the distance to playback. Reuse actual history and playlists, without implying algorithmic recommendations. |
| Medium | Collection pages | Add a consistent play/shuffle action near album and playlist titles, with total duration and song count. | Playback should be the primary action. Define whether it plays the fetched page or the entire collection before changing the existing loaded-song behavior. |
| Low | Playlist removal | Add per-song pending feedback to removals and a themed deletion confirmation. | Creation/addition and likes already have pending states; deletion currently uses the browser's confirmation. |
| Medium | Permissions | Replace manual track/album IDs with searchable catalog choices. | Keep folder/path exclusions explicit, and account for catalog permissions when supplying choices. |

Playback resumption is now account-backed; durable offline downloads still need persistence design before adding controls for them.

## Verification

Verification for this change is recorded in [VALIDATION.md](VALIDATION.md). Browser fixtures verify interface behavior, not live server authentication, media conversion, or account permissions enforced by the backend.
