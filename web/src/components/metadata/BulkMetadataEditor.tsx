// SPDX-License-Identifier: GPL-2.0-or-later
import { Select, SelectItem } from "../ui/select";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Form } from "../ui/form";
import { useEffect, useState } from "react";
import { api, type Page } from "../../services/api";
const attributes = {
  title: "Title",
  artist: "Artist / performer",
  album: "Album",
  albumArtist: "Album artist",
  year: "Year",
  genre: "Genre",
  number: "Track number",
  disc: "Disc number",
} as const;
type Field = keyof typeof attributes;
export function BulkMetadataEditor({
  onSuggestions,
  revision,
  disabled = false,
}: {
  onSuggestions: () => Promise<void>;
  revision: number;
  disabled?: boolean;
}) {
  const [field, setField] = useState<Field>("album");
  const [match, setMatch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const numeric = field === "number" || field === "disc";
  const required = numeric || field === "title" || field === "artist";
  useEffect(() => {
    let live = true;
    setSearching(true);
    setPage(null);
    const timer = window.setTimeout(() => {
      void api<Page>(
        `/admin/metadata/tracks?${new URLSearchParams({ field, value: match, limit: "25", offset: String(offset) })}`,
      )
        .then((result) => {
          if (live) setPage(result);
        })
        .catch((error) => {
          if (live) setError((error as Error).message);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [field, match, offset, refresh, revision]);
  return (
    <div className="bulk-metadata-editor">
      <fieldset disabled={saving || disabled} className="admin-form">
        <legend>Filter by attribute</legend>
        <label>
          Attribute
          <Select
            value={field}
            onChange={(event) => {
              setField(event.target.value as Field);
              setOffset(0);
              setReplacement("");
              setNotice("");
            }}
          >
            {Object.entries(attributes).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </Select>
        </label>
        <label>
          Matches exactly
          <Input
            value={match}
            maxLength={500}
            placeholder="Leave blank to match an empty attribute"
            onChange={(event) => {
              setMatch(event.target.value);
              setOffset(0);
              setNotice("");
            }}
          />
        </label>
      </fieldset>
      <p className="muted">
        Matches the current catalog value, ignoring letter case. All matching
        songs are included, across every preview page.
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <div aria-busy={searching}>
        {searching ? (
          <p role="status">Finding matching songs…</p>
        ) : (
          page && (
            <>
              <p>
                <strong>{page.total.toLocaleString()} matching songs</strong>
              </p>
              <div className="metadata-results">
                {page.items.map((track) => (
                  <div className="bulk-metadata-track" key={track.id}>
                    <strong>{track.title}</strong>
                    <span>
                      {track.artist} · {track.album || "Single"}
                    </span>
                  </div>
                ))}
              </div>
              {!page.total && (
                <p className="muted">No songs match this attribute value.</p>
              )}
              {page.total > 25 && (
                <div className="row activity-pagination">
                  <span>
                    {offset + 1}–{Math.min(offset + 25, page.total)} of{" "}
                    {page.total}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={saving || offset === 0}
                    onClick={() =>
                      setOffset((value) => Math.max(0, value - 25))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={saving || offset + 25 >= page.total}
                    onClick={() => setOffset((value) => value + 25)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )
        )}
      </div>
      <Form
        className="admin-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || disabled || searching || !page?.total) return;
          setSaving(true);
          setNotice("");
          setError("");
          try {
            const result = await api<{ saved: number }>(
              "/admin/metadata/bulk",
              "POST",
              { field, match, value: replacement, expectedCount: page.total },
            );
            setNotice(
              result.saved
                ? `${result.saved.toLocaleString()} ${attributes[field].toLowerCase()} changes saved as suggestions. Review and accept them below to apply them.`
                : "No new suggestions: matching songs already have this value or these changes are already pending.",
            );
            await onSuggestions();
          } catch (error) {
            setError((error as Error).message);
            setRefresh((value) => value + 1);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="wide">
          New {attributes[field].toLowerCase()}
          <Input
            value={replacement}
            disabled={saving || disabled}
            required={required}
            type={numeric ? "number" : "text"}
            min={0}
            max={9999}
            step={1}
            maxLength={500}
            placeholder={
              required
                ? "Replacement value"
                : "Leave empty to clear this attribute"
            }
            onChange={(event) => {
              setReplacement(event.target.value);
              setNotice("");
            }}
          />
        </label>
        {!required && (
          <p className="wide muted">
            An empty replacement clears {attributes[field].toLowerCase()}.
            {field === "album" &&
              " Songs with an empty album appear as singles after you accept the changes."}
          </p>
        )}
        <Button
          variant="ghost"
          className="primary"
          disabled={saving || disabled || searching || !page?.total}
        >
          {saving
            ? "Saving…"
            : `Save suggestions for ${page?.total.toLocaleString() || 0} songs`}
        </Button>
      </Form>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
