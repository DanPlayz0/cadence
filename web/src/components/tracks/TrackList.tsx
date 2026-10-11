// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Clock, Play } from "lucide-react";
import { duration, type Track } from "../../services/api";
import { Artwork } from "../ui/Artwork";
import { ArtistLinks } from "../artists/ArtistLinks";
import { TrackActions } from "./TrackActions";

export function TrackList({
  collectionKey,
  tracks,
  libraryId,
  currentId,
  playing,
  cached,
  liking,
  onPlay,
  onArtist,
  onLike,
  onQueue,
  onAdd,
  onRemove,
  onEdit,
}: {
  collectionKey?: string;
  tracks: Track[];
  libraryId?: string;
  currentId?: string;
  playing: boolean;
  cached: (id: string) => boolean;
  liking: Set<string>;
  onPlay: (i: number) => void;
  onArtist: (name: string) => void;
  onLike: (t: Track) => void;
  onQueue: (t: Track) => void;
  onAdd: (t: Track) => void;
  onRemove?: (t: Track) => void;
  onEdit?: (t: Track) => void;
}) {
  const [context, setContext] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [scroll, setScroll] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver((v) => setHeight(v[0].contentRect.height));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScroll(0);
  }, [collectionKey]);
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
        tabIndex={0}
        role="region"
        aria-label="Songs. Scroll for more songs."
        ref={ref}
        onScroll={(e) => {
          setScroll(e.currentTarget.scrollTop);
          setContext(null);
        }}
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
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContext({ id: t.id, x: event.clientX, y: event.clientY });
                }}
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
                  <Artwork
                    id={t.id}
                    label={t.album || t.title}
                    has={t.artwork}
                  />
                  <div>
                    <button onClick={() => onPlay(i)}>{t.title}</button>
                    <span>
                      <ArtistLinks
                        libraryId={libraryId}
                        credit={t.artist}
                        featuredArtists={t.featuredArtists}
                        videoGuests={t.videoGuests}
                        onNavigate={onArtist}
                        single={!t.album}
                      />
                      {cached(t.id) && <Check size={12} className="cached" />}
                    </span>
                  </div>
                </div>
                <span className="track-album">{t.album || "Single"}</span>
                <span className="track-duration">{duration(t.duration)}</span>
                <TrackActions
                  contextPosition={context?.id === t.id ? context : undefined}
                  onContextClose={() => setContext(null)}
                  onEdit={onEdit ? () => onEdit(t) : undefined}
                  track={t}
                  liking={liking.has(t.id)}
                  onLike={() => onLike(t)}
                  onQueue={() => onQueue(t)}
                  onAdd={() => onAdd(t)}
                  onRemove={onRemove ? () => onRemove(t) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
