// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, ListMusic, MoreHorizontal, Plus, X } from "lucide-react";
import type { Track } from "./api";
import { usePopoverDismiss } from "./usePopoverDismiss";

export function TrackActions({
  track,
  liking,
  onLike,
  onQueue,
  onAdd,
  onRemove,
}: {
  track: Track;
  liking: boolean;
  onLike: () => void;
  onQueue: () => void;
  onAdd: () => void;
  onRemove?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  usePopoverDismiss(!!position, root, () => setPosition(null), menu);
  useEffect(() => {
    if (!position) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const close = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setPosition(null);
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [position]);
  function choose(action: () => void) {
    setPosition(null);
    trigger.current?.focus();
    action();
  }
  return (
    <div
      className="song-actions"
      ref={root}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        className={`song-like ${track.liked ? "enabled" : ""}`}
        aria-label={`${track.liked ? "Unlike" : "Like"} ${track.title}`}
        title={track.liked ? "Unlike" : "Like"}
        aria-pressed={track.liked}
        disabled={liking}
        onClick={onLike}
      >
        <Heart size={18} fill={track.liked ? "currentColor" : "none"} />
      </button>
      <button
        ref={trigger}
        aria-label={`Actions for ${track.title}`}
        title="Song actions"
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => {
          if (position) {
            setPosition(null);
            return;
          }
          const rect = trigger.current!.getBoundingClientRect();
          const height = onRemove ? 192 : 148;
          setPosition({
            left: Math.max(8, Math.min(rect.right - 240, innerWidth - 248)),
            top:
              rect.bottom + height + 8 < innerHeight
                ? rect.bottom + 4
                : Math.max(8, rect.top - height - 4),
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!position) trigger.current?.click();
          }
          if (event.key === "Escape") {
            setPosition(null);
            event.stopPropagation();
          }
        }}
      >
        <MoreHorizontal size={20} />
      </button>
      {position &&
        createPortal(
          <div
            id={id}
            ref={menu}
            className="song-action-menu"
            role="menu"
            aria-label={`Actions for ${track.title}`}
            style={position}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              const buttons = Array.from(
                menu.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "ArrowDown"
                  ? (index + 1) % buttons.length
                  : event.key === "ArrowUp"
                    ? (index + buttons.length - 1) % buttons.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                buttons[next].focus();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPosition(null);
                trigger.current?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              disabled={liking}
              onClick={() => choose(onLike)}
            >
              <Heart size={18} />
              {track.liked ? "Remove from liked songs" : "Like song"}
            </button>
            <button role="menuitem" onClick={() => choose(onQueue)}>
              <ListMusic size={18} />
              Add to queue
            </button>
            <button role="menuitem" onClick={() => choose(onAdd)}>
              <Plus size={18} />
              Add to playlist…
            </button>
            {onRemove && (
              <button role="menuitem" onClick={() => choose(onRemove)}>
                <X size={18} />
                Remove from playlist
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
