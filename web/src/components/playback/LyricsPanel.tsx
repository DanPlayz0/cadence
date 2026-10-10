// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useMemo, useRef, useState } from "react";
import { api, APIError, type Track } from "../../services/api";
import { activeLyric, parseLRC, type Lyrics } from "../../lib/lyrics";
import { ArtistLinks } from "../artists/ArtistLinks";

export function LyricsPanel({
  track,
  position,
  onSeek,
  onExpired,
  onArtist,
}: {
  track?: Track;
  position: number;
  onSeek: (time: number) => void;
  onExpired: () => void;
  onArtist: (name: string) => void;
}) {
  const [data, setData] = useState<{ id: string; lyrics: Lyrics } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [follow, setFollow] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLButtonElement>(null);
  const id = track?.id;
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    setFollow(true);
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void api<Lyrics>(`/tracks/${encodeURIComponent(id)}/lyrics`)
      .then((lyrics) => {
        if (live) setData({ id, lyrics });
      })
      .catch((error) => {
        if (live) {
          if (error instanceof APIError && error.status === 401) onExpired();
          else setError(error.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, retry, onExpired]);
  const lyrics = data && data.id === id ? data.lyrics : null;
  const lines = useMemo(
    () => parseLRC(lyrics?.syncedLyrics || ""),
    [lyrics?.syncedLyrics],
  );
  const index = activeLyric(lines, position);
  useEffect(() => {
    if (!follow || !active.current || !viewport.current) return;
    const node = active.current,
      container = viewport.current;
    const center = () =>
      container.scrollTo({
        top: Math.max(
          0,
          node.offsetTop - container.clientHeight / 2 + node.offsetHeight / 2,
        ),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    center();
    const observer = new ResizeObserver(center);
    observer.observe(container);
    return () => observer.disconnect();
  }, [index, follow, lines]);
  if (!track) return <p className="muted">Play a song to see its lyrics.</p>;
  return (
    <div className="lyrics-panel">
      <div className="lyrics-heading">
        <strong>{track.title}</strong>
        <ArtistLinks credit={track.artist} onNavigate={onArtist} />
      </div>
      <p className="lyrics-source">
        Lyrics from{" "}
        <a href="https://lrclib.net/" target="_blank" rel="noreferrer">
          LRCLIB
        </a>
      </p>
      {loading && <p role="status">Finding lyrics…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button
            className="subtle"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {lyrics &&
        (!lyrics.found ? (
          <p className="muted">No lyrics found for this recording.</p>
        ) : lyrics.instrumental ? (
          <p className="muted">Instrumental · no lyrics.</p>
        ) : (
          <>
            <div className="row lyrics-tools">
              <span>
                {lines.length
                  ? "Live lyrics"
                  : "Plain lyrics · no timings available"}
              </span>
              {lines.length > 0 && (
                <button
                  className="subtle"
                  aria-pressed={follow}
                  onClick={() => setFollow((value) => !value)}
                >
                  {follow ? "Following playback" : "Follow playback"}
                </button>
              )}
            </div>
            <div
              className="lyrics-scroll"
              ref={viewport}
              tabIndex={0}
              aria-label="Song lyrics"
              onWheel={() => setFollow(false)}
              onTouchStart={() => setFollow(false)}
              onKeyDown={(event) => {
                if (
                  [
                    "ArrowDown",
                    "ArrowUp",
                    "PageDown",
                    "PageUp",
                    "Home",
                    "End",
                  ].includes(event.key)
                )
                  setFollow(false);
              }}
            >
              {lines.length ? (
                lines.map((line, i) => (
                  <button
                    key={`${line.time}:${i}`}
                    ref={i === index ? active : undefined}
                    className={
                      index >= 0 && line.time === lines[index].time
                        ? "lyric-line active"
                        : "lyric-line"
                    }
                    aria-current={
                      index >= 0 && line.time === lines[index].time
                        ? "true"
                        : undefined
                    }
                    onClick={() => {
                      onSeek(line.time);
                      setFollow(true);
                    }}
                    title="Seek to this line"
                  >
                    {line.text || "♪"}
                  </button>
                ))
              ) : (
                <p className="plain-lyrics">
                  {lyrics.plainLyrics || "No readable lyrics available."}
                </p>
              )}
            </div>
          </>
        ))}
    </div>
  );
}
