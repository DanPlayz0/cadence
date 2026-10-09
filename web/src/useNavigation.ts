// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeURL, type Route } from "./navigation";

export function useNavigation() {
  const [canGoBack, setCanGoBack] = useState(
    () => (window.history.state?.cadenceIndex || 0) > 0,
  );
  const [route, setRoute] = useState(() =>
    parseRoute(new URL(window.location.href)),
  );
  useEffect(() => {
    const restore = () => {
      setRoute(parseRoute(new URL(window.location.href)));
      setCanGoBack((window.history.state?.cadenceIndex || 0) > 0);
    };
    window.addEventListener("popstate", restore);
    // Canonical paths also recover gracefully from unknown/malformed routes.
    const initial = parseRoute(new URL(window.location.href));
    window.history.replaceState(
      {
        ...window.history.state,
        cadenceIndex: window.history.state?.cadenceIndex || 0,
      },
      "",
      routeURL(initial),
    );
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const navigate = useCallback((next: Route, replace = false) => {
    const url = routeURL(next);
    if (url !== window.location.pathname + window.location.search) {
      const cadenceIndex =
        (window.history.state?.cadenceIndex || 0) + (replace ? 0 : 1);
      window.history[replace ? "replaceState" : "pushState"](
        { ...window.history.state, cadenceIndex },
        "",
        url,
      );
      setCanGoBack(cadenceIndex > 0);
    }
    setRoute(next);
  }, []);
  const back = useCallback(() => window.history.back(), []);
  return { route, navigate, canGoBack, back };
}
