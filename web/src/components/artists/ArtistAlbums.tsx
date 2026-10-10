// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api, APIError, type Album } from "../../services/api";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/button";

export function ArtistAlbums({
  artist,
  onAlbum,
  onExpired,
  libraryId,
}: {
  libraryId: string;
  artist: string;
  onAlbum: (id: string) => void;
  onExpired: () => void;
}) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void api<Album[]>(
      `/albums?artist=${encodeURIComponent(artist)}&limit=24&offset=${offset}&libraryId=${encodeURIComponent(libraryId)}`,
    )
      .then((items) => {
        if (!live) return;
        setAlbums((previous) =>
          offset === 0 ? items : [...previous, ...items],
        );
        setMore(items.length === 24);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof APIError && e.status === 401) onExpired();
        else setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [artist, libraryId, offset, retry, onExpired]);
  return (
    <section
      className="artist-albums"
      aria-label="Albums on this server"
      aria-busy={loading}
    >
      <div className="section-heading">
        <h2>Albums on this server</h2>
      </div>
      <div className="album-grid">
        {albums.map((album) => (
          <button
            className="album-card"
            key={album.id}
            onClick={() => onAlbum(album.id)}
          >
            <div className="album-cover">
              <Artwork
                id={album.coverId}
                label={album.title}
                has={!!album.coverId}
              />
              <span className="album-play" aria-hidden="true">
                <ChevronRight size={20} />
              </span>
            </div>
            <strong>{album.title}</strong>
            <span>{album.artist}</span>
            <span>
              {album.tracks} {album.tracks === 1 ? "song" : "songs"}
            </span>
          </button>
        ))}
      </div>
      {loading && <p role="status">Loading albums…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
            Retry albums
          </Button>
        </p>
      )}
      {!loading && !error && albums.length === 0 && (
        <p>No albums available for this artist.</p>
      )}
      {!loading && !error && more && (
        <Button variant="outline" onClick={() => setOffset(albums.length)}>
          Show more albums
        </Button>
      )}
    </section>
  );
}
