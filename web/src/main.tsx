// SPDX-License-Identifier: GPL-2.0-or-later
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Album as AlbumIcon,
  ArrowDown,
  ArrowUp,
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
  cover,
  duration,
  Page,
  Playlist,
  Session,
  setSession,
  Track,
  User,
} from "./api";
import { usePlayer } from "./player";
import { Admin } from "./Admin";
import { AccountMenu } from "./AccountMenu";
import { QualitySelect, VolumeControl } from "./PlaybackControls";
import { PlaylistDialog, PlaylistIcon } from "./PlaylistDialog";
import { useNavigation } from "./useNavigation";
import { canMoveQueueItem } from "./queue";
import { LyricsPanel } from "./LyricsPanel";
import "./style.css";

function Artwork({
  id,
  label,
  has = false,
  className = "",
}: {
  id: string;
  label: string;
  has?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  const color = [...label].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={`art ${className}`}
      style={{ "--hue": color } as React.CSSProperties}
    >
      {has && !failed ? (
        <img
          src={cover(id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <Disc3 size={42} />
          <span>{label.slice(0, 1).toUpperCase()}</span>
        </>
      )}
    </div>
  );
}
function App() {
  const [session, updateSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
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
  useEffect(() => {
    if (!session) {
      player.clear();
      setTracks([]);
      setAlbums([]);
      setArtists([]);
      setPlaylists([]);
    }
  }, [session, player.clear]);
  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ setupRequired: boolean }>("/status"),
      api<Session>("/me").catch((e) => {
        if (e instanceof APIError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([status, s]) => {
        if (!live) return;
        setSetup(status.setupRequired);
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
  const { route, navigate } = useNavigation();
  const view = route.view;
  const query = route.query || "";
  const [debounced, setDebounced] = useState(query);
  const selectedArtist = route.artist || "";
  const selectedAlbumId = route.albumId;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
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
  const [queueTab, setQueueTab] = useState<"queue" | "lyrics">("queue");
  const queuePanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!queueOpen) return;
    const previous = document.activeElement;
    queuePanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [queueOpen]);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const mainElement = useRef<HTMLElement>(null);
  useEffect(() => {
    mainElement.current?.scrollTo({ top: 0 });
  }, [view, selectedAlbumId, selectedArtist, debounced]);
  const [targetPlaylist, setTargetPlaylist] = useState("");
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
      navigate({ view: v });
      setOffset(0);
    },
    [navigate],
  );
  useEffect(() => {
    if (session && !session.user.admin && view === "admin")
      navigate({ view: "home" }, true);
  }, [session, view, navigate]);
  const albumView = view === "home" || view === "albums";
  const artistView = view === "artists";
  useEffect(() => {
    const id = ++request.current;
    if (!session || view === "admin") return;
    setLoading(true);
    setOffset(0);
    const params = new URLSearchParams({
      limit: "100",
      offset: "0",
      q: debounced,
    });
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
          else setError(e.message);
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
    reload,
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
    try {
      await api(`/tracks/${t.id}/like`, "PUT", { liked: !t.liked });
      setTracks((ts) =>
        ts.map((x) => (x.id === t.id ? { ...x, liked: !x.liked } : x)),
      );
    } catch (e) {
      setError((e as Error).message);
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
      if ((e.target as HTMLElement).closest("input,textarea,select,button"))
        return;
      if (e.code === "Space" && session) {
        e.preventDefault();
        player.toggle();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [player.toggle, session]);
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
      likes: "Liked songs",
      history: "Recently played",
      admin: "Instance settings",
    }[view] ??
      "Library");
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
            <Headphones /> cadence<span className="dot">.</span>
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
    <div className={`app ${queueOpen ? "queue-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <Headphones /> cadence<span className="dot">.</span>
        </div>
        <nav>
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => browse("home")}
          >
            <Home /> Home
          </button>
          <button
            className={view === "songs" ? "active" : ""}
            onClick={() => browse("songs")}
          >
            <Music2 /> Songs
          </button>
          <button
            className={view === "albums" ? "active" : ""}
            onClick={() => browse("albums")}
          >
            <AlbumIcon /> Albums
          </button>
          <button
            className={view === "artists" ? "active" : ""}
            onClick={() => browse("artists")}
          >
            <Users /> Artists
          </button>
        </nav>
        <div className="nav-label">YOUR LIBRARY</div>
        <nav>
          <button
            className={view === "likes" ? "active" : ""}
            onClick={() => browse("likes")}
          >
            <Heart /> Liked songs
          </button>
          <button
            className={view === "history" ? "active" : ""}
            onClick={() => browse("history")}
          >
            <Clock /> Recently played
          </button>
        </nav>
        <div className="nav-label row">
          PLAYLISTS
          <button
            title="Create playlist"
            onClick={() => setAddingPlaylist(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="playlist-nav">
          {playlists.map((p) => (
            <button
              key={p.id}
              className={view === `playlist:${p.id}` ? "active" : ""}
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
      <main ref={mainElement}>
        <header className="topbar">
          <div className="back-buttons">
            <button aria-label="Back to library" onClick={() => browse("home")}>
              <ChevronLeft />
            </button>
          </div>
          <div className="search">
            <Search size={18} />
            <input
              aria-label="Search music"
              placeholder="Search your collection"
              value={query}
              onChange={(e) => {
                navigate(
                  { view: "songs", query: e.target.value },
                  view === "songs",
                );
                setOffset(0);
              }}
            />
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => navigate({ ...route, query: "" }, true)}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <AccountMenu
            user={session.user}
            quality={player.quality}
            volume={player.volume}
            offline={player.offline}
            onQuality={player.changeQuality}
            onVolume={player.setVolume}
            onAdmin={() => browse("admin")}
            onQueue={() => {
              setQueueTab("queue");
              setQueueOpen(true);
            }}
            onLogout={logout}
            onUpdated={userUpdated}
            onExpired={expire}
          />
        </header>
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
            tab={route.adminTab || "library"}
            onTab={(tab) => navigate({ view: "admin", adminTab: tab })}
            report={setError}
            onUpdated={userUpdated}
            onRevoked={(id) => {
              if (id === session.user.id) expire();
            }}
            onExpired={expire}
          />
        ) : (
          <section className="content">
            <div className="mobile-nav">
              <select
                aria-label="Go to collection"
                value={["album", "artist"].includes(view) ? "albums" : view}
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
                <option value="__new">Create playlist…</option>
              </select>
            </div>
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
                <h1>{debounced ? `Results for “${debounced}”` : heading}</h1>
                <p className="subtitle">
                  {selectedAlbum
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
                  ? "On the record"
                  : artistView
                    ? "The people behind the music"
                    : selectedAlbum
                      ? "Tracks"
                      : "Made for your listening"}
              </h2>
              <div className="row">
                {!albumView && !artistView && tracks.length > 0 && (
                  <button
                    className="primary small"
                    onClick={() => player.play(tracks)}
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
            {albumView ? (
              <div className="album-grid">
                {albums.map((a) => (
                  <button
                    className="album-card"
                    key={a.id}
                    onClick={() => {
                      navigate({ view: "album", albumId: a.id });
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
                      navigate({ view: "artist", artist: a.name });
                      setOffset(0);
                    }}
                  >
                    <Artwork id="" label={a.name} />
                    <strong>{a.name}</strong>
                    <span>{a.tracks.toLocaleString()} songs</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="track-toolbar">
                  <label>
                    Add songs to{" "}
                    <select
                      value={targetPlaylist}
                      onChange={(e) => setTargetPlaylist(e.target.value)}
                    >
                      <option value="">Choose playlist</option>
                      {playlists.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <TrackList
                  tracks={tracks}
                  currentId={player.current?.id}
                  playing={player.playing}
                  cached={player.cached}
                  onPlay={(i) => player.play(tracks, i)}
                  onLike={(t) => void like(t)}
                  onQueue={(track) => {
                    player.enqueue(track);
                    setNotice(`Added “${track.title}” to the queue.`);
                  }}
                  onAdd={async (t) => {
                    if (!targetPlaylist) {
                      setError("Choose a playlist above the track list.");
                      return;
                    }
                    try {
                      await api(`/playlists/${targetPlaylist}/tracks`, "POST", {
                        trackId: t.id,
                      });
                      setNotice(
                        `Added “${t.title}” to ${playlists.find((p) => p.id === targetPlaylist)?.name || "playlist"}.`,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
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
            {loading && <p className="empty">Loading your collection…</p>}
            {!loading &&
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
                        ? "Mount your music folder, then run a scan in Instance settings."
                        : "Your administrator can add music to this instance."}
                  </p>
                </div>
              )}
            {more && (
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
      </main>
      <PlaylistDialog
        open={addingPlaylist}
        onClose={() => setAddingPlaylist(false)}
        onCreate={async (name, icon) => {
          const created = await api<Playlist>("/playlists", "POST", {
            name,
            icon,
          });
          await refreshPlaylists();
          browse(`playlist:${created.id}`);
          setNotice(`Created “${created.name}”.`);
        }}
      />
      {queueOpen && (
        <aside
          className="queue-panel"
          ref={queuePanel}
          id="play-queue"
          aria-label={queueTab === "queue" ? "Play queue" : "Lyrics"}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQueueOpen(false);
          }}
        >
          <div className="row">
            <h2>{queueTab === "queue" ? "Play queue" : "Lyrics"}</h2>
            <button
              aria-label={queueTab === "queue" ? "Close queue" : "Close lyrics"}
              onClick={() => setQueueOpen(false)}
            >
              <X />
            </button>
          </div>
          <div
            className="playback-tabs"
            role="tablist"
            aria-label="Playback panel"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = queueTab === "queue" ? "lyrics" : "queue";
                setQueueTab(next);
                event.currentTarget
                  .querySelector<HTMLButtonElement>(`[id="${next}-tab"]`)
                  ?.focus();
              }
            }}
          >
            <button
              id="queue-tab"
              role="tab"
              aria-selected={queueTab === "queue"}
              aria-controls="queue-content"
              tabIndex={queueTab === "queue" ? 0 : -1}
              onClick={() => setQueueTab("queue")}
            >
              Queue
            </button>
            <button
              id="lyrics-tab"
              role="tab"
              aria-selected={queueTab === "lyrics"}
              aria-controls="lyrics-content"
              tabIndex={queueTab === "lyrics" ? 0 : -1}
              onClick={() => setQueueTab("lyrics")}
            >
              Lyrics
            </button>
          </div>
          {queueTab === "lyrics" ? (
            <div
              id="lyrics-content"
              role="tabpanel"
              aria-labelledby="lyrics-tab"
            >
              <LyricsPanel
                track={player.current}
                position={player.position}
                onSeek={player.seek}
                onExpired={expire}
              />
            </div>
          ) : (
            <div id="queue-content" role="tabpanel" aria-labelledby="queue-tab">
              {player.queue.map((t, i) => (
                <div
                  key={`${t.id}:${i}`}
                  className={`queue-track ${i === player.index ? "current" : ""}`}
                >
                  <button
                    className="queue-title"
                    onClick={() => player.play(player.queue, i)}
                  >
                    {t.title}
                    <small>{t.artist}</small>
                  </button>
                  <button
                    aria-label="Move up"
                    disabled={
                      !canMoveQueueItem(
                        i,
                        -1,
                        player.index,
                        player.queue.length,
                      )
                    }
                    onClick={() => player.move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label="Move down"
                    disabled={
                      !canMoveQueueItem(i, 1, player.index, player.queue.length)
                    }
                    onClick={() => player.move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label="Remove from queue"
                    onClick={() => player.remove(i)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {!player.queue.length && (
                <p className="muted">Add a song to get started.</p>
              )}
            </div>
          )}
        </aside>
      )}
      <footer className="player">
        <div className="now-playing">
          {player.current ? (
            <>
              <Artwork
                id={player.current.id}
                label={player.current.album}
                has={player.current.artwork}
              />
              <div>
                <strong>{player.current.title}</strong>
                <span>{player.current.artist}</span>
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
              aria-pressed={player.shuffle}
              className={player.shuffle ? "enabled" : ""}
              onClick={() => player.setShuffle((v) => !v)}
            >
              <Shuffle size={17} />
            </button>
            <button
              aria-label="Previous track"
              disabled={!player.queue.length}
              onClick={() => player.next(true)}
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              className="play-button"
              aria-label={player.playing ? "Pause" : "Play"}
              disabled={!player.current}
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
              disabled={!player.queue.length}
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
          {player.offline && <WifiOff size={17} />}
          <QualitySelect
            value={player.quality}
            onChange={player.changeQuality}
            compact
          />
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
          <VolumeControl value={player.volume} onChange={player.setVolume} />
        </div>
      </footer>
    </div>
  );
}
function TrackList({
  tracks,
  currentId,
  playing,
  cached,
  onPlay,
  onLike,
  onQueue,
  onAdd,
  onRemove,
}: {
  tracks: Track[];
  currentId?: string;
  playing: boolean;
  cached: (id: string) => boolean;
  onPlay: (i: number) => void;
  onLike: (t: Track) => void;
  onQueue: (t: Track) => void;
  onAdd: (t: Track) => void;
  onRemove?: (t: Track) => void;
}) {
  const [scroll, setScroll] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver((v) => setHeight(v[0].contentRect.height));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScroll(0);
  }, [tracks[0]?.id]);
  const row = 66;
  const start = Math.max(0, Math.floor(scroll / row) - 6);
  const end = Math.min(tracks.length, Math.ceil((scroll + height) / row) + 6);
  return (
    <div className="track-list">
      <div className="track-header">
        <span>#</span>
        <span>TITLE</span>
        <span>ALBUM</span>
        <span>
          <Clock size={15} />
        </span>
        <span />
      </div>
      <div
        className="track-scroll"
        ref={ref}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        <div style={{ height: tracks.length * row, position: "relative" }}>
          {tracks.slice(start, end).map((t, j) => {
            const i = start + j;
            return (
              <div
                key={t.id}
                style={{
                  position: "absolute",
                  top: i * row,
                  height: row,
                  left: 0,
                  right: 0,
                }}
                className={`track-row ${t.id === currentId ? "current" : ""}`}
                onDoubleClick={() => onPlay(i)}
              >
                <button
                  className="track-number"
                  aria-label={`Play ${t.title}`}
                  onClick={() => onPlay(i)}
                >
                  {t.id === currentId && playing ? (
                    <span className="equalizer">▂▆▃</span>
                  ) : (
                    <>
                      <span>{i + 1}</span>
                      <Play size={15} fill="currentColor" />
                    </>
                  )}
                </button>
                <div className="track-title">
                  <Artwork id={t.id} label={t.album} has={t.artwork} />
                  <div>
                    <button onClick={() => onPlay(i)}>{t.title}</button>
                    <span>
                      {t.artist}
                      {cached(t.id) && <Check size={12} className="cached" />}
                    </span>
                  </div>
                </div>
                <span className="track-album">{t.album}</span>
                <span className="track-duration">{duration(t.duration)}</span>
                <div
                  className={`track-actions ${expanded === t.id ? "open" : ""}`}
                >
                  <button
                    title={t.liked ? "Unlike" : "Like"}
                    aria-pressed={t.liked}
                    className={t.liked ? "enabled" : ""}
                    onClick={() => onLike(t)}
                  >
                    <Heart size={16} fill={t.liked ? "currentColor" : "none"} />
                  </button>
                  <button
                    title="Add to selected playlist"
                    onClick={() => onAdd(t)}
                  >
                    <Plus size={17} />
                  </button>
                  <button title="Add to queue" onClick={() => onQueue(t)}>
                    <ListMusic size={17} />
                  </button>
                  {onRemove && (
                    <button
                      title="Remove from playlist"
                      onClick={() => onRemove(t)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <button
                  className="track-menu-trigger"
                  aria-label={`Actions for ${t.title}`}
                  aria-expanded={expanded === t.id}
                  onClick={() => setExpanded((v) => (v === t.id ? null : t.id))}
                >
                  •••
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
