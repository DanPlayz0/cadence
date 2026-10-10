// SPDX-License-Identifier: GPL-2.0-or-later
import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Disc3,
  GripVertical,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { cover } from "./api";
import { ArtistLinks } from "./ArtistLinks";
import { routeURL, type Route } from "./navigation";
import type { usePlayer } from "./player";
import type { PlaybackSource, QueueEntry, QueueSection } from "./queue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";

type Player = ReturnType<typeof usePlayer>;
function SourceLink({
  source,
  onNavigate,
}: {
  source: PlaybackSource;
  onNavigate: (route: Route) => void;
}) {
  return (
    <a
      className="queue-source-link"
      href={routeURL(source.route)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onNavigate(source.route);
      }}
    >
      {source.name}
    </a>
  );
}
function Credit({
  entry,
  onArtist,
}: {
  entry: QueueEntry;
  onArtist: (name: string) => void;
}) {
  return (
    <ArtistLinks
      credit={entry.track.artist}
      featuredArtists={entry.track.featuredArtists}
      videoGuests={entry.track.videoGuests}
      onNavigate={onArtist}
      single={!entry.track.album}
    />
  );
}
export function QueuePanel({
  player,
  onArtist,
  onNavigate,
  onAdded,
}: {
  player: Player;
  onArtist: (name: string) => void;
  onNavigate: (route: Route) => void;
  onAdded: (title: string) => void;
}) {
  const drag = useRef<{ section: QueueSection; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [failedCover, setFailedCover] = useState("");
  const q = player.queue;
  const add = (entry: QueueEntry) => {
    player.enqueue(entry.track);
    onAdded(entry.track.title);
  };
  function section(key: QueueSection, heading: string) {
    const entries = q[key];
    if (!entries.length) return null;
    return (
      <section
        className="queue-section"
        aria-label={heading + (key === "remaining" ? q.source?.name || "" : "")}
      >
        <h3>
          {heading}
          {key === "remaining" && q.source && (
            <SourceLink source={q.source} onNavigate={onNavigate} />
          )}
        </h3>
        <ol className="queue-entries">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className={`queue-track ${dropTarget === entry.id ? "queue-drop-target" : ""}`}
              onDragOver={(event) => {
                if (drag.current?.section !== key) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(entry.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (drag.current?.section === key) {
                  player.reorder(key, drag.current.id, entry.id);
                  setAnnouncement(
                    `Moved song to position ${index + 1} in ${heading}.`,
                  );
                }
                drag.current = null;
                setDropTarget("");
              }}
            >
              <span
                className="queue-drag-handle"
                draggable
                title={`Drag ${entry.track.title} to reorder`}
                aria-hidden="true"
                onDragStart={(event) => {
                  drag.current = { section: key, id: entry.id };
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", entry.id);
                }}
                onDragEnd={() => {
                  drag.current = null;
                  setDropTarget("");
                }}
              >
                <GripVertical size={14} />
              </span>
              <div className="queue-credit">
                <button
                  className="queue-title"
                  title={`Play ${entry.track.title} and skip earlier songs`}
                  onClick={() => player.jump(key, entry.id)}
                >
                  {entry.track.title}
                </button>
                <Credit entry={entry} onArtist={onArtist} />
              </div>
              <button
                aria-label={`Move ${entry.track.title} up`}
                disabled={index === 0}
                onClick={() => {
                  player.move(key, entry.id, -1);
                  setAnnouncement(
                    `Moved ${entry.track.title} to position ${index} in ${heading}.`,
                  );
                }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                aria-label={`Move ${entry.track.title} down`}
                disabled={index === entries.length - 1}
                onClick={() => {
                  player.move(key, entry.id, 1);
                  setAnnouncement(
                    `Moved ${entry.track.title} to position ${index + 2} in ${heading}.`,
                  );
                }}
              >
                <ArrowDown size={14} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label={`Queue options for ${entry.track.title}`}>
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => player.jump(key, entry.id)}>
                    Play now and skip earlier songs
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => player.jump(key, entry.id, true)}
                  >
                    Play now and keep earlier songs
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => player.remove(key, entry.id)}
                  >
                    Remove from queue
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                aria-label={`Remove ${entry.track.title} from queue`}
                onClick={() => player.remove(key, entry.id)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <div className="playback-queue">
      <section className="queue-now" aria-label="Now playing">
        <h3>
          Now playing{" "}
          <span>
            {q.current ? (player.playing ? "Playing" : "Paused") : ""}
          </span>
        </h3>
        {q.current ? (
          <>
            <div className="queue-now-card">
              <div className="queue-now-art">
                {q.current.track.artwork &&
                failedCover !== q.current.track.id ? (
                  <img
                    src={cover(q.current.track.id)}
                    alt=""
                    onError={() => setFailedCover(q.current!.track.id)}
                  />
                ) : (
                  <Disc3 size={30} />
                )}
              </div>
              <div className="queue-credit">
                <strong title={q.current.track.title}>
                  {q.current.track.title}
                </strong>
                <Credit entry={q.current} onArtist={onArtist} />
              </div>
            </div>
            {q.current.source && (
              <p className="queue-source">
                Playing from{" "}
                <SourceLink source={q.current.source} onNavigate={onNavigate} />
              </p>
            )}
          </>
        ) : (
          <p className="muted">Choose a song to start listening.</p>
        )}
      </section>
      {section("forward", "Returning next")}
      {section("manual", "Next in queue")}
      {section("remaining", q.source ? "Loaded songs from " : "Upcoming songs")}
      {!q.forward.length && !q.manual.length && !q.remaining.length && (
        <p className="muted queue-empty">
          {player.repeat === "all" && q.cycle.length
            ? "The loaded source will repeat after this song."
            : "No upcoming songs. Add a song to the queue."}
        </p>
      )}
      <details className="queue-history">
        <summary>
          Previously played <span>{q.history.length}</span>
        </summary>
        {q.history.length ? (
          <ol className="queue-entries">
            {[...q.history].reverse().map((entry, index) => (
              <li className="queue-track" key={`${entry.id}:${index}`}>
                <div className="queue-credit">
                  <span
                    className="queue-history-title"
                    title={entry.track.title}
                  >
                    {entry.track.title}
                  </span>
                  <Credit entry={entry} onArtist={onArtist} />
                </div>
                <button
                  aria-label={`Add ${entry.track.title} to queue`}
                  title="Add to queue"
                  onClick={() => add(entry)}
                >
                  <Plus size={16} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            Your listening history will appear here during this session.
          </p>
        )}
      </details>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
