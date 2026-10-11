// SPDX-License-Identifier: GPL-2.0-or-later
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "./components/ui/alert-dialog";
import { Select, SelectItem } from "./components/ui/select";
import { Form } from "./components/ui/form";
import { Input } from "./components/ui/input";
import { Slider } from "./components/ui/slider";
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
  duration,
  Playlist,
  Session,
  setSession,
  syncSession,
  Track,
  User,
} from "./services/api";
import { catalogLibrary, type LibrarySummary } from "./lib/libraries";
import { PlaybackStatus } from "./components/playback/PlaybackStatus";
import { useCollection } from "./hooks/useCollection";
import { watchLibraries } from "./lib/collection";
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
import { PlaylistIconDialog } from "./components/playlists/PlaylistIconDialog";
import { playlistTracks } from "./lib/playlistPlayback";
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
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
      setPlaylists([]);
      setEditingPlaylistIcon(null);
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
  const [editingPlaylistIcon, setEditingPlaylistIcon] =
    useState<Playlist | null>(null);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const collectionKey = JSON.stringify([
    view,
    selectedAlbumId,
    selectedArtist,
    query,
    libraryId,
  ]);
  const [reload, setReload] = useState(0);
  const {
    albums,
    artists,
    tracks,
    total,
    more,
    loading,
    refreshing,
    collectionReady,
    collectionError,
    refreshCollection,
    invalidateCollection,
    loadMore,
    setTracks,
  } = useCollection(
    {
      userId: session?.user.id,
      key: collectionKey,
      view,
      query,
      debounced,
      libraryId,
      albumId: selectedAlbumId,
      artist: selectedArtist,
      reload,
    },
    expire,
  );
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
  useEffect(() => {
    if (!session?.user.id) {
      setLibraries([]);
      return;
    }
    return watchLibraries(
      (next) => {
        setLibraries(next);
        const selected = currentRoute.current.libraryId;
        if (selected && !next.some((item) => item.id === selected)) {
          invalidateCollection(true);
          navigate({ ...currentRoute.current, libraryId: undefined }, true);
          return;
        }
        refreshCollection();
      },
      (error) => {
        if (error instanceof APIError && error.status === 401) expire();
        else setError(error.message);
      },
    );
  }, [
    session?.user.id,
    libraryRevision,
    navigate,
    expire,
    refreshCollection,
    invalidateCollection,
  ]);
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
  const playlistReturnTrack = useRef<Track | null>(null);
  const createdPlaylistForTrack = useRef<Playlist | null>(null);
  useEffect(() => {
    playlistReturnTrack.current = null;
    createdPlaylistForTrack.current = null;
    setAddingPlaylist(false);
  }, [session?.user.id]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  async function togglePlaylist(
    track: Track,
    destination: Playlist,
    added: boolean,
  ) {
    const userID = activeUser.current;
    await api(
      added
        ? `/playlists/${destination.id}/tracks`
        : `/playlists/${destination.id}/tracks/${track.id}`,
      added ? "POST" : "DELETE",
      added ? { trackId: track.id } : undefined,
    );
    if (activeUser.current !== userID) return;
    invalidateCollection();
    if (view === `playlist:${destination.id}`) setReload((value) => value + 1);
    setNotice(
      `${added ? "Added" : "Removed"} “${track.title}” ${added ? "to" : "from"} ${destination.name}.`,
    );
  }
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
    },
    [navigate, route.libraryId],
  );
  const browseArtist = (artist: string) => {
    navigate({ view: "artist", artist, libraryId: route.libraryId });
    setQueueOpen(false);
  };
  useEffect(() => {
    if (session && !session.user.admin && view === "admin")
      navigate({ view: "home" }, true);
  }, [session, view, navigate]);
  const albumView = view === "home" || view === "albums";
  const artistView = view === "artists";
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
      invalidateCollection(true);
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
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
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
          "input,textarea,select,button,a,summary,[contenteditable],[role=menu],[role=slider],[role=combobox],[role=radio],[role=checkbox],[role=tab]",
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
  const [playlistPending, setPlaylistPending] = useState(false);
  const playlistRequest = useRef(0);
  useEffect(() => {
    playlistRequest.current++;
    setPlaylistPending(false);
  }, [view, session?.user.id]);
  async function playPlaylistNext() {
    if (!playlist || !session) return;
    const request = ++playlistRequest.current;
    const user = session.user.id;
    const source = {
      name: playlist.name,
      route: { view: `playlist:${playlist.id}` },
    };
    const valid = () =>
      request === playlistRequest.current && activeUser.current === user;
    setPlaylistPending(true);
    try {
      const songs = await playlistTracks(playlist.id, valid);
      if (!songs || !valid()) return;
      if (!songs.length) {
        setNotice("This playlist has no playable songs.");
        return;
      }
      player.replaceUpcoming(songs, source);
      setNotice(
        `Loaded “${playlist.name}” after the current song and manual queue.`,
      );
    } catch (error) {
      if (valid()) {
        if (error instanceof APIError && error.status === 401) expire();
        else setError((error as Error).message);
      }
    } finally {
      if (valid()) setPlaylistPending(false);
    }
  }
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
      <Select
        aria-label="Choose library"
        value={route.libraryId || ""}
        onChange={(event) => {
          navigate({ ...route, libraryId: event.target.value || undefined });
        }}
      >
        <SelectItem value="">All accessible music</SelectItem>
        {libraries.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </Select>
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
          <Form onSubmit={auth}>
            {setup && (
              <label>
                Display name
                <Input
                  name="displayName"
                  required
                  maxLength={120}
                  autoComplete="nickname"
                />
              </label>
            )}
            <label>
              Username
              <Input
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
              <Input
                name="password"
                type="password"
                required
                minLength={setup ? 3 : 1}
                maxLength={72}
                autoComplete={setup ? "new-password" : "current-password"}
              />
            </label>
            <Button variant="ghost" className="primary" disabled={authBusy}>
              {authBusy ? "Connecting…" : setup ? "Create instance" : "Sign in"}{" "}
              <ChevronRight size={18} />
            </Button>
          </Form>
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
            <Button
              variant="ghost"
              className={view === "find" ? "active" : ""}
              aria-current={view === "find" ? "page" : undefined}
              onClick={() => navigate({ view: "find", query })}
            >
              <Search /> Find music
            </Button>
          )}
          <Button
            variant="ghost"
            className={view === "home" ? "active" : ""}
            aria-current={view === "home" ? "page" : undefined}
            onClick={() => browse("home")}
          >
            <Home /> Home
          </Button>
          <Button
            variant="ghost"
            className={view === "songs" ? "active" : ""}
            aria-current={view === "songs" ? "page" : undefined}
            onClick={() => browse("songs")}
          >
            <Music2 /> Songs
          </Button>
          <Button
            variant="ghost"
            className={view === "albums" ? "active" : ""}
            aria-current={
              view === "albums" || view === "album" ? "page" : undefined
            }
            onClick={() => browse("albums")}
          >
            <AlbumIcon /> Albums
          </Button>
          <Button
            variant="ghost"
            className={view === "artists" ? "active" : ""}
            aria-current={
              view === "artists" || view === "artist" ? "page" : undefined
            }
            onClick={() => browse("artists")}
          >
            <Users /> Artists
          </Button>
        </nav>
        <div className="nav-label">YOUR LIBRARY</div>
        <nav aria-label="Your library">
          <Button
            variant="ghost"
            className={view === "likes" ? "active" : ""}
            aria-current={view === "likes" ? "page" : undefined}
            onClick={() => browse("likes")}
          >
            <Heart /> Liked songs
          </Button>
          <Button
            variant="ghost"
            className={view === "history" ? "active" : ""}
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => browse("history")}
          >
            <Clock /> Recently played
          </Button>
        </nav>
        <div className="nav-label row">
          PLAYLISTS
          <Button
            variant="ghost"
            title="Create playlist"
            aria-label="Create playlist"
            onClick={() => setAddingPlaylist(true)}
          >
            <Plus size={17} />
          </Button>
        </div>
        <nav className="playlist-nav" aria-label="Playlists">
          {playlists.map((p) => (
            <Button
              variant="ghost"
              key={p.id}
              className={view === `playlist:${p.id}` ? "active" : ""}
              aria-current={view === `playlist:${p.id}` ? "page" : undefined}
              onClick={() => browse(`playlist:${p.id}`)}
            >
              <PlaylistIcon name={p.icon} />
              {p.name}
            </Button>
          ))}
          {!playlists.length && (
            <p className="nav-empty">A place for your next mix.</p>
          )}
        </nav>
        {player.offline && (
          <div className="sidebar-bottom">
            <div className="instance">
              <span className="status offline" />
              Offline session
            </div>
          </div>
        )}
      </aside>
      <main ref={mainElement} id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="back-buttons">
            <Button
              variant="ghost"
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
            </Button>
          </div>
          <span className="phone-page-title">{heading}</span>
          <div
            className={`search ${view === "search" || view === "find" || ((view === "songs" || view === "search") && query) ? "phone-search-visible" : ""}`}
          >
            <Search size={18} />
            <Input
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
              }}
            />
            {!query && (
              <kbd title="Search: Control K or Command K">⌘ / Ctrl K</kbd>
            )}
            {query && (
              <Button
                variant="ghost"
                aria-label="Clear search"
                onClick={() => navigate({ ...route, query: "" }, true)}
              >
                <X size={16} />
              </Button>
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
            <Button
              variant="ghost"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {miniPlayer.error && (
          <div className="toast" role="alert">
            <span>{miniPlayer.error}</span>
            <Button
              variant="ghost"
              aria-label="Dismiss mini player error"
              onClick={miniPlayer.clearError}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {error && (
          <div className="toast" role="alert">
            {error}
            <Button
              variant="ghost"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </Button>
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
              <Button
                variant="ghost"
                onClick={() => navigate({ view: "find" })}
              >
                Find music beyond your library
              </Button>
            )}
          </section>
        ) : (
          <section className="content">
            {mobilePlayback &&
              view !== mobileTab &&
              view !== "find" &&
              !(view === "songs" && query) && (
                <Button
                  variant="ghost"
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
                </Button>
              )}
            <div className="mobile-nav">
              <Select
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
                  <SelectItem value={id} key={id}>
                    {name}
                  </SelectItem>
                ))}
                {playlists.map((p) => (
                  <SelectItem key={p.id} value={`playlist:${p.id}`}>
                    {p.name}
                  </SelectItem>
                ))}
                {soulseek.allowed && (
                  <SelectItem value="find">Find music</SelectItem>
                )}
                <SelectItem value="__new">Create playlist…</SelectItem>
              </Select>
            </div>
            {(view === "songs" || view === "search") &&
              query &&
              soulseek.allowed && (
                <Button
                  variant="ghost"
                  className="soulseek-search-link"
                  onClick={() => navigate({ view: "find", query })}
                >
                  Find “{query}” on Soulseek
                </Button>
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
                }}
              />
            )}
            {view === "home" && (
              <div className="welcome-strip">
                <div>
                  <span className="eyebrow">THE WHOLE COLLECTION</span>
                  <h2>Set the mood.</h2>
                  <p>Your library is the only algorithm you need.</p>
                  <Button
                    variant="ghost"
                    className="primary"
                    onClick={() => browse("songs")}
                  >
                    <Music2 size={17} /> Explore songs
                  </Button>
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
                <span
                  className="collection-update"
                  role="status"
                  aria-live="polite"
                >
                  {refreshing && collectionReady ? "Updating…" : ""}
                </span>
                {collectionReady &&
                  !albumView &&
                  !artistView &&
                  tracks.length > 0 && (
                    <Button
                      variant="ghost"
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
                    </Button>
                  )}
                {playlist && (
                  <Button
                    variant="ghost"
                    className="subtle"
                    disabled={
                      playlistPending || !collectionReady || total === 0
                    }
                    onClick={() => void playPlaylistNext()}
                  >
                    {playlistPending
                      ? "Loading playlist…"
                      : "Play after current song"}
                  </Button>
                )}
                {playlist && (
                  <AlertDialog
                    open={deleteOpen}
                    onOpenChange={(open) => {
                      if (!deleteBusy) {
                        setDeleteOpen(open);
                        setDeleteError("");
                      }
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" type="button">
                        Delete playlist
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent
                      onEscapeKeyDown={(event) => {
                        if (deleteBusy) event.preventDefault();
                      }}
                    >
                      <AlertDialogTitle>
                        Delete “{playlist.name}”?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Your songs will stay in the library.
                      </AlertDialogDescription>
                      {deleteError && (
                        <p role="alert" className="auth-error">
                          {deleteError}
                        </p>
                      )}
                      <div className="row">
                        <AlertDialogCancel asChild>
                          <Button variant="outline" disabled={deleteBusy}>
                            Cancel
                          </Button>
                        </AlertDialogCancel>
                        <Button
                          disabled={deleteBusy}
                          onClick={async () => {
                            if (deleteBusy) return;
                            setDeleteBusy(true);
                            setDeleteError("");
                            try {
                              await api(`/playlists/${playlist.id}`, "DELETE");
                              invalidateCollection();
                              await refreshPlaylists();
                              setDeleteOpen(false);
                              setNotice(
                                "Playlist deleted. Your songs are still in the library.",
                              );
                              browse("home");
                            } catch (error) {
                              setDeleteError((error as Error).message);
                            } finally {
                              setDeleteBusy(false);
                            }
                          }}
                        >
                          {deleteBusy ? "Deleting…" : "Delete playlist"}
                        </Button>
                      </div>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {playlist && (
                  <Button
                    variant="ghost"
                    className="subtle"
                    onClick={() => setEditingPlaylistIcon(playlist)}
                  >
                    Change icon
                  </Button>
                )}
              </div>
            </div>
            {collectionReady && collectionError?.key === collectionKey && (
              <div className="toast" role="alert">
                <span>{collectionError.message}</span>
                <Button
                  variant="ghost"
                  disabled={loading}
                  onClick={() => setReload((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            )}
            {!collectionReady ? (
              <div className="collection-placeholder">
                {collectionError?.key === collectionKey ? (
                  <div className="empty" role="alert">
                    <h3>Couldn’t load this collection.</h3>
                    <p>{collectionError.message}</p>
                    <Button
                      variant="ghost"
                      className="primary"
                      onClick={() => setReload((value) => value + 1)}
                    >
                      Try again
                    </Button>
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
                  <Button
                    variant="ghost"
                    className="album-card"
                    key={a.id}
                    onClick={() => {
                      navigate({
                        view: "album",
                        albumId: a.id,
                        libraryId: route.libraryId,
                      });
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
                  </Button>
                ))}
              </div>
            ) : artistView ? (
              <div className="album-grid">
                {artists.map((a) => (
                  <Button
                    variant="ghost"
                    className="album-card artist-card"
                    key={a.name}
                    onClick={() => {
                      navigate({
                        view: "artist",
                        artist: a.name,
                        libraryId: route.libraryId,
                      });
                    }}
                  >
                    <ArtistAvatar name={a.name} image={a.image} />
                    <strong>{a.name}</strong>
                    <span>{a.tracks.toLocaleString()} songs</span>
                  </Button>
                ))}
              </div>
            ) : (
              <>
                <TrackList
                  collectionKey={collectionKey}
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
                  playlists={playlists}
                  onPlaylistToggle={togglePlaylist}
                  onAdd={(track) => {
                    playlistReturnTrack.current = track;
                    createdPlaylistForTrack.current = null;
                    setAddingPlaylist(true);
                  }}
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
              <Button
                variant="ghost"
                className="load-more"
                disabled={loading}
                onClick={() => void loadMore()}
              >
                Load more <ChevronRight size={16} />
              </Button>
            )}
            <footer className="content-footer">
              CADENCE <span>Music on your terms.</span>
            </footer>
          </section>
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
      <PlaylistDialog
        open={addingPlaylist}
        onClose={() => {
          setAddingPlaylist(false);
          playlistReturnTrack.current = null;
          createdPlaylistForTrack.current = null;
        }}
        onCreate={async (name, icon) => {
          const revision = syncSession().revision;
          const track = playlistReturnTrack.current;
          const created =
            createdPlaylistForTrack.current ??
            (await api<Playlist>("/playlists", "POST", { name, icon }));
          if (syncSession().revision !== revision)
            throw new Error("Your session changed. Reopen the playlist menu.");
          if (track) createdPlaylistForTrack.current = created;
          await refreshPlaylists();
          if (syncSession().revision !== revision)
            throw new Error("Your session changed. Reopen the playlist menu.");
          invalidateCollection();
          if (track) await togglePlaylist(track, created, true);
          else {
            browse(`playlist:${created.id}`);
            setNotice(`Created “${created.name}”.`);
          }
        }}
      />
      {editingPlaylistIcon && session && (
        <PlaylistIconDialog
          key={editingPlaylistIcon.id}
          name={editingPlaylistIcon.name}
          initialIcon={editingPlaylistIcon.icon}
          onClose={() => setEditingPlaylistIcon(null)}
          onSave={async (icon) => {
            const updated = await api<Playlist>(
              `/playlists/${editingPlaylistIcon.id}`,
              "PATCH",
              { icon },
            );
            setPlaylists((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setNotice(`Updated icon for “${updated.name}”.`);
          }}
        />
      )}
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
            <Button
              variant="ghost"
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={player.shuffle}
              className={player.shuffle ? "enabled" : ""}
              onClick={() => player.setShuffle((v) => !v)}
            >
              <Shuffle size={17} />
            </Button>
            <Button
              variant="ghost"
              aria-label="Previous track"
              disabled={!player.canPrevious}
              onClick={() => player.next(true)}
            >
              <SkipBack size={20} fill="currentColor" />
            </Button>
            <Button
              variant="ghost"
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
            </Button>
            <Button
              variant="ghost"
              aria-label="Next track"
              disabled={!player.canNext}
              onClick={() => player.next()}
            >
              <SkipForward size={20} fill="currentColor" />
            </Button>
            <Button
              variant="ghost"
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
            </Button>
          </div>
          <div className="timeline">
            <span>{duration(player.position)}</span>
            <Slider
              aria-label="Seek"
              aria-valuetext={`${duration(player.position)} of ${duration(player.length)}`}
              disabled={!player.current || !player.length}

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
          <Button
            variant="ghost"
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
          </Button>
          <Button
            variant="ghost"
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
          </Button>
          {player.offline && <WifiOff size={17} />}
          <QualitySelect
            value={player.quality}
            onChange={player.changeQuality}
            compact
          />
          <VolumeControl value={player.volume} onChange={player.setVolume} />
          <Button
            variant="ghost"
            aria-label="Open mini player"
            title={miniPlayer.error || "Open mini player"}
            disabled={!player.current}
            onClick={() => void miniPlayer.open()}
          >
            <PictureInPicture2 size={18} />
          </Button>
        </div>
      </footer>
    </div>
  );
}
