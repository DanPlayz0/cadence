// SPDX-License-Identifier: GPL-2.0-or-later
import { lazy, Suspense, type ComponentProps } from "react";
import type { FindMusic as FindMusicComponent } from "../../pages/FindMusic";
const FindMusicView = lazy(() =>
  import("../../pages/FindMusic").then((v) => ({ default: v.FindMusic })),
);
const SettingsView = lazy(() =>
  import("./SoulseekSettings").then((v) => ({ default: v.SoulseekSettings })),
);
export function FindMusic(props: ComponentProps<typeof FindMusicComponent>) {
  return (
    <Suspense fallback={<p role="status">Loading Find music…</p>}>
      <FindMusicView {...props} />
    </Suspense>
  );
}
export function SoulseekSettings() {
  return (
    <Suspense fallback={<p role="status">Loading Soulseek settings…</p>}>
      <SettingsView />
    </Suspense>
  );
}
