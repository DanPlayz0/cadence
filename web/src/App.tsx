// SPDX-License-Identifier: GPL-2.0-or-later
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import {
  Album as AlbumIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Disc3,
  Headphones,
  Heart,
  Home,
  ListMusic,
  Mic2,
  Music2,
  Pause,
  Play,
  Plus,
  PictureInPicture2,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  api,
  APIError,
  Album,
  Artist,
  duration,
  Page,
  Playlist,
  Session,
  setSession,
  Track,
  User,
} from "./services/api";
import { catalogLibrary, type LibrarySummary } from "./lib/libraries";
import { PlaybackStatus } from "./components/playback/PlaybackStatus";
import { usePlayer } from "./hooks/usePlayer";
import { Admin } from "./pages/Admin";
import { FindMusic } from "./components/soulseek/SoulseekViews";
import { useSoulseekCapabilities } from "./hooks/useSoulseekCapabilities";
import { AccountMenu } from "./components/account/AccountMenu";
import {
  QualitySelect,
  VolumeControl,
} from "./components/playback/PlaybackControls";
import {
  PlaylistDialog,
  PlaylistIcon,
} from "./components/playlists/PlaylistDialog";
import { useNavigation } from "./hooks/useNavigation";
import {
  PlaybackPanel,
  useMobilePlayback,
} from "./components/playback/PlaybackPanel";
import { MiniPlayer, useMiniPlayer } from "./components/playback/MiniPlayer";
import { usePlaybackResume } from "./hooks/usePlaybackResume";
import { ArtistProfile } from "./pages/ArtistProfile";
import { ArtistLinks } from "./components/artists/ArtistLinks";
import { TrackMetadataEditor } from "./components/metadata/TrackMetadataEditor";
import { PlaylistPicker } from "./components/playlists/PlaylistPicker";
import { usePanelResize } from "./hooks/usePanelResize";
import { Button } from "./components/ui/button";
import {
  MobileTabs,
  CompactPlayer,
  LibraryOverview,
} from "./components/library/MobileMusic";
import { tabRoute, type MobileTab } from "./lib/mobileNavigation";

import { Artwork } from "./components/ui/Artwork";
import { ArtistAlbums } from "./components/artists/ArtistAlbums";
import { ArtistAvatar } from "./components/artists/ArtistAvatar";
import { TrackList } from "./components/tracks/TrackList";

