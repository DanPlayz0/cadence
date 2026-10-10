# Web app

The frontend uses React, TypeScript, and Vite. Run commands from `web/`:

```sh
npm ci
npm run dev
npm run build
npm test
```

The development server proxies API requests to `http://127.0.0.1:8080`.

## Source layout

```text
src/
  main.tsx       React entry point, global styles, and service worker registration
  App.tsx        App shell, session state, navigation, and view composition
  pages/         Top-level views: administration, artist profiles, and music discovery
  components/    UI grouped by account, admin, artists, library, metadata,
                 playback, playlists, Soulseek, and tracks
    ui/          Shared UI primitives and artwork
  hooks/         React hooks for playback, navigation, resizing, and dismissal
  services/      HTTP API client and shared API models
  lib/           Utilities and domain logic, with colocated unit tests
  styles/        Global, administration, and Soulseek styles
```

Keep view components in `pages/`, reusable UI in the appropriate `components/`
folder, and React hooks in `hooks/`. Use `lib/` for logic that does not need React,
and keep its tests beside the implementation. Import modules directly rather than
adding barrel files. `components/soulseek/SoulseekViews.tsx` retains lazy loading
for music discovery and Soulseek settings.

Static assets live in `public/`. The Vite configuration, PWA build plugin, service
worker template, and PWA tests remain at the web project root.
