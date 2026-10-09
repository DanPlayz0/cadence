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