export function App() {
  const [session, updateSession] = useState<Session | null>(null);
  const activeUser = useRef<string | undefined>(undefined);
  activeUser.current = session?.user.id;
  const [ready, setReady] = useState(false);
  const [instanceName, setInstanceName] = useState("Cadence");
  useEffect(() => {
    document.title = instanceName;
  }, [instanceName]);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const expire = useCallback(() => {
    setSession(null);
    updateSession(null);
    setError("Your session expired. Sign in again.");
  }, []);
  const userUpdated = useCallback((user: User) => {
    updateSession((current) =>
      current?.user.id === user.id ? { ...current, user } : current,
    );
  }, []);
  useEffect(() => {
    const userID = session?.user.id;
    if (!userID) return;
    let live = true;
    const refresh = async () => {
      if (!navigator.onLine) return;
      try {
        const next = await api<Session>("/me");
        if (live && next.user.id === userID) {
          setSession(next);
          updateSession((current) => {
            if (current?.user.id !== userID) return current;
            if (
              current.csrf === next.csrf &&
              JSON.stringify(current.user) === JSON.stringify(next.user)
            )
              return current;
            return next;
          });
        }
      } catch (error) {
        if (live && error instanceof APIError && error.status === 401) expire();
      }
    };
    const timer = window.setInterval(() => void refresh(), 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [session?.user.id, expire]);
  const player = usePlayer(setError, expire);
  const playbackUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (playbackUser.current !== session?.user.id) player.clear();
    playbackUser.current = session?.user.id;
  }, [session?.user.id, player.clear]);
  usePlaybackResume(player, session?.user.id);
  const miniPlayer = useMiniPlayer(player, session?.user.id);
  useEffect(() => {
    if (!session) {
      player.clear();
      setTracks([]);
      setLoadedCollection("");
      setAlbums([]);
      setArtists([]);
      setPlaylists([]);
    }
  }, [session, player.clear]);
  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ setupRequired: boolean; name: string }>("/status"),
      api<Session>("/me").catch((e) => {
        if (e instanceof APIError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([status, s]) => {
        if (!live) return;
        setSetup(status.setupRequired);
        setInstanceName(status.name);
        setSession(s);
        updateSession(s);
        setReady(true);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  const {
    route,
    navigate,
    canGoBack,
    back,
    mobileTab,
    remembered,
    roots,
    restoreScroll,
  } = useNavigation(session?.user.id);
  const searchInput = useRef<HTMLInputElement>(null);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const view = route.view;
  const soulseek = useSoulseekCapabilities(session?.user.id);
  const libraryId = catalogLibrary(view, route.libraryId);
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const query = route.query || "";
  const [debounced, setDebounced] = useState(query);
  const selectedArtist = route.artist || "";
  const selectedAlbumId = route.albumId;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const collectionKey = JSON.stringify([
    view,
    selectedAlbumId,
    selectedArtist,
    query,
    libraryId,
  ]);
  const [loadedCollection, setLoadedCollection] = useState("");
  const [collectionError, setCollectionError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const collectionReady = loadedCollection === collectionKey;
  const pendingLikes = useRef(new Set<string>());
  const [liking, setLiking] = useState<Set<string>>(new Set());
  const albumTrack = tracks.find((track) => track.albumId === selectedAlbumId);
  const selectedAlbum = selectedAlbumId
    ? albums.find((album) => album.id === selectedAlbumId) || {
        id: selectedAlbumId,
        title: albumTrack?.album || "Album",
        artist: albumTrack?.albumArtist || albumTrack?.artist || "",
        coverId: albumTrack?.artwork ? albumTrack.id : "",
        tracks: 0,
      }
    : null;
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const panelResize = usePanelResize(queueOpen);
  const [queueTab, setQueueTab] = useState<"queue" | "lyrics" | "now">("queue");
  const mobilePlayback = useMobilePlayback();
  const [fromNowPlaying, setFromNowPlaying] = useState(false);
  useEffect(() => {
    if (!mobilePlayback && queueTab === "now") {
      setQueueOpen(false);
      setQueueTab("queue");
    }
  }, [mobilePlayback, queueTab]);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const collectionCache = useRef(
    new Map<
      string,
      {
        albums: Album[];
        artists: Artist[];
        tracks: Track[];
        total: number;
        offset: number;
        more: boolean;
      }
    >(),
  );
  useEffect(() => {
    collectionCache.current.clear();
  }, [session?.user.id, reload]);
  useEffect(() => {
    setLoadedCollection("");
    setTracks([]);
    setAlbums([]);
    setArtists([]);
    setTotal(0);
    setOffset(0);
    setMore(false);
  }, [session?.user.id]);
  useEffect(() => {
    if (!collectionReady || loading) return;
    collectionCache.current.set(collectionKey, {
      albums,
      artists,
      tracks,
      total,
      offset,
      more,
    });
    if (collectionCache.current.size > 20)
      collectionCache.current.delete(
        collectionCache.current.keys().next().value!,
      );
  }, [
    collectionReady,
    collectionKey,
    albums,
    artists,
    tracks,
    total,
    offset,
    more,
    loading,
  ]);
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setLibraries([]);
      return;
    }
    let live = true;
    const refresh = async () => {
      if (!navigator.onLine) return;
      try {
        const next = await api<LibrarySummary[]>("/libraries");
        if (!live) return;
        setLibraries(next);
        const selected = currentRoute.current.libraryId;
        if (selected && !next.some((item) => item.id === selected)) {
          navigate({ ...currentRoute.current, libraryId: undefined }, true);
        }
        collectionCache.current.clear();
        setLoadedCollection("");
        setAlbums([]);
        setArtists([]);
        setTracks([]);
        setReload((value) => value + 1);
      } catch (e) {
        if (live && e instanceof APIError && e.status === 401) expire();
        else if (live) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [session?.user.id, libraryRevision, navigate, expire]);
  const mainElement = useRef<HTMLElement>(null);
  const focusRoute = `${view}:${selectedAlbumId || ""}:${selectedArtist}`;
  const previousView = useRef(focusRoute);
  useEffect(() => {
    if (
      previousView.current !== focusRoute &&
      document.activeElement !== searchInput.current
    ) {
      mainElement.current
        ?.querySelector<HTMLElement>("h1")
        ?.focus({ preventScroll: true });
    }
    previousView.current = focusRoute;
  }, [focusRoute]);
  useLayoutEffect(() => {
    if (
      (collectionReady && debounced === query) ||
      view === "library" ||
      view === "find" ||
      view === "admin"
    )
      restoreScroll();
  }, [collectionReady, route, view, debounced, query, restoreScroll]);
  const [addingTrack, setAddingTrack] = useState<Track | null>(null);
  const playlistReturnTrack = useRef<Track | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const refreshPlaylists = useCallback(
    () =>
      api<Playlist[]>("/playlists")
        .then(setPlaylists)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (session) void refreshPlaylists();
  }, [session, refreshPlaylists]);
  const browse = useCallback(
    (v: string) => {
      navigate({ view: v, libraryId: route.libraryId });
      setOffset(0);
    },
    [navigate, route.libraryId],
  );
  const browseArtist = (artist: string) => {
    navigate({ view: "artist", artist, libraryId: route.libraryId });
    setOffset(0);
    setQueueOpen(false);
  };
  useEffect(() => {
    if (session && !session.user.admin && view === "admin")
      navigate({ view: "home" }, true);
  }, [session, view, navigate]);
  const albumView = view === "home" || view === "albums";
  const artistView = view === "artists";
  useEffect(() => {
    const id = ++request.current;
    if (!session || view === "admin" || view === "find" || view === "library") {
      setLoading(false);
      return;
    }
    if (debounced !== query) {
      setLoading(true);
      return;
    }
    if (view === "search" && !debounced) {
      setTracks([]);
      setTotal(0);
      setMore(false);
      setLoading(false);
      setLoadedCollection(collectionKey);
      return;
    }
    const cached = collectionCache.current.get(collectionKey);
    if (cached) {
      setAlbums(cached.albums);
      setArtists(cached.artists);
      setTracks(cached.tracks);
      setTotal(cached.total);
      setOffset(cached.offset);
      setMore(cached.more);
      setLoading(false);
      setLoadedCollection(collectionKey);
      return;
    }
    setLoading(true);
    setCollectionError(null);
    setOffset(0);
    const params = new URLSearchParams({
      limit: "100",
      offset: "0",
      q: debounced,
    });
    if (libraryId) params.set("libraryId", libraryId);
    if (selectedAlbumId) params.set("album", selectedAlbumId);
    if (selectedArtist) params.set("artist", selectedArtist);
    if (view === "likes" || view === "history") params.set("collection", view);
    if (view.startsWith("playlist:")) params.set("playlist", view.slice(9));
    const promise = albumView
      ? api<Album[]>(`/albums?${params}`)
      : artistView
        ? api<Artist[]>(`/artists?${params}`)
        : api<Page>(`/tracks?${params}`);
    promise
      .then((v) => {
        if (id !== request.current) return;
        setLoadedCollection(collectionKey);
        if (albumView) {
          setAlbums(v as Album[]);
          setMore((v as Album[]).length === 100);
        } else if (artistView) {
          setArtists(v as Artist[]);
          setMore((v as Artist[]).length === 100);
        } else {
          const p = v as Page;
          setTracks(p.items);
          setTotal(p.total);
          setMore(p.items.length < p.total);
        }
      })
      .catch((e) => {
        if (id === request.current) {
          if (e instanceof APIError && e.status === 401) expire();
          else setCollectionError({ key: collectionKey, message: e.message });
        }
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, [
    session,
    view,
    albumView,
    artistView,
    selectedAlbumId,
    selectedArtist,
    debounced,
    query,
    reload,
    collectionKey,
    expire,
  ]);
  async function loadMore() {
    const id = request.current;
    setLoading(true);
    const next = offset + 100;
    const params = new URLSearchParams({
      limit: "100",
      offset: String(next),
      q: debounced,
    });
    if (libraryId) params.set("libraryId", libraryId);
    if (selectedAlbumId) params.set("album", selectedAlbumId);
    if (selectedArtist) params.set("artist", selectedArtist);
    if (view === "likes" || view === "history") params.set("collection", view);
    if (view.startsWith("playlist:")) params.set("playlist", view.slice(9));
    try {
      if (albumView) {
        const v = await api<Album[]>(`/albums?${params}`);
        if (id !== request.current) return;
        setAlbums((a) => [...a, ...v]);
        setMore(v.length === 100);
      } else if (artistView) {
        const v = await api<Artist[]>(`/artists?${params}`);
        if (id !== request.current) return;
        setArtists((a) => [...a, ...v]);
        setMore(v.length === 100);
      } else {
        const p = await api<Page>(`/tracks?${params}`);
        if (id !== request.current) return;
        setTracks((t) => [...t, ...p.items]);
        setMore(next + p.items.length < p.total);
      }
      setOffset(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  async function like(t: Track) {
    const userID = activeUser.current;
    if (!userID) return;
    if (pendingLikes.current.has(t.id)) return;
    pendingLikes.current.add(t.id);
    setLiking(new Set(pendingLikes.current));
    try {
      await api(`/tracks/${t.id}/like`, "PUT", { liked: !t.liked });
      if (activeUser.current !== userID) return;
      setTracks((ts) =>
        ts.map((x) => (x.id === t.id ? { ...x, liked: !x.liked } : x)),
      );
      setNotice(
        `${t.liked ? "Removed" : "Added"} “${t.title}” ${t.liked ? "from" : "to"} liked songs.`,
      );
      collectionCache.current.clear();
      if (view === "likes") setReload((value) => value + 1);
    } catch (e) {
      if (activeUser.current === userID) setError((e as Error).message);
    } finally {
      pendingLikes.current.delete(t.id);
      setLiking(new Set(pendingLikes.current));
    }
  }
  async function logout() {
    try {
      await api("/logout", "POST", {});
      player.clear();
      setSession(null);
      updateSession(null);
      setTracks([]);
      setAlbums([]);
      setArtists([]);
      setPlaylists([]);
      browse("home");
      setQueueOpen(false);
      setNotice("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function auth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const s = await api<Session>(setup ? "/setup" : "/login", "POST", {
        username: String(f.get("username")).trim().toLowerCase(),
        ...(setup ? { displayName: f.get("displayName") } : {}),
        password: f.get("password"),
      });
      setSession(s);
      updateSession(s);
      setSetup(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !session ||
        document.querySelector(
          'dialog[open], [role="dialog"], [role="menu"]',
        ) ||
        e.repeat
      )
        return;
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setQueueOpen(false);
        if (mobilePlayback)
          navigate({ view: "search", libraryId: route.libraryId });
        window.requestAnimationFrame(() => {
          searchInput.current?.focus();
          searchInput.current?.select();
        });
        return;
      }
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,button,a,summary,[contenteditable],[role=menu],[role=slider]",
        )
      )
        return;
      if (e.code === "Space" && session) {
        e.preventDefault();
        player.toggle();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [player.toggle, session, mobilePlayback, navigate, route.libraryId]);
  const playlist = playlists.find((p) => p.id === view.slice(9));
  const heading =
    selectedAlbum?.title ||
    selectedArtist ||
    playlist?.name ||
    ({
      home: "Your music, at home.",
      albums: "Albums",
      artists: "Artists",
      songs: "All songs",
      search: "Search",
      library: "Your library",
      likes: "Liked songs",
      history: "Recently played",
      admin: "Instance settings",
    }[view] ??
      "Library");
  const librarySelector = (
    <label className="library-switcher">
      Library
      <select
        aria-label="Choose library"
        value={route.libraryId || ""}
        onChange={(event) => {
          navigate({ ...route, libraryId: event.target.value || undefined });
          setOffset(0);
        }}
      >
        <option value="">All accessible music</option>
        {libraries.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  const destinations = Object.fromEntries(
    (["home", "search", "library"] as MobileTab[]).map((tab) => [
      tab,
      tabRoute(
        tab,
        remembered.current[tab],
        route.libraryId,
        playlists.map((p) => p.id),
        libraries.map((l) => l.id),
        soulseek.allowed,
      ),
    ]),
  ) as Record<MobileTab, import("./lib/navigation").Route>;
  const selectTab = (tab: MobileTab) => {
    if (tab !== mobileTab) navigate(destinations[tab], false, tab);
  };
  if (!ready)
    return (
      <div className="auth">
        <Disc3 className="spin" />
        <p>Connecting to your music…</p>
      </div>
    );
  if (!session)
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="brand">
            <Headphones /> <span className="instance-name">{instanceName}</span>
          </div>
          <p className="eyebrow">YOUR COLLECTION. YOUR SERVER.</p>
          <h1>{setup ? "Make yourself at home." : "Welcome back."}</h1>
          <p>
            {setup
              ? "Create the administrator account for this instance."
              : "Sign in and pick up where you left off."}
          </p>
          <form onSubmit={auth}>
            {setup && (
              <label>
                Display name
                <input
                  name="displayName"
                  required
                  maxLength={120}
                  autoComplete="nickname"
                />
              </label>
            )}
            <label>
              Username
              <input
                name="username"
                required
                maxLength={120}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => {
                  e.currentTarget.value = e.currentTarget.value.toLowerCase();
                }}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={setup ? 3 : 1}
                maxLength={72}
                autoComplete={setup ? "new-password" : "current-password"}
              />
            </label>
            <button className="primary" disabled={authBusy}>
              {authBusy ? "Connecting…" : setup ? "Create instance" : "Sign in"}{" "}
              <ChevronRight size={18} />
            </button>
          </form>
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <small>A little closer to the music you own.</small>
        </div>
      </div>
    );
  return (
    <div
      ref={panelResize.app}
      className={`app ${mobilePlayback ? "phone-app" : ""} ${view === "admin" ? "focused-view" : ""} ${player.current ? "has-current-track" : ""} ${queueOpen && !mobilePlayback ? "queue-open" : ""} ${panelResize.dragging ? "panel-resizing" : ""}`}
      data-panel-mode={panelResize.mode}
      style={
        {
          "--playback-panel-size": `${panelResize.size}px`,
        } as React.CSSProperties
      }
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          setQueueOpen(false);
          window.requestAnimationFrame(() => mainElement.current?.focus());
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <Headphones /> <span className="instance-name">{instanceName}</span>
        </div>
        <nav aria-label="Browse music">
          {soulseek.allowed && (
            <button
              className={view === "find" ? "active" : ""}
              aria-current={view === "find" ? "page" : undefined}
              onClick={() => navigate({ view: "find", query })}
            >
              <Search /> Find music
            </button>
          )}
          <button
            className={view === "home" ? "active" : ""}
            aria-current={view === "home" ? "page" : undefined}
            onClick={() => browse("home")}
          >
            <Home /> Home
          </button>
          <button
            className={view === "songs" ? "active" : ""}
            aria-current={view === "songs" ? "page" : undefined}
            onClick={() => browse("songs")}
          >
            <Music2 /> Songs
          </button>
          <button
            className={view === "albums" ? "active" : ""}
            aria-current={
              view === "albums" || view === "album" ? "page" : undefined
            }
            onClick={() => browse("albums")}
          >
            <AlbumIcon /> Albums
          </button>
          <button
            className={view === "artists" ? "active" : ""}
            aria-current={
              view === "artists" || view === "artist" ? "page" : undefined
            }
            onClick={() => browse("artists")}
          >
            <Users /> Artists
          </button>
        </nav>
        <div className="nav-label">YOUR LIBRARY</div>
        <nav aria-label="Your library">
          <button
            className={view === "likes" ? "active" : ""}
            aria-current={view === "likes" ? "page" : undefined}
            onClick={() => browse("likes")}
          >
            <Heart /> Liked songs
          </button>
          <button
            className={view === "history" ? "active" : ""}
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => browse("history")}
          >
            <Clock /> Recently played
          </button>
        </nav>
        <div className="nav-label row">
          PLAYLISTS
          <button
            title="Create playlist"
            aria-label="Create playlist"
            onClick={() => setAddingPlaylist(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="playlist-nav" aria-label="Playlists">
          {playlists.map((p) => (
            <button
              key={p.id}
              className={view === `playlist:${p.id}` ? "active" : ""}
              aria-current={view === `playlist:${p.id}` ? "page" : undefined}
              onClick={() => browse(`playlist:${p.id}`)}
            >
              <PlaylistIcon name={p.icon} />
              {p.name}
            </button>
          ))}
          {!playlists.length && (
            <p className="nav-empty">A place for your next mix.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="instance">
            <span className={player.offline ? "status offline" : "status"} />
            {player.offline ? "Offline session" : "Connected to your instance"}
          </div>
        </div>
      </aside>
      <main ref={mainElement} id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="back-buttons">
            <button
              aria-label="Go back"
              title="Go back"
              disabled={
                !canGoBack &&
                (!mobilePlayback ||
                  (!["admin", "album", "artist"].includes(view) &&
                    !view.startsWith("playlist:")))
              }
              onClick={() => {
                if (canGoBack) back();
                else browse("library");
              }}
            >
              <ChevronLeft />
            </button>
          </div>
          <span className="phone-page-title">{heading}</span>
          <div
            className={`search ${view === "search" || view === "find" || ((view === "songs" || view === "search") && query) ? "phone-search-visible" : ""}`}
          >
            <Search size={18} />
            <input
              ref={searchInput}
              aria-label="Search music"
              placeholder={
                view === "find"
                  ? "Search beyond your library"
                  : "Search your collection"
              }
              value={query}
              onChange={(e) => {
                navigate(
                  {
                    view:
                      view === "find"
                        ? "find"
                        : mobilePlayback || view === "search"
                          ? "search"
                          : "songs",
                    query: e.target.value,
                    libraryId: route.libraryId,
                  },
                  view === "songs" || view === "find" || view === "search",
                );
                setOffset(0);
              }}
            />
            {!query && (
              <kbd title="Search: Control K or Command K">⌘ / Ctrl K</kbd>
            )}
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => navigate({ ...route, query: "" }, true)}
              >
                <X size={16} />
              </button>
            )}
          </div>
          {!mobilePlayback &&
            view !== "admin" &&
            view !== "find" &&
            librarySelector}
          <AccountMenu
            miniPlayer={miniPlayer}
            hasTrack={!!player.current}
            user={session.user}
            quality={player.quality}
            volume={player.volume}
            offline={player.offline}
            onQuality={player.changeQuality}
            allowMP3Session={player.allowMP3Session}
            onMP3Session={player.changeMP3Session}
            onVolume={player.setVolume}
            onAdmin={() => browse("admin")}
            onQueue={() => {
              setFromNowPlaying(false);
              setQueueTab("queue");
              setQueueOpen(true);
            }}
            onLogout={logout}
            onUpdated={userUpdated}
            onExpired={expire}
          />
        </header>
        <PlaybackStatus player={player} />
        {notice && (
          <div className="toast success" role="status">
            <span>
              <Check size={16} /> {notice}
            </span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {miniPlayer.error && (
          <div className="toast" role="alert">
            <span>{miniPlayer.error}</span>
            <button
              aria-label="Dismiss mini player error"
              onClick={miniPlayer.clearError}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="toast" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === "admin" ? (
          <Admin
            instanceName={instanceName}
            onBranding={setInstanceName}
            onLibrariesChanged={() => setLibraryRevision((value) => value + 1)}
            tab={route.adminTab || "dashboard"}
            onTab={(tab) =>
              navigate({
                view: "admin",
                adminTab: tab,
                libraryId: route.libraryId,
              })
            }
            report={setError}
            onUpdated={userUpdated}
            onRevoked={(id) => {
              if (id === session.user.id) expire();
            }}
            onExpired={expire}
          />
        ) : view === "find" ? null : view === "library" ? (
          <LibraryOverview
            playlists={playlists}
            librarySelector={librarySelector}
            onNavigate={browse}
            onCreate={() => setAddingPlaylist(true)}
          />
        ) : view === "search" && !query ? (
          <section className="content">
            <h1 tabIndex={-1}>Search</h1>
            <p className="muted">
              Search your collection by title, artist, or album.
            </p>
            {soulseek.allowed && (
              <button onClick={() => navigate({ view: "find" })}>
                Find music beyond your library
              </button>
            )}
          </section>
        ) : (
          <section className="content">
            {mobilePlayback &&
              view !== mobileTab &&
              view !== "find" &&
              !(view === "songs" && query) && (
                <button
                  className="tab-breadcrumb"
                  onClick={() =>
                    navigate(
                      tabRoute(
                        mobileTab,
                        roots.current[mobileTab],
                        route.libraryId,
                        playlists.map((p) => p.id),
                        libraries.map((l) => l.id),
                        soulseek.allowed,
                      ),
                      false,
                      mobileTab,
                    )
                  }
                >
                  <ChevronLeft size={16} /> Back to{" "}
                  {mobileTab === "home"
                    ? "Home"
                    : mobileTab === "search"
                      ? "Search"
                      : "Library"}
                </button>
              )}
            <div className="mobile-nav">
              <select
                aria-label="Go to collection"
                value={
                  view === "album"
                    ? "albums"
                    : view === "artist"
                      ? "artists"
                      : view
                }
                onChange={(e) => {
                  if (e.target.value === "__new") setAddingPlaylist(true);
                  else browse(e.target.value);
                }}
              >
                {[
                  ["home", "Home"],
                  ["songs", "Songs"],
                  ["albums", "Albums"],
                  ["artists", "Artists"],
                  ["likes", "Liked songs"],
                  ["history", "Recently played"],
                ].map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
                {playlists.map((p) => (
                  <option key={p.id} value={`playlist:${p.id}`}>
                    {p.name}
                  </option>
                ))}
                {soulseek.allowed && <option value="find">Find music</option>}
                <option value="__new">Create playlist…</option>
              </select>
            </div>
            {(view === "songs" || view === "search") &&
              query &&
              soulseek.allowed &&
              soulseek.presentation === "separate" && (
                <button
                  className="soulseek-search-link"
                  onClick={() => navigate({ view: "find", query })}
                >
                  Find “{query}” on Soulseek
                </button>
              )}
            <div className="page-heading">
              {playlist && (
                <div className="playlist-cover">
                  <PlaylistIcon name={playlist.icon} size={48} />
                </div>
              )}
              {selectedAlbum && (
                <Artwork
                  id={selectedAlbum.coverId}
                  label={selectedAlbum.title}
                  has={!!selectedAlbum.coverId}
                  className="hero-art"
                />
              )}
              <div>
                <p className="eyebrow">
                  {selectedAlbum
                    ? "ALBUM"
                    : selectedArtist
                      ? "ARTIST"
                      : playlist
                        ? "YOUR PLAYLIST"
                        : view === "home"
                          ? "WELCOME TO CADENCE"
                          : "YOUR COLLECTION"}
                </p>
                <h1 tabIndex={-1}>
                  {debounced ? `Results for “${debounced}”` : heading}
                </h1>
                <p className="subtitle">
                  {!collectionReady
                    ? collectionError?.key === collectionKey
                      ? "Collection unavailable."
                      : "Loading collection…"
                    : selectedAlbum
                      ? `${selectedAlbum.artist} · ${total.toLocaleString()} songs`
                      : selectedArtist
                        ? `${total.toLocaleString()} songs`
                        : view === "home"
                          ? "Old favorites. New obsessions. All yours."
                          : !albumView && !artistView
                            ? `${total.toLocaleString()} songs`
                            : "Find something worth turning up."}
                </p>
              </div>
            </div>
            {selectedArtist && (
              <ArtistProfile
                key={selectedArtist}
                artist={selectedArtist}
                admin={session.user.admin}
                onExpired={expire}
              />
            )}
            {selectedArtist && (
              <ArtistAlbums
                key={`albums:${selectedArtist}:${libraryId}`}
                libraryId={libraryId}
                artist={selectedArtist}
                onExpired={expire}
                onAlbum={(albumId) => {
                  navigate({
                    view: "album",
                    albumId,
                    libraryId: route.libraryId,
                  });
                  setOffset(0);
                }}
              />
            )}
            {view === "home" && (
              <div className="welcome-strip">
                <div>
                  <span className="eyebrow">THE WHOLE COLLECTION</span>
                  <h2>Set the mood.</h2>
                  <p>Your library is the only algorithm you need.</p>
                  <button className="primary" onClick={() => browse("songs")}>
                    <Music2 size={17} /> Explore songs
                  </button>
                </div>
                <div className="vinyl">
                  <div>
                    <Disc3 size={90} />
                  </div>
                </div>
              </div>
            )}
            <div className="section-heading">
              <h2>
                {albumView
                  ? "Albums in your library"
                  : artistView
                    ? "Artists"
                    : selectedAlbum
                      ? "Tracks"
                      : "Songs"}
              </h2>
              <div className="row">
                {collectionReady &&
                  !albumView &&
                  !artistView &&
                  tracks.length > 0 && (
                    <button
                      className="primary small"
                      disabled={loading}
                      onClick={() =>
                        player.play(tracks, 0, {
                          name: heading,
                          route: { ...route },
                        })
                      }
                    >
                      <Play size={16} fill="currentColor" /> Play loaded songs
                    </button>
                  )}
                {playlist && (
                  <button
                    className="subtle"
                    onClick={async () => {
                      try {
                        if (
                          !window.confirm(
                            `Delete “${playlist.name}”? Your songs will stay in the library.`,
                          )
                        )
                          return;
                        await api(`/playlists/${playlist.id}`, "DELETE");
                        collectionCache.current.clear();
                        await refreshPlaylists();
                        setNotice(
                          "Playlist deleted. Your songs are still in the library.",
                        );
                        browse("home");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Delete playlist
                  </button>
                )}
              </div>
            </div>
            {collectionReady && collectionError?.key === collectionKey && (
              <div className="toast" role="alert">
                <span>{collectionError.message}</span>
                <button
                  disabled={loading}
                  onClick={() => setReload((value) => value + 1)}
                >
                  Try again
                </button>
              </div>
            )}
            {!collectionReady ? (
              <div className="collection-placeholder">
                {collectionError?.key === collectionKey ? (
                  <div className="empty" role="alert">
                    <h3>Couldn’t load this collection.</h3>
                    <p>{collectionError.message}</p>
                    <button
                      className="primary"
                      onClick={() => setReload((value) => value + 1)}
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <p className="empty" role="status">
                    Loading your collection…
                  </p>
                )}
              </div>
            ) : albumView ? (
              <div className="album-grid">
                {albums.map((a) => (
                  <button
                    className="album-card"
                    key={a.id}
                    onClick={() => {
                      navigate({
                        view: "album",
                        albumId: a.id,
                        libraryId: route.libraryId,
                      });
                      setOffset(0);
                    }}
                  >
                    <div className="album-cover">
                      <Artwork
                        id={a.coverId}
                        label={a.title}
                        has={!!a.coverId}
                      />
                      <span className="album-play" aria-hidden="true">
                        <ChevronRight size={20} />
                      </span>
                    </div>
                    <strong>{a.title}</strong>
                    <span>{a.artist}</span>
                  </button>
                ))}
              </div>
            ) : artistView ? (
              <div className="album-grid">
                {artists.map((a) => (
                  <button
                    className="album-card artist-card"
                    key={a.name}
                    onClick={() => {
                      navigate({
                        view: "artist",
                        artist: a.name,
                        libraryId: route.libraryId,
                      });
                      setOffset(0);
                    }}
                  >
                    <ArtistAvatar name={a.name} image={a.image} />
                    <strong>{a.name}</strong>
                    <span>{a.tracks.toLocaleString()} songs</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <TrackList
                  libraryId={libraryId}
                  onArtist={browseArtist}
                  tracks={tracks}
                  currentId={player.current?.id}
                  playing={player.playing}
                  cached={player.cached}
                  liking={liking}
                  onPlay={(i) =>
                    player.play(tracks, i, {
                      name: heading,
                      route: { ...route },
                    })
                  }
                  onLike={(t) => void like(t)}
                  onQueue={(track) => {
                    player.enqueue(track);
                    setNotice(`Added “${track.title}” to the queue.`);
                  }}
                  onEdit={session.user.admin ? setEditingTrack : undefined}
                  onAdd={setAddingTrack}
                  onRemove={
                    playlist
                      ? async (t) => {
                          try {
                            await api(
                              `/playlists/${playlist.id}/tracks/${t.id}`,
                              "DELETE",
                            );
                            setReload((v) => v + 1);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }
                      : undefined
                  }
                />
              </>
            )}
            {loading && collectionReady && (
              <p className="empty" role="status">
                Loading your collection…
              </p>
            )}
            {collectionReady &&
              !loading &&
              (albumView
                ? albums.length === 0
                : artistView
                  ? artists.length === 0
                  : tracks.length === 0) && (
                <div className="empty">
                  <Music2 size={40} />
                  <h3>
                    {debounced
                      ? "Nothing here yet."
                      : "Your next favorite belongs here."}
                  </h3>
                  <p>
                    {debounced
                      ? "Try another title, artist, or album."
                      : session.user.admin
                        ? "Add a library in Instance settings, choose music folders, and share it with listeners."
                        : "Your administrator can add music to this instance."}
                  </p>
                </div>
              )}
            {collectionReady && more && (
              <button
                className="load-more"
                disabled={loading}
                onClick={() => void loadMore()}
              >
                Load more <ChevronRight size={16} />
              </button>
            )}
            <footer className="content-footer">
              CADENCE <span>Music on your terms.</span>
            </footer>
          </section>
        )}
        {soulseek.allowed && soulseek.presentation === "combined" && (
          <div
            className="find-pane combined-find-pane"
            hidden={!((view === "songs" || view === "search") && query)}
          >
            <FindMusic
              embedded
              query={
                view === "songs" || view === "search"
                  ? query
                  : remembered.current.search?.query || ""
              }
              capabilities={soulseek}
              admin={session.user.admin}
            />
          </div>
        )}
        {soulseek.allowed && (
          <div className="find-pane" hidden={view !== "find"}>
            <FindMusic
              query={
                view === "find"
                  ? query
                  : remembered.current.search?.view === "find"
                    ? remembered.current.search.query
                    : ""
              }
              capabilities={soulseek}
              admin={session.user.admin}
              onQuery={(q) => navigate({ view: "find", query: q }, true)}
              onLibrary={() => browse("songs")}
            />
          </div>
        )}
      </main>
      {mobilePlayback && view !== "admin" && (
        <div className="mobile-chrome">
          <CompactPlayer
            player={player}
            onOpen={() => {
              setFromNowPlaying(true);
              setQueueTab("now");
              setQueueOpen(true);
            }}
          />
          <MobileTabs
            active={mobileTab}
            destinations={destinations}
            onSelect={selectTab}
          />
        </div>
      )}
      <MiniPlayer
        onArtist={(name) => {
          browseArtist(name);
          window.focus();
        }}
        player={player}
        target={miniPlayer.target}
        onClose={miniPlayer.close}
      />
      {editingTrack && session.user.admin && (
        <TrackMetadataEditor
          key={editingTrack.id}
          trackId={editingTrack.id}
          revision={0}
          onClose={() => setEditingTrack(null)}
          onSuggestions={async () => {
            setReload((v) => v + 1);
          }}
        />
      )}
      {addingTrack && (
        <PlaylistPicker
          key={addingTrack.id}
          track={addingTrack}
          playlists={playlists}
          onClose={() => setAddingTrack(null)}
          onCreate={() => {
            playlistReturnTrack.current = addingTrack;
            setAddingTrack(null);
            setAddingPlaylist(true);
          }}
          onAdd={async (destination) => {
            await api(`/playlists/${destination.id}/tracks`, "POST", {
              trackId: addingTrack.id,
            });
            collectionCache.current.clear();
            if (view === `playlist:${destination.id}`)
              setReload((value) => value + 1);
            setNotice(`Added “${addingTrack.title}” to ${destination.name}.`);
          }}
        />
      )}
      <PlaylistDialog
        open={addingPlaylist}
        onClose={() => {
          setAddingPlaylist(false);
          if (playlistReturnTrack.current) {
            setAddingTrack(playlistReturnTrack.current);
            playlistReturnTrack.current = null;
          }
        }}
        onCreate={async (name, icon) => {
          const created = await api<Playlist>("/playlists", "POST", {
            name,
            icon,
          });
          await refreshPlaylists();
          collectionCache.current.clear();
          if (!playlistReturnTrack.current) browse(`playlist:${created.id}`);
          setNotice(`Created “${created.name}”.`);
        }}
      />
      <PlaybackPanel
        fromNowPlaying={fromNowPlaying}
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        mobile={mobilePlayback}
        tab={queueTab}
        onTab={setQueueTab}
        resize={panelResize}
        player={player}
        onArtist={browseArtist}
        onNavigate={(next) => {
          navigate(next);
          setOffset(0);
          if (mobilePlayback) setQueueOpen(false);
        }}
        onAdded={(title) => setNotice(`Added “${title}” to the queue.`)}
        onExpired={expire}
      />
      <footer className="player" aria-label="Music player">
        <div className="now-playing">
          {player.current ? (
            <>
              <Artwork
                id={player.current.id}
                label={player.current.album || player.current.title}
                has={player.current.artwork}
              />
              <div>
                <strong>{player.current.title}</strong>
                <ArtistLinks
                  libraryId={route.libraryId}
                  credit={player.current.artist}
                  featuredArtists={player.current.featuredArtists}
                  videoGuests={player.current.videoGuests}
                  single={!player.current.album}
                  onNavigate={browseArtist}
                />
              </div>
              {player.cached(player.current.id) && (
                <span title="Available in this session" className="cached">
                  <Check size={15} />
                </span>
              )}
            </>
          ) : (
            <>
              <div className="player-placeholder">
                <Music2 />
              </div>
              <div>
                <strong>Find your next favorite</strong>
                <span>Your music starts here</span>
              </div>
            </>
          )}
        </div>
        <div className="transport">
          <div className="controls">
            <button
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={player.shuffle}
              className={player.shuffle ? "enabled" : ""}
              onClick={() => player.setShuffle((v) => !v)}
            >
              <Shuffle size={17} />
            </button>
            <button
              aria-label="Previous track"
              disabled={!player.canPrevious}
              onClick={() => player.next(true)}
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              className="play-button"
              aria-label={player.playing ? "Pause" : "Play"}
              disabled={!player.current && !player.canNext}
              onClick={player.toggle}
            >
              {player.playing ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <button
              aria-label="Next track"
              disabled={!player.canNext}
              onClick={() => player.next()}
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
            <button
              title={`Repeat: ${player.repeat}`}
              aria-label={`Repeat: ${player.repeat}`}
              className={player.repeat !== "off" ? "enabled" : ""}
              onClick={() =>
                player.setRepeat((v) =>
                  v === "off" ? "all" : v === "all" ? "one" : "off",
                )
              }
            >
              <Repeat size={17} />
              {player.repeat === "one" && <small>1</small>}
            </button>
          </div>
          <div className="timeline">
            <span>{duration(player.position)}</span>
            <input
              aria-label="Seek"
              aria-valuetext={`${duration(player.position)} of ${duration(player.length)}`}
              disabled={!player.current || !player.length}
              type="range"
              min={0}
              max={player.length || 1}
              step={0.1}
              value={Math.min(player.position, player.length || 1)}
              onChange={(e) => player.seek(Number(e.target.value))}
            />
            <span>{duration(player.length)}</span>
          </div>
        </div>
        <div className="player-extras">
          <button
            aria-label="Live lyrics"
            title="Live lyrics"
            aria-expanded={queueOpen && queueTab === "lyrics"}
            aria-controls="play-queue"
            className={queueOpen && queueTab === "lyrics" ? "enabled" : ""}
            onClick={() => {
              setQueueTab("lyrics");
              setQueueOpen(!(queueOpen && queueTab === "lyrics"));
            }}
          >
            <Mic2 size={20} />
          </button>
          <button
            title={`Queue · Session cache ${(player.cacheBytes / 1048576).toFixed(0)} MB`}
            aria-label="Play queue"
            aria-expanded={queueOpen && queueTab === "queue"}
            aria-controls="play-queue"
            className={queueOpen && queueTab === "queue" ? "enabled" : ""}
            onClick={() => {
              setQueueTab("queue");
              setQueueOpen(!(queueOpen && queueTab === "queue"));
            }}
          >
            <ListMusic size={20} />
          </button>
          {player.offline && <WifiOff size={17} />}
          <QualitySelect
            value={player.quality}
            onChange={player.changeQuality}
            compact
          />
          <VolumeControl value={player.volume} onChange={player.setVolume} />
          <button
            aria-label="Open mini player"
            title={miniPlayer.error || "Open mini player"}
            disabled={!player.current}
            onClick={() => void miniPlayer.open()}
          >
            <PictureInPicture2 size={18} />
          </button>
        </div>
      </footer>
    </div>
  );
}
