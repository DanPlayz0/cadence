// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { Folder, FileAudio, ChevronRight } from "lucide-react";
import { api } from "./api";
import { Button } from "./components/ui/button";
type Entry = {
  name: string;
  path: string;
  kind: "folder" | "file";
  trackId?: string;
  title?: string;
  artist?: string;
  tracks: number;
};
type Directory = {
  items: Entry[];
  total: number;
  limit: number;
  offset: number;
};
export function LibraryMetadataBrowser({
  onSelect,
  busy,
  revision,
}: {
  onSelect: (id: string, path: string) => void;
  busy: boolean;
  revision: number;
}) {
  const [trail, setTrail] = useState<{ name: string; path: string }[]>([]),
    [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const path = trail.at(-1)?.path || "";
  useEffect(() => {
    setOffset(0);
    setItems([]);
  }, [revision]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void api<Directory>(
      `/admin/library?${new URLSearchParams({ path, limit: "100", offset: String(offset) })}`,
    )
      .then((v) => {
        if (live) {
          setItems((previous) =>
            offset ? [...previous, ...v.items] : v.items,
          );
          setTotal(v.total);
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
  }, [path, offset, retry, revision]);
  return (
    <section className="library-metadata-browser" aria-label="Server folders">
      <p className="muted">
        Browse indexed music folders, then select a file to edit its fields.
      </p>
      <nav className="metadata-breadcrumbs" aria-label="Library folder path">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setTrail([]);
            setOffset(0);
            setItems([]);
          }}
        >
          Library roots
        </Button>
        {trail.map((entry, i) => (
          <span key={entry.path}>
            <ChevronRight size={14} />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setTrail(trail.slice(0, i + 1));
                setOffset(0);
                setItems([]);
              }}
            >
              {entry.name}
            </Button>
          </span>
        ))}
      </nav>
      {path && <p className="metadata-file-path">{path}</p>}
      <div className="metadata-folder-list" aria-busy={loading}>
        {items.map((entry) => (
          <Button
            variant="ghost"
            key={entry.path}
            disabled={busy || loading}
            className="metadata-folder-entry"
            title={entry.path}
            onClick={() => {
              if (entry.kind === "folder") {
                setTrail([...trail, { name: entry.name, path: entry.path }]);
                setOffset(0);
                setItems([]);
              } else if (entry.trackId) onSelect(entry.trackId, entry.path);
            }}
          >
            {entry.kind === "folder" ? (
              <Folder size={20} />
            ) : (
              <FileAudio size={20} />
            )}
            <span>
              <strong>{entry.name}</strong>
              <small>
                {entry.kind === "folder"
                  ? `${entry.tracks} songs`
                  : entry.title + (entry.artist ? ` · ${entry.artist}` : "")}
              </small>
            </span>
            {entry.kind === "folder" && <ChevronRight size={16} />}
          </Button>
        ))}
      </div>
      {loading && <p role="status">Loading folder…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
            Retry folder
          </Button>
        </p>
      )}
      {!loading && !error && !items.length && (
        <p>No accessible indexed music in this folder.</p>
      )}
      {!loading && !error && items.length < total && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setOffset(items.length)}
        >
          Show more files and folders ({items.length} of {total})
        </Button>
      )}
    </section>
  );
}
