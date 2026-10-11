// SPDX-License-Identifier: GPL-2.0-or-later
import { useRef, useState } from "react";
import { Bookmark, Check, LoaderCircle, Plus, Search, X } from "lucide-react";
import type { Playlist, Track } from "../../services/api";
import { PlaylistIcon } from "./PlaylistDialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function PlaylistPicker({
  track,
  playlists,
  onClose,
  onCreate,
  onAdd,
}: {
  track: Track;
  playlists: Playlist[];
  onClose: () => void;
  onCreate: () => void;
  onAdd: (playlist: Playlist) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [pendingPlaylist, setPendingPlaylist] = useState<string | null>(null);
  const [addedPlaylists, setAddedPlaylists] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState("");
  const saving = useRef(false);
  const busy = pendingPlaylist !== null;
  const [error, setError] = useState("");

  const filtered = playlists.filter((playlist) =>
    playlist.name
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase().trim()),
  );
  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent busy={busy} className="playlist-picker">
        <div className="row dialog-heading">
          <DialogTitle>Add to playlist</DialogTitle>
          <Button
            variant="ghost"
            aria-label="Close playlist picker"
            disabled={busy}
            onClick={() => onClose()}
          >
            <X size={20} />
          </Button>
        </div>
        <DialogDescription className="muted">
          Save “{track.title}” to one or more playlists.
        </DialogDescription>
        <label className="picker-search">
          <Search size={18} aria-hidden="true" />
          <Input
            autoFocus
            aria-label="Find a playlist"
            placeholder="Find a playlist"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="playlist-options" aria-busy={busy}>
          {filtered.map((playlist) => (
            <Button
              variant="ghost"
              key={playlist.id}
              className={
                addedPlaylists.has(playlist.id) ? "playlist-added" : ""
              }
              disabled={busy || addedPlaylists.has(playlist.id)}
              aria-label={`${playlist.name}${addedPlaylists.has(playlist.id) ? ": Added" : ""}`}
              onClick={async () => {
                if (saving.current || addedPlaylists.has(playlist.id)) return;
                saving.current = true;
                setPendingPlaylist(playlist.id);
                setError("");
                setConfirmation("");
                try {
                  await onAdd(playlist);
                  setAddedPlaylists((current) =>
                    new Set(current).add(playlist.id),
                  );
                  setConfirmation(`Added to “${playlist.name}”.`);
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  saving.current = false;
                  setPendingPlaylist(null);
                }
              }}
            >
              <PlaylistIcon name={playlist.icon} size={24} />
              <span className="playlist-option-copy">
                <span>{playlist.name}</span>
                {addedPlaylists.has(playlist.id) && <small>Added</small>}
                {pendingPlaylist === playlist.id && <small>Adding…</small>}
              </span>
              {pendingPlaylist === playlist.id ? (
                <LoaderCircle
                  className="playlist-saving"
                  size={20}
                  aria-hidden="true"
                />
              ) : (
                <Bookmark
                  size={20}
                  fill={
                    addedPlaylists.has(playlist.id) ? "currentColor" : "none"
                  }
                  aria-hidden="true"
                />
              )}
            </Button>
          ))}
          {!filtered.length && (
            <p className="muted" role="status">
              {playlists.length
                ? "No matching playlists."
                : "Create your first playlist to start a mix."}
            </p>
          )}
        </div>
        <div className="playlist-save-status" role="status" aria-atomic="true">
          {busy
            ? "Adding song…"
            : confirmation && (
                <>
                  <Check size={18} aria-hidden="true" />
                  {confirmation}
                </>
              )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="row playlist-picker-footer">
          <Button
            variant="ghost"
            className="subtle"
            disabled={busy}
            onClick={onCreate}
          >
            <Plus size={18} />
            Create playlist
          </Button>
          <Button disabled={busy} onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
