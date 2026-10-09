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
  LogOut,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Users,
  Volume2,
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
} from "./api";
import { usePlayer } from "./player";
import { Admin } from "./Admin";
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
  const expire = useCallback(() => {
    setSession(null);
    updateSession(null);
    setError("Your session expired. Sign in again.");
  }, []);
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
  const [view, setView] = useState("home");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const mainElement = useRef<HTMLElement>(null);
  useEffect(() => {
    mainElement.current?.scrollTo({ top: 0 });
  }, [view, selectedAlbum?.id, selectedArtist, debounced]);
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
  const browse = useCallback((v: string) => {
    setView(v);
    setSelectedAlbum(null);
    setSelectedArtist("");
    setOffset(0);
    setQuery("");
  }, []);
  const albumView = view === "home" || view === "albums";
  const artistView = view === "artists";
  useEffect(() => {
    if (!session || view === "admin") return;
    const id = ++request.current;
    setLoading(true);
    setOffset(0);
    const params = new URLSearchParams({
      limit: "100",
      offset: "0",
      q: debounced,
    });
    if (selectedAlbum) params.set("album", selectedAlbum.id);
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
    selectedAlbum,
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
    if (selectedAlbum) params.set("album", selectedAlbum.id);
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
        name: f.get("name"),
        password: f.get("password"),
        ...(setup ? { setupToken: f.get("setupToken") } : {}),
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
                Setup token
                <input
                  name="setupToken"
                  type="password"
                  required
                  autoComplete="off"
                />
              </label>
            )}
            <label>
              Username
              <input
                name="name"
                required
                maxLength={120}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={setup ? 12 : 1}
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
    <div className="app">
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
            onClick={() => setAddingPlaylist((v) => !v)}
          >
            <Plus size={17} />
          </button>
        </div>
        {addingPlaylist && (
          <form
            className="playlist-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/playlists", "POST", { name: playlistName });
                setPlaylistName("");
                setAddingPlaylist(false);
                await refreshPlaylists();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <input
              aria-label="Playlist name"
              placeholder="Playlist name"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              required
              maxLength={120}
            />
            <button title="Save playlist">
              <Check size={16} />
            </button>
          </form>
        )}
        <nav className="playlist-nav">
          {playlists.map((p) => (
            <button
              key={p.id}
              className={view === `playlist:${p.id}` ? "active" : ""}
              onClick={() => browse(`playlist:${p.id}`)}
            >
              <ListMusic />
              {p.name}
            </button>
          ))}
          {!playlists.length && (
            <p className="nav-empty">A place for your next mix.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          {session.user.admin && (
            <button onClick={() => browse("admin")}>
              <Settings size={17} /> Instance settings
            </button>
          )}
          <button onClick={() => void logout()}>
            <LogOut size={17} /> Sign out
          </button>
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
                setQuery(e.target.value);
                if (e.target.value) {
                  setView("songs");
                  setSelectedAlbum(null);
                  setSelectedArtist("");
                  setOffset(0);
                }
              }}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery("")}>
                <X size={16} />
              </button>
            )}
          </div>
          <div className="user-avatar" title={session.user.name}>
            {session.user.name.slice(0, 1).toUpperCase()}
          </div>
        </header>
        {error && (
          <div className="toast" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === "admin" ? (
          <Admin report={setError} />
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
              {addingPlaylist && (
                <form
                  className="row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api("/playlists", "POST", { name: playlistName });
                      setPlaylistName("");
                      setAddingPlaylist(false);
                      await refreshPlaylists();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <input
                    aria-label="Mobile playlist name"
                    placeholder="Playlist name"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    required
                    maxLength={120}
                  />
                  <button title="Create mobile playlist">
                    <Check size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel playlist"
                    onClick={() => setAddingPlaylist(false)}
                  >
                    <X size={16} />
                  </button>
                </form>
              )}
            </div>
            <div className="page-heading">
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
                        await api(`/playlists/${playlist.id}`, "DELETE");
                        await refreshPlaylists();
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
                      setSelectedAlbum(a);
                      setView("album");
                      setOffset(0);
                    }}
                  >
                    <div className="album-cover">
                      <Artwork
                        id={a.coverId}
                        label={a.title}
                        has={!!a.coverId}
                      />
                      <span className="album-play">
                        <Play fill="currentColor" size={20} />
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
                      setSelectedArtist(a.name);
                      setView("artist");
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
                  onQueue={player.enqueue}
                  onAdd={async (t) => {
                    if (!targetPlaylist) {
                      setError("Choose a playlist above the track list.");
                      return;
                    }
                    try {
                      await api(`/playlists/${targetPlaylist}/tracks`, "POST", {
                        trackId: t.id,
                      });
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
      {queueOpen && (
        <aside className="queue-panel">
          <div className="row">
            <h2>Play queue</h2>
            <button
              aria-label="Close queue"
              onClick={() => setQueueOpen(false)}
            >
              <X />
            </button>
          </div>
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
              <button aria-label="Move up" onClick={() => player.move(i, -1)}>
                <ArrowUp size={14} />
              </button>
              <button aria-label="Move down" onClick={() => player.move(i, 1)}>
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
              className={player.shuffle ? "enabled" : ""}
              onClick={() => player.setShuffle((v) => !v)}
            >
              <Shuffle size={17} />
            </button>
            <button
              aria-label="Previous track"
              onClick={() => player.next(true)}
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              className="play-button"
              aria-label={player.playing ? "Pause" : "Play"}
              onClick={player.toggle}
            >
              {player.playing ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <button aria-label="Next track" onClick={() => player.next()}>
              <SkipForward size={20} fill="currentColor" />
            </button>
            <button
              title={`Repeat: ${player.repeat}`}
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
          <select
            aria-label="Playback quality"
            value={player.quality}
            onChange={(e) =>
              player.changeQuality(e.target.value as "auto" | "high" | "saver")
            }
          >
            <option value="auto">Auto</option>
            <option value="high">High · 320k</option>
            <option value="saver">Saver · 128k</option>
          </select>
          <button
            title={`Queue · Session cache ${(player.cacheBytes / 1048576).toFixed(0)} MB`}
            className={queueOpen ? "enabled" : ""}
            onClick={() => setQueueOpen((v) => !v)}
          >
            <ListMusic size={20} />
          </button>
          <Volume2 size={18} />
          <input
            aria-label="Volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
          />
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
