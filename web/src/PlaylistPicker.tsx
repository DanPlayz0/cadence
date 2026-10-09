// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { Playlist, Track } from "./api";
import { PlaylistIcon } from "./PlaylistDialog";
import { useDialogDismiss } from "./useDialogDismiss";

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
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dismiss = useDialogDismiss(busy);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const filtered = playlists.filter((playlist) =>
    playlist.name
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase().trim()),
  );
  return (
    <dialog
      {...dismiss}
      ref={dialog}
      className="account-dialog playlist-picker"
      aria-labelledby="playlist-picker-title"
      aria-describedby="playlist-picker-song"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <div className="row dialog-heading">
        <h2 id="playlist-picker-title">Add to playlist</h2>
        <button
          aria-label="Close playlist picker"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <p id="playlist-picker-song" className="muted">
        Choose a playlist for “{track.title}”.
      </p>
      <label className="picker-search">
        <Search size={18} aria-hidden="true" />
        <input
          autoFocus
          aria-label="Find a playlist"
          placeholder="Find a playlist"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="playlist-options" aria-busy={busy}>
        {filtered.map((playlist) => (
          <button
            key={playlist.id}
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await onAdd(playlist);
                dialog.current?.close();
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
          </button>
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
      <button className="subtle" disabled={busy} onClick={onCreate}>
        <Plus size={18} />
        Create playlist
      </button>
    </dialog>
  );
}
