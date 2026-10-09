# Frontend review

Cadence should feel like a music library: artwork, collections, and playback come first. The supplied Bloop guidelines provide useful principles for purposeful interaction, responsive layouts, accessibility, and focused components. Chat previews, games, emoji effects, and a new framework or animation library would not help this interface. Keep the current React, TypeScript, CSS, and Lucide stack and its warm, subdued palette.

## Improvements implemented

- The avatar opens an account dropdown with profile details, listening settings, play queue, administrator-only instance settings, and sign-out. Account actions move out of the music sidebar. The dropdown supports keyboard navigation, Escape, outside clicks, and focus restoration. Profile and settings use native modal dialogs.
- Profile editing supports display names, uploaded avatars, avatar removal, and password changes with current-password verification. Changes update the account menu immediately. Usernames are changed through the administrator user editor.
- Listening settings connect directly to the existing player volume and quality controls. The account menu also makes the queue accessible at tablet widths, where player extras are hidden. Changes apply immediately in the current tab.
- Volume uses equal dB steps from -60 to 0 dB, with zero explicitly muted. The audio gain is `10^(dB/20)`; 50% slider position is -30 dB, not half the signal amplitude. The popup shows slider percentage and attenuation relative to full gain, not measured room loudness. Gain is a signal multiplier, as described in the [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#GainNode).
- A shared custom quality selector replaces native quality inputs in the player and listening settings. Options include bitrate descriptions, selected-state indicators, keyboard navigation, and Escape dismissal.
- The queue reserves a separate desktop column with independent scrolling. At widths of 1100 pixels and below it replaces the library view while open, rather than covering the library scrollbar. Escape and the close button return to the library.
- Playlist creation uses one shared dialog for desktop and mobile, with a name, icon preview, six built-in icons, a pending state, and recoverable inline errors. Icons persist through the API and PostgreSQL migration; existing playlists receive the music icon.
- Playlist creation, adding a song to a playlist, and queue additions now show success feedback. Deleting a playlist asks for confirmation and explains that library songs remain available.
- Album cards use a navigation chevron instead of suggesting that clicking the artwork starts playback. Keyboard focus reveals the same affordance as hover.
- Search has a visible focus state; likes and shuffle expose their toggle state; the queue trigger exposes its expanded state. Playback and seeking controls are disabled when unavailable. Loading animation and album transitions respect reduced motion.

- People rows open a user editor with themed group checkboxes, username/display name editing, avatar uploads/removal, session revocation, and password resets. Saves provide inline feedback and preserve inputs after errors. Self password changes revoke other sessions; administrator resets revoke all target sessions.

## Recommended next changes

| Priority | Area | Proposed change | Reason / dependency |
| --- | --- | --- | --- |
| High | Mobile navigation | Replace the icon rail plus collection dropdown with named Home, Search, and Library destinations. Keep collections and playlists within Library. | The current navigation divides related tasks between two controls and consumes space on small screens. Needs a coordinated navigation and player layout change. |
| High | Song actions | Replace the page-wide playlist selector with a song action menu containing Play next, Add to queue, Add to playlist, and Go to album/artist. | Actions belong near the song they affect. Play next needs a defined insertion behavior in the player; the other actions have existing data and APIs. |
| Medium | Home | Replace some of the static welcome banner with recently played music and shortcuts to liked songs and playlists. | Useful entry points reduce the distance to playback. Reuse actual history and playlists, without implying algorithmic recommendations. |
| Medium | Collection pages | Add a consistent play/shuffle action near album and playlist titles, with total duration and song count. | Playback should be the primary action. Define whether it plays the fetched page or the entire collection before changing the existing loaded-song behavior. |
| Medium | Navigation history | Give collection/detail/search views real URLs and browser back/forward behavior. | The current back button always returns Home; deep links and previous search state cannot be restored. Requires consistent routing and state handling. |
| Medium | Feedback and loading | Add pending states to playlist mutations and likes, and use layout-stable loading placeholders. | Prevent duplicate requests and reduce stale-content flashes while switching collections. Preserve meaningful error and empty states. |

Durable playback preferences and durable offline downloads still need persistence design before adding controls for them.

## Verification

Verification for this change is recorded in [VALIDATION.md](VALIDATION.md). Browser fixtures verify interface behavior, not live server authentication, media conversion, or account permissions enforced by the backend.
