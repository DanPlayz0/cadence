// SPDX-License-Identifier: GPL-2.0-or-later
import { Heart, ListMusic, MoreHorizontal, X, Pencil } from "lucide-react";
import { useState } from "react";
import type { Playlist, Track } from "../../services/api";
import { PlaylistPicker } from "../playlists/PlaylistPicker";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
export function TrackActions({
  track,
  liking,
  onLike,
  onQueue,
  onAdd,
  playlists,
  onPlaylistToggle,
  onRemove,
  onEdit,
  contextPosition,
  onContextClose,
}: {
  track: Track;
  liking: boolean;
  onLike: () => void;
  onQueue: () => void;
  onAdd: () => void;
  playlists: Playlist[];
  onPlaylistToggle: (playlist: Playlist, added: boolean) => Promise<void>;
  onRemove?: () => void;
  onEdit?: () => void;
  contextPosition?: { x: number; y: number };
  onContextClose?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="song-actions"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon"
        className={`song-like ${track.liked ? "enabled" : ""}`}
        aria-label={`${track.liked ? "Unlike" : "Like"} ${track.title}`}
        title={track.liked ? "Unlike" : "Like"}
        aria-pressed={track.liked}
        disabled={liking}
        onClick={onLike}
      >
        <Heart size={18} fill={track.liked ? "currentColor" : "none"} />
      </Button>
      <DropdownMenu
        modal={false}
        open={!!contextPosition || menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) onContextClose?.();
        }}
      >
        <DropdownMenuTrigger asChild>
          {contextPosition ? (
            <Button
              variant="ghost"
              aria-label={`Actions for ${track.title}`}
              style={{
                position: "fixed",
                left: contextPosition.x,
                top: contextPosition.y,
                width: 0,
                height: 0,
                padding: 0,
                border: 0,
              }}
            />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${track.title}`}
              title="Song actions"
            >
              <MoreHorizontal size={20} />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-track-actions={track.id}
          align={contextPosition ? "start" : "end"}
          onCloseAutoFocus={(event) => {
            if (contextPosition) event.preventDefault();
          }}
          className="song-action-menu"
          aria-label={`Actions for ${track.title}`}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <DropdownMenuItem disabled={liking} onSelect={onLike}>
            <Heart size={18} />
            {track.liked ? "Remove from liked songs" : "Like song"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onQueue}>
            <ListMusic size={18} />
            Add to queue
          </DropdownMenuItem>
          <PlaylistPicker
            track={track}
            playlists={playlists}
            onCreate={onAdd}
            onToggle={onPlaylistToggle}
          />
          {onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={18} />
              Edit metadata / artwork…
            </DropdownMenuItem>
          )}
          {onRemove && (
            <DropdownMenuItem onSelect={onRemove}>
              <X size={18} />
              Remove from playlist
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
