// SPDX-License-Identifier: GPL-2.0-or-later
import { useState, useEffect } from "react";
import {
  Home,
  Search,
  Library,
  Pause,
  Play,
  Music2,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  ListMusic,
  Mic2,
} from "lucide-react";
import { cover, duration, type Playlist } from "./api";
import type { usePlayer } from "./player";
import { routeURL, type Route } from "./navigation";
import type { MobileTab } from "./mobileNavigation";
import { ArtistLinks } from "./ArtistLinks";
import { QualitySelect, VolumeControl } from "./PlaybackControls";
import { PlaylistIcon } from "./PlaylistDialog";

function MobileArtwork({ id, artwork }: { id: string; artwork: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  return artwork && !failed ? (
    <img src={cover(id)} alt="" onError={() => setFailed(true)} />
  ) : (
    <span className="compact-art">
      <Music2 size={40} />
    </span>
  );
}
type Player = ReturnType<typeof usePlayer>;
export function MobileTabs({
  active,
  destinations,
  onSelect,
}: {
  active: MobileTab;
  destinations: Record<MobileTab, Route>;
  onSelect: (tab: MobileTab) => void;
}) {
  return (
    <nav className="mobile-tabs" aria-label="Main navigation">
      {(
        [
          ["home", "Home", Home],
          ["search", "Search", Search],
          ["library", "Library", Library],
        ] as const
      ).map(([tab, label, Icon]) => (
        <a
          key={tab}
          href={routeURL(destinations[tab])}
          aria-current={active === tab ? "page" : undefined}
          onClick={(event) => {
            if (
              event.button ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onSelect(tab);
          }}
        >
          <Icon size={23} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}
export function CompactPlayer({
  player,
  onOpen,
}: {
  player: Player;
  onOpen: () => void;
}) {
  if (!player.current) return null;
  return (
    <div className="compact-player" aria-label="Music player">
      <button
        className="compact-track"
        aria-label={`Open Now Playing: ${player.current.title}`}
        onClick={onOpen}
      >
        <MobileArtwork
          id={player.current.id}
          artwork={player.current.artwork}
        />
        <span>
          <strong>{player.current.title}</strong>
          <small>{player.current.artist}</small>
        </span>
      </button>
      <button
        aria-label={player.playing ? "Pause" : "Play"}
        onClick={player.toggle}
      >
        {player.playing ? <Pause size={23} /> : <Play size={23} />}
      </button>
    </div>
  );
}
export function LibraryOverview({
  playlists,
  librarySelector,
  onNavigate,
  onCreate,
}: {
  playlists: Playlist[];
  librarySelector: React.ReactNode;
  onNavigate: (view: string) => void;
  onCreate: () => void;
}) {
  return (
    <section className="content library-overview">
      <h1 tabIndex={-1}>Your library</h1>
      {librarySelector}
      <div className="library-destinations">
        {[
          ["songs", "Songs"],
          ["albums", "Albums"],
          ["artists", "Artists"],
          ["likes", "Liked songs"],
          ["history", "Recently played"],
        ].map(([view, label]) => (
          <button key={view} onClick={() => onNavigate(view)}>
            {label}
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      <div className="section-heading">
        <h2>Playlists</h2>
        <button onClick={onCreate}>Create playlist</button>
      </div>
      <div className="library-destinations">
        {playlists.map((p) => (
          <button key={p.id} onClick={() => onNavigate(`playlist:${p.id}`)}>
            <PlaylistIcon name={p.icon} />
            <span>{p.name}</span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      {!playlists.length && (
        <p className="muted">Create a playlist to collect your favorites.</p>
      )}
    </section>
  );
}
export function NowPlaying({
  player,
  onArtist,
  onPanel,
}: {
  player: Player;
  onArtist: (name: string) => void;
  onPanel: (tab: "queue" | "lyrics") => void;
}) {
  const track = player.current;
  return (
    <div className="now-playing-view">
      <div className="now-playing-art">
        {track ? (
          <MobileArtwork id={track.id} artwork={track.artwork} />
        ) : (
          <Music2 size={80} />
        )}
      </div>
      <div className="now-playing-credit">
        <strong>{track?.title || "Choose a song to start listening"}</strong>
        {track && <ArtistLinks credit={track.artist} onNavigate={onArtist} />}
      </div>
      <div className="timeline">
        <span>{duration(player.position)}</span>
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={`${duration(player.position)} of ${duration(player.length)}`}
          min={0}
          max={player.length || 1}
          step={0.1}
          value={Math.min(player.position, player.length || 1)}
          disabled={!track || !player.length}
          onChange={(e) => player.seek(Number(e.target.value))}
        />
        <span>{duration(player.length)}</span>
      </div>
      <div className="controls">
        <button
          aria-label="Shuffle"
          aria-pressed={player.shuffle}
          className={player.shuffle ? "enabled" : ""}
          onClick={() => player.setShuffle((v) => !v)}
        >
          <Shuffle size={21} />
        </button>
        <button
          aria-label="Previous track"
          disabled={!player.canPrevious}
          onClick={() => player.next(true)}
        >
          <SkipBack size={24} />
        </button>
        <button
          className="play-button"
          aria-label={player.playing ? "Pause" : "Play"}
          disabled={!track && !player.canNext}
          onClick={player.toggle}
        >
          {player.playing ? <Pause size={26} /> : <Play size={26} />}
        </button>
        <button
          aria-label="Next track"
          disabled={!player.canNext}
          onClick={() => player.next()}
        >
          <SkipForward size={24} />
        </button>
        <button
          aria-label={`Repeat: ${player.repeat}`}
          className={player.repeat !== "off" ? "enabled" : ""}
          onClick={() =>
            player.setRepeat((v) =>
              v === "off" ? "all" : v === "all" ? "one" : "off",
            )
          }
        >
          <Repeat size={21} />
          {player.repeat === "one" && <small>1</small>}
        </button>
      </div>
      <div className="now-playing-utilities">
        <button onClick={() => onPanel("queue")}>
          <ListMusic size={21} />
          Queue
        </button>
        <button onClick={() => onPanel("lyrics")}>
          <Mic2 size={21} />
          Lyrics
        </button>
        <QualitySelect
          value={player.quality}
          onChange={player.changeQuality}
          compact
        />
        <VolumeControl value={player.volume} onChange={player.setVolume} />
      </div>
      {player.offline && (
        <p className="muted">Offline · playing available session audio</p>
      )}
    </div>
  );
}
