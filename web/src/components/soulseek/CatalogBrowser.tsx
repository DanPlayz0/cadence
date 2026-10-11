// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { Disc3, Music2, Users, Search, ArrowLeft } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { api } from "../../services/api";
import type {
  CatalogItem,
  CatalogPage,
  FindNavigation,
} from "../../lib/findMusic";

export function CatalogBrowser({
  nav,
  change,
  findDownloads,
}: {
  nav: FindNavigation;
  change: (patch: Partial<FindNavigation>, replace?: boolean) => void;
  findDownloads: (item: CatalogItem) => void;
}) {
  const searchURL = (type = nav.type, offset = 0) =>
    `/catalog/search?${new URLSearchParams({ type, q: nav.catalogQuery.trim(), limit: "25", offset: String(offset) })}`;
  const artistURL = (item: CatalogItem, offset = 0) =>
    `/catalog/artists/${item.id}/albums?limit=25&offset=${offset}`;
  const [url, setURL] = useState(() =>
    nav.artist
      ? artistURL(nav.artist)
      : nav.catalogQuery.trim().length >= 3
        ? searchURL()
        : "",
  );
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [overview, setOverview] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setURL(
      nav.artist
        ? artistURL(nav.artist)
        : nav.catalogQuery.trim().length >= 3
          ? searchURL()
          : "",
    );
  }, [nav.artist?.id, nav.type]);
  useEffect(() => {
    if (!url || nav.selection) return;
    let live = true;
    setBusy(true);
    setError("");
    setPage(null);
    void api<CatalogPage>(url)
      .then((v) => {
        if (live) setPage(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [url, retry, nav.selection?.id]);
  useEffect(() => {
    setOverview(null);
    if (!nav.selection) return;
    if (nav.selection.kind !== "album") {
      setBusy(false);
      setError("");
      return;
    }
    let live = true;
    setBusy(true);
    setError("");
    void api<CatalogItem>(`/catalog/albums/${nav.selection.id}`)
      .then((v) => {
        if (live) setOverview(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [nav.selection?.id, retry]);
  const item = overview || nav.selection;
  return (
    <div className="find-catalog">
      <div
        className="find-type-tabs"
        role="group"
        aria-label="Catalog search type"
      >
        {(
          [
            ["album", "Albums", Disc3],
            ["artist", "Artists", Users],
            ["song", "Songs", Music2],
          ] as const
        ).map(([type, label, Icon]) => (
          <Button
            key={type}
            variant="ghost"
            aria-pressed={nav.type === type}
            onClick={() => {
              change({ type, artist: undefined, selection: undefined }, false);
              setURL(
                nav.catalogQuery.trim().length >= 3 ? searchURL(type) : "",
              );
            }}
          >
            <Icon size={16} />
            {label}
          </Button>
        ))}
      </div>
      <Form
        className="find-search"
        onSubmit={(e) => {
          e.preventDefault();
          change({ artist: undefined, selection: undefined }, false);
          setURL(searchURL());
          setRetry((v) => v + 1);
        }}
      >
        <label className="sr-only" htmlFor="find-query">
          Search catalog
        </label>
        <Search size={20} aria-hidden="true" />
        <Input
          id="find-query"
          value={nav.catalogQuery}
          placeholder={`Search ${nav.type === "artist" ? "artists" : nav.type === "song" ? "songs and artists" : "albums and artists"}`}
          maxLength={200}
          onChange={(e) => change({ catalogQuery: e.target.value })}
        />
        <Button disabled={nav.catalogQuery.trim().length < 3}>
          Search catalog
        </Button>
      </Form>
      {error && (
        <div className="find-error" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
            Retry catalog lookup
          </Button>
        </div>
      )}
      {busy && <p role="status">Looking up music…</p>}
      {item ? (
        <section className="find-overview" aria-label="Catalog selection">
          <Button
            variant="ghost"
            onClick={() => change({ selection: undefined }, false)}
          >
            <ArrowLeft size={16} />
            Back to results
          </Button>
          <div className="find-overview-body">
            <div className="find-art" aria-hidden="true">
              <Disc3 size={56} />
            </div>
            <div>
              <p className="eyebrow">
                {item.kind === "song" ? "SONG" : "ALBUM"} · MUSICBRAINZ
              </p>
              <h2>{item.name}</h2>
              <p>{item.artist}</p>
              <p>
                {[item.date?.slice(0, 4), item.releaseType, item.disambiguation]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Button onClick={() => findDownloads(item)}>
                <Search size={16} />
                Find downloads
              </Button>
            </div>
          </div>
          <p className="soulseek-help">
            Catalog information identifies the music. Source folders may contain
            different editions or only some tracks.
          </p>
        </section>
      ) : (
        <>
          {nav.artist && (
            <div className="soulseek-row">
              <h2>Albums by {nav.artist.name}</h2>
              <Button
                variant="ghost"
                onClick={() => {
                  change({ artist: undefined }, false);
                  setURL(searchURL("artist"));
                }}
              >
                Back to artists
              </Button>
            </div>
          )}
          {!url && (
            <div className="find-empty">
              <Disc3 size={40} />
              <h2>Find your next record</h2>
              <p>
                Look up an album, explore an artist’s releases, or find a song.
                Choose the right music before comparing download sources.
              </p>
            </div>
          )}
          {page && (
            <>
              <p className="soulseek-help">
                {page.total} catalog matches · MusicBrainz
              </p>
              <div className="find-catalog-grid">
                {page.items.map((v) => (
                  <Button
                    variant="ghost"
                    className="find-catalog-card"
                    key={v.id}
                    onClick={() => {
                      setError("");
                      change(
                        v.kind === "artist" ? { artist: v } : { selection: v },
                        false,
                      );
                    }}
                  >
                    <span className="find-art" aria-hidden="true">
                      {v.kind === "artist" ? (
                        <Users size={30} />
                      ) : v.kind === "song" ? (
                        <Music2 size={30} />
                      ) : (
                        <Disc3 size={30} />
                      )}
                    </span>
                    <span>
                      <strong>{v.name}</strong>
                      <span>
                        {v.artist ||
                          (v.kind === "artist"
                            ? "Explore releases"
                            : "Unknown artist")}
                      </span>
                      <small>
                        {[v.date?.slice(0, 4), v.releaseType, v.disambiguation]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </Button>
                ))}
              </div>
              {!page.items.length && (
                <p>
                  No catalog matches. Try another title or use Direct search for
                  filenames.
                </p>
              )}
              <div className="soulseek-actions">
                <Button
                  variant="ghost"
                  disabled={busy || !page.offset}
                  onClick={() =>
                    setURL(
                      nav.artist
                        ? artistURL(nav.artist, Math.max(0, page.offset - 25))
                        : searchURL(nav.type, Math.max(0, page.offset - 25)),
                    )
                  }
                >
                  Previous catalog results
                </Button>
                <span>Page {Math.floor(page.offset / 25) + 1}</span>
                <Button
                  variant="ghost"
                  disabled={
                    busy || page.offset + page.items.length >= page.total
                  }
                  onClick={() =>
                    setURL(
                      nav.artist
                        ? artistURL(nav.artist, page.offset + 25)
                        : searchURL(nav.type, page.offset + 25),
                    )
                  }
                >
                  Next catalog results
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
