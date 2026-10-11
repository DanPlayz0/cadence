// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { parseRoute, routeURL, type Route } from "../lib/navigation";
import { routeTab, type MobileTab } from "../lib/mobileNavigation";

type Position = { top: number; songs: number };
export function useNavigation(userID?: string) {
  const [canGoBack, setCanGoBack] = useState(
    () => (window.history.state?.cadenceIndex || 0) > 0,
  );
  const [route, setRoute] = useState(() =>
    parseRoute(new URL(window.location.href)),
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>(() =>
    routeTab(route, window.history.state?.mobileTab),
  );
  const current = useRef({ route, mobileTab });
  const remembered = useRef<Partial<Record<MobileTab, Route>>>({});
  const roots = useRef<Partial<Record<MobileTab, Route>>>({});
  const positions = useRef(new Map<string, Position>());
  const pendingScroll = useRef<Position | null>(null);
  current.current = { route, mobileTab };
  const save = useCallback(() => {
    const { route, mobileTab } = current.current;
    if (route.view === "admin") return;
    remembered.current[mobileTab] = route;
    if (
      ["home", "search", "find", "library"].includes(route.view) ||
      (route.view === "songs" && route.query)
    )
      roots.current[mobileTab] = route;
    positions.current.set(routeURL(route), {
      top: document.querySelector("#main-content")?.scrollTop || 0,
      songs: document.querySelector(".track-scroll")?.scrollTop || 0,
    });
  }, []);
  useEffect(() => {
    remembered.current = {};
    roots.current = {};
    positions.current.clear();
    pendingScroll.current = null;
  }, [userID]);
  useEffect(() => {
    const restore = () => {
      save();
      const next = parseRoute(new URL(window.location.href));
      const tab = routeTab(next, window.history.state?.mobileTab);
      pendingScroll.current = positions.current.get(routeURL(next)) || {
        top: 0,
        songs: 0,
      };
      setRoute(next);
      setMobileTab(tab);
      setCanGoBack((window.history.state?.cadenceIndex || 0) > 0);
    };
    window.addEventListener("popstate", restore);
    const initial = parseRoute(new URL(window.location.href));
    window.history.replaceState(
      {
        ...window.history.state,
        cadenceIndex: window.history.state?.cadenceIndex || 0,
        mobileTab: current.current.mobileTab,
      },
      "",
      routeURL(initial),
    );
    return () => window.removeEventListener("popstate", restore);
  }, [save]);
  const navigate = useCallback(
    (next: Route, replace = false, tabOverride?: MobileTab) => {
      save();
      const url = routeURL(next);
      const tab = tabOverride || routeTab(next, current.current.mobileTab);
      if (url !== window.location.pathname + window.location.search) {
        const cadenceIndex =
          (window.history.state?.cadenceIndex || 0) + (replace ? 0 : 1);
        window.history[replace ? "replaceState" : "pushState"](
          { ...window.history.state, cadenceIndex, mobileTab: tab },
          "",
          url,
        );
        setCanGoBack(cadenceIndex > 0);
        pendingScroll.current = positions.current.get(url) || {
          top:
            replace &&
            next.view === "find" &&
            current.current.route.view === "find"
              ? document.querySelector("#main-content")?.scrollTop || 0
              : 0,
          songs: 0,
        };
      }
      setMobileTab(tab);
      setRoute(next);
    },
    [save],
  );
  const restoreScroll = useCallback(() => {
    const position = pendingScroll.current;
    if (!position) return;
    const main = document.querySelector("#main-content");
    const songs = document.querySelector(".track-scroll");
    if (main) main.scrollTop = position.top;
    if (songs) {
      songs.scrollTop = position.songs;
      songs.dispatchEvent(new Event("scroll"));
    }
    pendingScroll.current = null;
  }, []);
  const back = useCallback(() => window.history.back(), []);
  return {
    route,
    navigate,
    canGoBack,
    back,
    mobileTab,
    remembered,
    roots,
    restoreScroll,
  };
}
