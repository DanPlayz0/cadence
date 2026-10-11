// SPDX-License-Identifier: GPL-2.0-or-later
import { Radio, RadioGroup } from "../ui/radio-group";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { PlaylistIcon } from "./PlaylistIcon";
import {
  filterPlaylistIcons,
  playlistIconLabel,
  playlistIconPage,
  playlistIconPageSize,
  quickPlaylistIcons,
} from "../../lib/playlistIcons";

export function PlaylistIconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [page, query]);
  const results = filterPlaylistIcons(query);
  const pages = Math.max(1, Math.ceil(results.length / playlistIconPageSize));
  function choices(names: string[], group: string) {
    return (
      <RadioGroup
        className="playlist-icons"
        name={`${id}-${group}`}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        aria-label={group === "quick" ? "Quick icon choices" : "Icon results"}
      >
        {names.map((name) => (
          <label key={name} className={name === value ? "selected" : ""}>
            <Radio value={name} />
            <PlaylistIcon name={name} size={22} />
            <span>{playlistIconLabel(name)}</span>
          </label>
        ))}
      </RadioGroup>
    );
  }
  return (
    <fieldset disabled={disabled} className="playlist-icon-picker">
      <legend>Choose an icon</legend>
      <p className="playlist-icon-selection">
        Selected: {playlistIconLabel(value)}
      </p>
      <div role="group" aria-label="Quick icon choices">
        {choices(quickPlaylistIcons, "quick")}
      </div>
      <label className="playlist-icon-search">
        Search icons
        <Input
          type="search"
          value={query}
          placeholder="e.g. tree, guitar, coffee"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <p role="status">
        {results.length.toLocaleString()}{" "}
        {results.length === 1 ? "icon" : "icons"}
        {results.length > 0 && ` · Page ${page + 1} of ${pages}`}
      </p>
      <div
        ref={resultsRef}
        className="playlist-icon-results"
        role="group"
        aria-label="Lucide icon collection"
      >
        {results.length ? (
          choices(playlistIconPage(results, page), "catalog")
        ) : (
          <p>No icons match your search.</p>
        )}
      </div>
      <div className="row playlist-icon-pagination">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </fieldset>
  );
}
