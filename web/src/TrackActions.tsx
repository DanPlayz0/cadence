// SPDX-License-Identifier: GPL-2.0-or-later
import { Heart, ListMusic, MoreHorizontal, Plus, X } from "lucide-react";
import type { Track } from "./api";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/ui/dropdown-menu";
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
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${track.title}`}
            title="Song actions"
          >
            <MoreHorizontal size={20} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
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
          <DropdownMenuItem onSelect={onAdd}>
            <Plus size={18} />
            Add to playlist…
          </DropdownMenuItem>
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
