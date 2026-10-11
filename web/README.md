# Web app

The frontend uses React, TypeScript, and Vite. Run commands from `web/`:

```sh
npm ci
npm run dev
npm run build
npm test
```

The development server proxies API requests to `http://127.0.0.1:6450`.

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

## UI component policy

Feature components use shared controls from `components/ui/`. Use Button and
Input for actions and text/numeric fields; Select, Checkbox, RadioGroup, Slider,
Collapsible, Tabs, Progress, Dialog, AlertDialog, and Popover provide the other
interactions. Keep the existing CSS theme rather than introducing Tailwind.
Semantic HTML remains appropriate for content, layout, links, labels, and
fieldsets. Form supplies inline validation instead of browser validation bubbles.

Select accepts SelectItem children and preserves string values, including empty
selections, through its change-event adapter. Named selections submit exactly one
value and reset to their defaults. Checkbox and Slider preserve existing change
callbacks; composite controls inherit disabled fieldsets. Give every control an
associated label or accessible name. Use RadioGroup around related radio choices.

Use DateField for optional `YYYY-MM-DD` dates and FileUpload for hidden file
selection behind themed upload buttons. The system file picker is allowed.
FolderInput provides themed mounted-folder suggestions while allowing typed paths.
Native browser prompts and visible native selectors, calendars, range controls,
and disclosures are prohibited. The standalone offline page keeps its themed
semantic retry link.

`npm test` includes an AST policy check and component interaction tests.
Run `npm run build` before `npm run test:ui`, which runs Chromium API fixtures
against the production assets across frontend routes at desktop,
tablet, phone, and short landscape sizes. Install Playwright Chromium with
`npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an
existing Chromium executable. Screenshots and failure reports stay in ignored
`.local/ui-review/results/`. Fixtures do not verify live backend integrations.

Static assets live in `public/`. The Vite configuration, PWA build plugin, service
worker template, and PWA tests remain at the web project root.
