// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { api, type Track, type Page } from "../../services/api";
import { BulkMetadataEditor } from "./BulkMetadataEditor";
import { LibraryMetadataBrowser } from "./LibraryMetadataBrowser";
import { MetadataChooser } from "./MetadataChooser";
import { AlbumMover } from "./AlbumMover";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";

const fields = {
  title: "Title",
  artist: "Artist / performer",
  album: "Album",
  featuredArtists: "Featured artists",
  videoGuests: "Music video guests",
  albumArtist: "Album artist",
  year: "Year",
  genre: "Genre",
  number: "Track number",
  disc: "Disc number",
} as const;
type Field = keyof typeof fields;
type Values = Record<Field, string>;
const fieldNames = Object.keys(fields) as Field[];
function values(track: Track): Values {
  return Object.fromEntries(
    fieldNames.map((field) => [field, String(track[field] ?? "")]),
  ) as Values;
}

export function TrackMetadataEditor({
  onSuggestions,
  revision,
  trackId,
  onClose,
}: {
  onSuggestions: () => Promise<void>;
  revision: number;
  trackId?: string;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState<Track | null>(null);
  const [draft, setDraft] = useState<Values | null>(null);
  const [baseline, setBaseline] = useState<Values | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"search" | "folders" | "attributes">(
    "folders",
  );
  const [selectedPath, setSelectedPath] = useState("");
  const [chooser, setChooser] = useState(false);
  const [movingAlbum, setMovingAlbum] = useState(false);
  const dirty =
    !!draft &&
    !!baseline &&
    fieldNames.some((field) => draft[field] !== baseline[field]);
  async function selectTrack(id: string, path = "") {
    if (busy || dirty) return;
    setBusy(true);
    setError("");
    setSearchError("");
    setNotice("");
    try {
      const current = await api<Track>(`/tracks/${encodeURIComponent(id)}`);
      setSelected(current);
      setSelectedPath(path);
      setDraft(values(current));
      setBaseline(values(current));
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "Could not load song metadata.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (trackId) void selectTrack(trackId);
  }, [trackId]);
  useEffect(() => {
    if (trackId || mode !== "search") return;
    let live = true;
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(() => {
      void api<Page>(
        `/tracks?${new URLSearchParams({ q: query, limit: String(limit), offset: "0" })}`,
      )
        .then((page) => {
          if (live) {
            setResults(page.items);
            setTotal(page.total);
          }
        })
        .catch((error) => {
          if (live) {
            setResults([]);
            setSearchError(error.message);
          }
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, limit, revision, mode]);
  async function restore(field: Field) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/admin/tracks/${encodeURIComponent(selected.id)}/overrides/${field}`,
        "DELETE",
      );
      const track = await api<Track>(
        `/tracks/${encodeURIComponent(selected.id)}`,
      );
      const value = values(track)[field];
      setDraft((current) => current && { ...current, [field]: value });
      setBaseline((current) => current && { ...current, [field]: value });
      setSelected(track);
      setNotice(`${fields[field]} restored from the extracted metadata.`);
      await onSuggestions();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not restore metadata.",
      );
    } finally {
      setBusy(false);
    }
  }
  const content = (
    <div className="panel metadata-editor">
      {!trackId && <h2>Edit song metadata</h2>}
      <p className="muted">
        {trackId
          ? "Save edits as suggestions, then choose metadata / artwork to review and apply them."
          : "Find a song in this instance’s library, then edit its metadata. Save changes as suggestions to review below; your music files stay intact."}
      </p>
      {!trackId && (
        <>
          <div className="row metadata-browse-modes">
            <Button
              variant="outline"
              aria-pressed={mode === "folders"}
              onClick={() => setMode("folders")}
            >
              Browse folders
            </Button>
            <Button
              variant="outline"
              aria-pressed={mode === "search"}
              onClick={() => setMode("search")}
            >
              Search songs
            </Button>
            <Button
              variant="outline"
              aria-pressed={mode === "attributes"}
              disabled={busy || dirty}
              onClick={() => setMode("attributes")}
            >
              Attribute filter / bulk edit
            </Button>
          </div>
          {dirty && (
            <p role="status">
              Save or discard your edits before selecting another song.{" "}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDraft(baseline)}
              >
                Discard unsaved edits
              </Button>
            </p>
          )}
          {mode === "attributes" ? (
            <BulkMetadataEditor
              onSuggestions={onSuggestions}
              revision={revision}
              disabled={busy || dirty}
            />
          ) : mode === "folders" ? (
            <LibraryMetadataBrowser
              onSelect={(id, path) => void selectTrack(id, path)}
              busy={busy || dirty}
              revision={revision}
            />
          ) : (
            <>
              <label className="metadata-search">
                Search library
                <input
                  type="search"
                  value={query}
                  placeholder="Song title, artist, or album"
                  disabled={busy}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(20);
                  }}
                />
              </label>
              {searchError && (
                <p role="alert" className="auth-error">
                  {searchError}
                </p>
              )}
              <div
                className="metadata-results"
                aria-label="Library search results"
                aria-busy={searching}
              >
                {searching ? (
                  <p role="status">Searching library…</p>
                ) : (
                  results.map((track) => (
                    <button
                      type="button"
                      key={track.id}
                      disabled={busy || dirty}
                      aria-pressed={selected?.id === track.id}
                      onClick={() => void selectTrack(track.id)}
                    >
                      <strong>{track.title}</strong>
                      <span>
                        {track.artist} · {track.album || "Single"}
                      </span>
                    </button>
                  ))
                )}
                {!searching && !searchError && !results.length && (
                  <p>No songs found. Try another title or artist.</p>
                )}
              </div>
              {!searching && results.length < total && limit < 500 && (
                <button
                  type="button"
                  className="subtle"
                  disabled={busy}
                  onClick={() =>
                    setLimit((current) => Math.min(current + 20, 500))
                  }
                >
                  Show more songs ({results.length} of {total})
                </button>
              )}
              {!searching && limit >= 500 && results.length < total && (
                <p className="muted">
                  Refine your search to find a song beyond these 500 results.
                </p>
              )}
            </>
          )}
          {mode === "folders" && searchError && (
            <p role="alert" className="auth-error">
              {searchError}
            </p>
          )}
        </>
      )}
      {trackId && searchError && (
        <p role="alert" className="auth-error">
          {searchError}
        </p>
      )}
      {trackId && busy && !selected && <p role="status">Loading metadata…</p>}
      {(trackId || mode !== "attributes") && selected && draft && baseline && (
        <form
          className="admin-form metadata-form"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            setNotice("");
            let saved = 0;
            try {
              for (const field of fieldNames) {
                if (draft[field] === baseline[field]) continue;
                await api("/admin/suggestions", "POST", {
                  trackId: selected.id,
                  field,
                  value: draft[field],
                });
                setBaseline(
                  (current) => current && { ...current, [field]: draft[field] },
                );
                saved++;
              }
              setNotice(
                `${saved} ${saved === 1 ? "change" : "changes"} saved for review below.`,
              );
            } catch (error) {
              setError(
                `${saved ? `${saved} changes saved. ` : ""}${error instanceof Error ? error.message : "Could not save changes."} Your unsaved edits are kept; retry to save the rest.`,
              );
            } finally {
              setBusy(false);
              await onSuggestions();
            }
          }}
        >
          <div className="wide metadata-selection">
            <strong>{selected.title}</strong>
            <span>{selected.artist}</span>
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty}
              onClick={() => setMovingAlbum(true)}
            >
              Move to album…
            </Button>
            {selectedPath && (
              <span className="metadata-file-path">{selectedPath}</span>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty}
              onClick={() => setChooser(true)}
            >
              Choose metadata / artwork
            </Button>
          </div>
          {fieldNames.map((field) => (
            <div className="metadata-field" key={field}>
              <label>
                {fields[field]}
                <input
                  value={draft[field]}
                  placeholder={
                    field === "album" ? "No album — Single" : undefined
                  }
                  disabled={busy}
                  required={
                    field === "title" ||
                    field === "artist" ||
                    field === "number" ||
                    field === "disc"
                  }
                  type={
                    field === "number" || field === "disc" ? "number" : "text"
                  }
                  min={0}
                  max={9999}
                  step={1}
                  maxLength={500}
                  onChange={(event) =>
                    setDraft({ ...draft, [field]: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="metadata-restore"
                disabled={busy}
                onClick={() => void restore(field)}
              >
                Restore extracted {fields[field].toLowerCase()}
              </button>
            </div>
          ))}
          <p className="wide muted">
            Use Artist for primary performers. Separate names with commas. Music
            video guests are appearance credits. Duration, codec, and file
            details come from the audio; artwork suggestions are reviewed
            separately.
          </p>
          {error && (
            <p className="wide auth-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="wide" role="status">
              {notice}
            </p>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              !fieldNames.some((field) => draft[field] !== baseline[field])
            }
          >
            {busy ? "Saving…" : "Save suggestions"}
          </button>
        </form>
      )}
      {chooser && selected && (
        <MetadataChooser
          trackId={selected.id}
          onClose={() => setChooser(false)}
          onApplied={async () => {
            await selectTrack(selected.id, selectedPath);
            await onSuggestions();
          }}
        />
      )}
      {movingAlbum && selected && (
        <AlbumMover
          track={selected}
          onClose={() => setMovingAlbum(false)}
          onMoved={async () => {
            await selectTrack(selected.id, selectedPath);
            await onSuggestions();
          }}
        />
      )}
    </div>
  );
  if (!trackId) return content;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !dirty) onClose?.();
      }}
    >
      <DialogContent className="metadata-chooser" busy={busy || dirty}>
        <div className="row dialog-heading">
          <DialogTitle>
            Edit song{selected ? ` — ${selected.title}` : ""}
          </DialogTitle>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {dirty ? "Discard edits and close" : "Close"}
          </Button>
        </div>
        <DialogDescription>
          Edit album, artist, and other metadata, or choose suggested artwork.
        </DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  );
}
