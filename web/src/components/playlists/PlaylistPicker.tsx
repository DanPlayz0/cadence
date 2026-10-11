// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronRight,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";
import {
  api,
  syncSession,
  type Playlist,
  type Track,
} from "../../services/api";
import { PlaylistIcon } from "./PlaylistIcon";
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";

export function PlaylistPicker({
  track,
  playlists,
  onCreate,
  onToggle,
}: {
  track: Track;
  playlists: Playlist[];
  onCreate: () => void;
  onToggle: (playlist: Playlist, added: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [membership, setMembership] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const saving = useRef(false);
  const generation = useRef(0);
  const trigger = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fitViewport = () => {
    const wrapper = content.current?.parentElement;
    if (!wrapper) return;
    // Radix shifts submenus vertically but cannot overlap the parent on narrow screens.
    wrapper.style.translate = "none";
    const bounds = wrapper.getBoundingClientRect();
    const shift = Math.max(
      8 - bounds.left,
      Math.min(0, window.innerWidth - 8 - bounds.right),
    );
    wrapper.style.translate = `${shift}px 0`;
  };
  useLayoutEffect(() => {
    if (!open) return;
    let frame = requestAnimationFrame(fitViewport);
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitViewport);
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [open, membership, error, query]);
  useEffect(() => {
    const revision = ++generation.current;
    const session = syncSession();
    let active = true;
    const valid = () =>
      active &&
      generation.current === revision &&
      syncSession().revision === session.revision;
    const invalidate = () => {
      active = false;
      generation.current++;
      setMembership(null);
      setOpen(false);
    };
    window.addEventListener("cadence-session", invalidate);
    setMembership(null);
    setQuery("");
    setError("");
    setConfirmation("");
    if (open) {
      void api<{ playlistIds: string[] }>(`/tracks/${track.id}/playlists`)
        .then((result) => {
          if (valid()) setMembership(new Set(result.playlistIds));
        })
        .catch((error) => {
          if (valid()) setError((error as Error).message);
        });
    }
    return () => {
      active = false;
      generation.current++;
      window.removeEventListener("cadence-session", invalidate);
    };
  }, [open, track.id, retry]);

  const filtered = playlists.filter((playlist) =>
    playlist.name
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger ref={trigger}>
        <Plus size={18} />
        Add to playlist
        <ChevronRight size={16} className="playlist-submenu-chevron" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        ref={content}
        className="song-action-menu playlist-submenu"
        aria-label={`Playlists for ${track.title}`}
        onKeyDown={(event) => {
          const fromSearch = event.target === search.current;
          if (
            event.key === "Tab" ||
            (fromSearch && ["ArrowDown", "ArrowUp"].includes(event.key))
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (!fromSearch) search.current?.focus();
            else {
              const items = content.current?.querySelectorAll<HTMLElement>(
                '[role^="menuitem"]:not([data-disabled])',
              );
              const last = event.key === "ArrowUp" || event.shiftKey;
              if (items?.length) items[last ? items.length - 1 : 0].focus();
            }
          }
        }}
        onFocusOutside={(event) => {
          // Radix focuses the parent content when the pointer leaves a trigger.
          // Keep the submenu available while the pointer crosses into it.
          if (
            event.target instanceof HTMLElement &&
            event.target.dataset.trackActions === track.id
          )
            event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <label
          className="picker-search"
          onKeyDown={(event) => {
            if (!["Escape", "ArrowDown", "ArrowUp", "Tab"].includes(event.key))
              event.stopPropagation();
          }}
        >
          <Search size={18} aria-hidden="true" />
          <Input
            ref={search}
            aria-label="Find a playlist"
            placeholder="Find a playlist"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!membership && !error && (
          <p role="status" className="muted">
            Loading playlist membership…
          </p>
        )}
        {membership &&
          filtered.map((playlist) => {
            const added = membership.has(playlist.id);
            return (
              <DropdownMenuCheckboxItem
                key={playlist.id}
                checked={added}
                disabled={pending !== null}
                aria-label={`${playlist.name}: ${added ? "Added" : "Not added"}`}
                onSelect={(event) => {
                  event.preventDefault();
                  if (saving.current) return;
                  saving.current = true;
                  const revision = generation.current;
                  const session = syncSession().revision;
                  const valid = () =>
                    revision === generation.current &&
                    session === syncSession().revision;
                  setPending(playlist.id);
                  setError("");
                  setConfirmation("");
                  void onToggle(playlist, !added)
                    .then(() => {
                      if (!valid()) return;
                      setMembership((current) => {
                        const next = new Set(current);
                        if (added) next.delete(playlist.id);
                        else next.add(playlist.id);
                        return next;
                      });
                      setConfirmation(
                        `${added ? "Removed from" : "Added to"} “${playlist.name}”.`,
                      );
                    })
                    .catch((error) => {
                      if (valid()) setError((error as Error).message);
                    })
                    .finally(() => {
                      saving.current = false;
                      setPending(null);
                    });
                }}
              >
                <PlaylistIcon name={playlist.icon} size={22} />
                <span className="playlist-submenu-name">{playlist.name}</span>
                {pending === playlist.id ? (
                  <LoaderCircle
                    size={18}
                    className="playlist-saving"
                    aria-hidden="true"
                  />
                ) : (
                  <Bookmark
                    size={18}
                    fill={added ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                )}
              </DropdownMenuCheckboxItem>
            );
          })}
        {membership && !filtered.length && (
          <p className="muted" role="status">
            {playlists.length
              ? "No matching playlists."
              : "Create your first playlist."}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!membership && error && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setRetry((value) => value + 1);
            }}
          >
            Retry loading playlists
          </DropdownMenuItem>
        )}
        <span className="sr-only" role="status" aria-atomic="true">
          {pending ? "Updating playlist…" : confirmation}
        </span>
        <DropdownMenuItem disabled={pending !== null} onSelect={onCreate}>
          <Plus size={18} />
          Create playlist
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
