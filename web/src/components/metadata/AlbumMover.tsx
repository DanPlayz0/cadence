// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { api, type Album, type Track } from "../../services/api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";

export function AlbumMover({
  track,
  onClose,
  onMoved,
}: {
  track: Track;
  onClose: () => void;
  onMoved: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [destination, setDestination] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setAlbums([]);
    setError("");
    const timer = setTimeout(() => {
      void api<Album[]>(
        `/albums?${new URLSearchParams({ q: query, limit: "100" })}`,
      )
        .then((items) => {
          if (live) setAlbums(items);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent busy={busy}>
        <DialogTitle>Move to album</DialogTitle>
        <DialogDescription>
          Choose an album for “{track.title}”. This immediately updates its
          album and album artist in the library. Your music file stays intact.
        </DialogDescription>
        <label>
          Search albums
          <input
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Album or artist"
          />
        </label>
        {loading && <p role="status">Loading albums…</p>}
        {!loading && !error && albums.length === 0 && (
          <p>No matching albums.</p>
        )}
        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          {albums.map((album) => (
            <Button
              key={album.id}
              type="button"
              variant={destination?.id === album.id ? "default" : "outline"}
              disabled={busy || album.id === track.albumId}
              aria-pressed={destination?.id === album.id}
              onClick={() => setDestination(album)}
              style={{
                width: "100%",
                marginBottom: 8,
                height: "auto",
                whiteSpace: "normal",
              }}
            >
              {album.title} · {album.artist} · {album.tracks} songs
              {album.id === track.albumId ? " (current album)" : ""}
            </Button>
          ))}
        </div>
        {albums.length === 100 && (
          <p className="muted">
            Showing 100 albums. Search to narrow the list.
          </p>
        )}
        {destination && (
          <p>
            Destination: {destination.title} · {destination.artist}
          </p>
        )}
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <div className="row">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !destination}
            onClick={async () => {
              if (!destination || busy) return;
              setBusy(true);
              setError("");
              try {
                await api(
                  `/admin/tracks/${encodeURIComponent(track.id)}/album`,
                  "PUT",
                  { albumId: destination.id },
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not move song.",
                );
                setBusy(false);
                return;
              }
              try {
                await onMoved();
              } catch (e) {
                setError(
                  `Song moved, but the library could not refresh. ${e instanceof Error ? e.message : "Reload the page to see the change."}`,
                );
                setBusy(false);
                return;
              } finally {
                setBusy(false);
              }
              onClose();
            }}
          >
            {busy ? "Moving…" : "Move song"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
