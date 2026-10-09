# Third-party components

Project source: GPL-2.0-or-later. Dependency versions are locked in go.sum and web/package-lock.json.

| Component | License | Source |
| --- | --- | --- |
| pgx, pgpassfile, pgservicefile, puddle | MIT | https://github.com/jackc |
| golang.org/x/crypto, x/sync, x/text | BSD-3-Clause | https://go.googlesource.com |
| React and React DOM | MIT | https://github.com/facebook/react |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| PostgreSQL | PostgreSQL License | https://www.postgresql.org/about/licence/ |
| FFmpeg | Build-dependent LGPL/GPL; Debian distribution may include GPL components | https://ffmpeg.org/legal.html |

Build/test tools include Go (BSD-3-Clause), TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), and their transitive dependencies. They are not linked into the Go server. The runtime image also contains Debian packages and their notices in `/usr/share/doc`.

Before distributing built images, generate the exact dependency inventory with `scripts/notices.mjs` and `go list -m all`, retain npm package license texts, and include corresponding source/build instructions for distributed GPL components (including the selected FFmpeg build). The application may be distributed under GPLv3 through its “or later” option where required by dependency combinations. Do not relabel third-party packages as project-owned GPLv2 code.

## shadcn/ui components

The components in `web/src/components/ui` adapt the shadcn/ui Radix component patterns with Cadence CSS in place of Tailwind utilities. Upstream: https://github.com/shadcn-ui/ui and https://ui.shadcn.com/r/styles/new-york/. Radix UI, class-variance-authority, clsx, and tailwind-merge are MIT licensed; their exact licenses are retained in the npm dependency inventory.

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Optional artist profile content

Artist facts and links are retrieved from MusicBrainz under its applicable [data licenses](https://musicbrainz.org/doc/About/Data_License). Optional biographies from Wikipedia retain contributor/article attribution and a [CC BY-SA license link](https://creativecommons.org/licenses/by-sa/4.0/). Wikimedia image thumbnails are displayed with a link to their file description page for individual author and license information; image licenses vary. These fetched assets are separate from project code, and are not bundled in the source repository.
