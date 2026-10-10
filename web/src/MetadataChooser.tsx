// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { api, cover, type Track } from "./api";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";

export type Suggestion = {
  id: string;
  trackId: string;
  field: string;
  value: string;
  source: string;
  title: string;
  current: string;
};
export const metadataFields: Record<string, string> = {
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
  artwork: "Artwork",
};
export function MetadataChooser({
  trackId,
  onClose,
  onApplied,
}: {
  trackId: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [track, setTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void Promise.all([
      api<Suggestion[]>(
        `/admin/tracks/${encodeURIComponent(trackId)}/suggestions`,
      ),
      api<Track>(`/tracks/${encodeURIComponent(trackId)}`),
    ])
      .then(([items, current]) => {
        if (live) {
          setSuggestions(items);
          setTrack(current);
          setChoices({});
          setEdits({});
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [trackId, revision]);
  const grouped = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions)
    grouped.set(suggestion.field, [
      ...(grouped.get(suggestion.field) || []),
      suggestion,
    ]);
  const selected = Object.values(choices).filter(Boolean);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      await api(
        `/admin/tracks/${encodeURIComponent(trackId)}/metadata`,
        "POST",
        {
          choices: selected.map((id) => {
            const s = suggestions.find((s) => s.id === id)!;
            return {
              id,
              current: s.current,
              ...(s.field !== "artwork" && edits[id] !== undefined
                ? { value: edits[id] }
                : {}),
            };
          }),
        },
      );
      await onApplied();
      onClose();
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "Could not apply metadata."} Your selections are kept. If another reviewer changed this song, reload its suggestions.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="metadata-chooser" busy={busy}>
        <DialogTitle>
          Choose metadata{track ? ` — ${track.title}` : ""}
        </DialogTitle>
        <DialogDescription>
          Compare each field, choose a source, and edit its proposed value if
          needed. Only selected replacements are applied. Other candidates for
          those fields are dismissed; fields you keep remain pending.
        </DialogDescription>
        {loading ? (
          <p role="status">Loading metadata…</p>
        ) : (
          <>
            <div className="row chooser-tools">
              <Button
                variant="outline"
                disabled={busy || !suggestions.length}
                onClick={() =>
                  setChoices(
                    Object.fromEntries(
                      [...grouped].map(([field, items]) => [
                        field,
                        items[0].id,
                      ]),
                    ),
                  )
                }
              >
                Select proposed values
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setChoices({})}
              >
                Keep all current values
              </Button>
            </div>
            {[...grouped].map(([field, items]) => {
              const id = choices[field] || "",
                candidate = items.find((item) => item.id === id),
                current = items[0].current;
              return (
                <fieldset
                  className="metadata-comparison"
                  key={field}
                  disabled={busy}
                >
                  <legend>{metadataFields[field] || field}</legend>
                  <div className="comparison-columns">
                    <label
                      className={
                        !id ? "comparison-value chosen" : "comparison-value"
                      }
                    >
                      <span>
                        <input
                          type="radio"
                          name={`choice-${field}`}
                          checked={!id}
                          onChange={() =>
                            setChoices({ ...choices, [field]: "" })
                          }
                        />{" "}
                        Keep current
                      </span>
                      {field === "artwork" ? (
                        track?.artwork ? (
                          <img
                            className="suggestion-art"
                            src={cover(trackId)}
                            alt="Current artwork"
                          />
                        ) : (
                          <span>No artwork</span>
                        )
                      ) : (
                        <span className="comparison-text">
                          {current || "(empty)"}
                        </span>
                      )}
                    </label>
                    <div
                      className={
                        id ? "comparison-value chosen" : "comparison-value"
                      }
                    >
                      <label>
                        <input
                          type="radio"
                          name={`choice-${field}`}
                          checked={!!id}
                          onChange={() =>
                            setChoices({ ...choices, [field]: items[0].id })
                          }
                        />{" "}
                        Replace with
                      </label>
                      <label className="comparison-source">
                        Source for {metadataFields[field] || field}
                        <select
                          aria-label={`Source for ${metadataFields[field] || field}`}
                          value={id}
                          onChange={(e) =>
                            setChoices({ ...choices, [field]: e.target.value })
                          }
                        >
                          <option value="">Choose a suggestion</option>
                          {items.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.source} ·{" "}
                              {field === "artwork"
                                ? "Artwork"
                                : s.value || "(empty)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      {candidate &&
                        (field === "artwork" ? (
                          <img
                            className="suggestion-art"
                            src={`/api/v1/admin/suggestions/${candidate.id}/art`}
                            alt="Proposed artwork"
                          />
                        ) : (
                          <Input
                            aria-label={`Replacement ${metadataFields[field] || field}`}
                            value={edits[id] ?? candidate.value}
                            type={
                              field === "number" || field === "disc"
                                ? "number"
                                : "text"
                            }
                            min={0}
                            max={9999}
                            maxLength={500}
                            required={field === "title" || field === "artist"}
                            onChange={(e) =>
                              setEdits({ ...edits, [id]: e.target.value })
                            }
                          />
                        ))}
                    </div>
                  </div>
                </fieldset>
              );
            })}
            {!suggestions.length && !error && (
              <p>No pending suggestions for this song.</p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <div className="row chooser-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Reload suggestions
          </Button>
          <Button
            disabled={busy || loading || !selected.length}
            onClick={() => void apply()}
          >
            {busy
              ? "Applying…"
              : `Apply ${selected.length} selected ${selected.length === 1 ? "field" : "fields"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
