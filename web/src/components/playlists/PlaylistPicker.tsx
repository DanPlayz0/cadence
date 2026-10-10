// SPDX-License-Identifier: GPL-2.0-or-later
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
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
  const [busy, setBusy] = useState(false);
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
          Choose a playlist for “{track.title}”.
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
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  await onAdd(playlist);
                  onClose();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <PlaylistIcon name={playlist.icon} size={24} />
              <span>{playlist.name}</span>
              <Plus size={18} />
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
        {busy && <p role="status">Adding song…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="ghost"
          className="subtle"
          disabled={busy}
          onClick={onCreate}
        >
          <Plus size={18} />
          Create playlist
        </Button>
      </DialogContent>
    </Dialog>
  );
}
