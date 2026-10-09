// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeURL, type Route } from "./navigation";

export function useNavigation() {
  const [route, setRoute] = useState(() =>
    parseRoute(new URL(window.location.href)),
  );
  useEffect(() => {
    const restore = () => setRoute(parseRoute(new URL(window.location.href)));
    window.addEventListener("popstate", restore);
    // Canonical paths also recover gracefully from unknown/malformed routes.
    const initial = parseRoute(new URL(window.location.href));
    window.history.replaceState(null, "", routeURL(initial));
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const navigate = useCallback((next: Route, replace = false) => {
    const url = routeURL(next);
    if (url !== window.location.pathname + window.location.search) {
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
    }
    setRoute(next);
  }, []);
  return { route, navigate };
}
