// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import {
  Disc3,
  Headphones,
  Heart,
  Moon,
  Music2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  playlistIconImports,
  resolvePlaylistIcon,
} from "../../lib/playlistIcons";

const loaded = new Map<string, LucideIcon>([
  ["music-2", Music2],
  ["disc-3", Disc3],
  ["headphones", Headphones],
  ["heart", Heart],
  ["moon", Moon],
  ["sparkles", Sparkles],
]);
const pending = new Map<string, Promise<LucideIcon>>();
function load(name: keyof typeof playlistIconImports) {
  let promise = pending.get(name);
  if (!promise) {
    promise = playlistIconImports[name]()
      .then((module) => {
        loaded.set(name, module.default);
        return module.default;
      })
      .catch(() => {
        pending.delete(name);
        return Music2;
      });
    pending.set(name, promise);
  }
  return promise;
}
export function PlaylistIcon({
  name,
  size = 19,
}: {
  name?: string;
  size?: number;
}) {
  const resolved = resolvePlaylistIcon(name);
  const [result, setResult] = useState<{ name: string; Icon: LucideIcon }>();
  useEffect(() => {
    let active = true;
    if (!loaded.has(resolved)) {
      void load(resolved).then((Icon) => {
        if (active) setResult({ name: resolved, Icon });
      });
    }
    return () => {
      active = false;
    };
  }, [resolved]);
  const Icon =
    loaded.get(resolved) ||
    (result?.name === resolved ? result.Icon : undefined);
  return Icon ? (
    <Icon size={size} aria-hidden="true" />
  ) : (
    <span
      aria-hidden="true"
      className="playlist-icon-placeholder"
      style={{ width: size, height: size }}
    />
  );
}
