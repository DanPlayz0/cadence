// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { SoulseekCapabilities } from "../lib/soulseek";

const unavailable: SoulseekCapabilities = {
  configured: false,
  enabled: false,
  allowed: false,
  presentation: "separate",
};
export function useSoulseekCapabilities(userId?: string) {
  const [value, setValue] = useState(unavailable);
  useEffect(() => {
    setValue(unavailable);
    if (!userId) return;
    let live = true;
    const refresh = () =>
      void api<SoulseekCapabilities>("/soulseek/capabilities")
        .then((v) => {
          if (live) setValue(v);
        })
        .catch(() => {
          if (live) setValue(unavailable);
        });
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("cadence-soulseek-settings", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("cadence-soulseek-settings", refresh);
    };
  }, [userId]);
  return value;
}
