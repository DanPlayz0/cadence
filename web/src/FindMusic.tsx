// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  fileName,
  fileSize,
  requestID,
  type SoulseekCapabilities,
  type SoulseekSearch,
  type SoulseekResult,
  type SoulseekFile,
} from "./soulseek";
import { SoulseekRequests } from "./SoulseekRequests";
import "./Soulseek.css";

export function FindMusic({
  query = "",
  capabilities,
  admin = false,
  embedded = false,
  onQuery,
  onLibrary,
}: {
  query?: string;
  capabilities: SoulseekCapabilities;
  admin?: boolean;
  embedded?: boolean;
  onQuery?: (q: string) => void;
  onLibrary?: () => void;
}) {
  const [text, setText] = useState(query);
  const [search, setSearch] = useState<SoulseekSearch | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [folder, setFolder] = useState<{
    result: SoulseekResult;
    files: SoulseekFile[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const sequence = useRef(0);
  const pending = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    setText(query);
  }, [query]);
  useEffect(() => {
    sequence.current++;
    setSearch(null);
    setFolder(null);
    pending.current = null;
  }, [capabilities.allowed]);
  useEffect(() => {
    if (
      !search?.id ||
      !capabilities.allowed ||
      /Completed|Cancelled|Errored/.test(search.state)
    )
      return;
    let live = true;
    const id = search.id;
    const timer = setInterval(() => {
      void api<SoulseekSearch>(`/soulseek/searches/${id}`)
        .then((v) => {
          if (live) setSearch(v);
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            clearInterval(timer);
          }
        });
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [search?.id, search?.state, capabilities.allowed]);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const n = ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    setFolder(null);
    setOffset(0);
    try {
      const v = await api<SoulseekSearch>("/soulseek/searches", "POST", {
        query: text.trim(),
      });
      if (n === sequence.current) {
        setSearch(v);
        onQuery?.(text.trim());
      }
    } catch (e) {
      if (n === sequence.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openFolder(result: SoulseekResult) {
    if (busy || !search) return;
    const n = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const files = await api<SoulseekFile[]>("/soulseek/folder", "POST", {
        searchId: search.id,
        username: result.username,
        folder: result.folder,
      });
      if (n === sequence.current) {
        setFolder({ result, files });
        setSelected(files.map((f) => f.filename));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(
    result: SoulseekResult,
    filenames: string[],
    album = false,
  ) {
    if (busy || !search) return;
    setBusy(true);
    setError("");
    const selection = {
      searchId: search.id,
      username: result.username,
      folder: result.folder,
      filenames,
      album,
    };
    const key = JSON.stringify(selection);
    try {
      if (pending.current?.key !== key)
        pending.current = { key, id: requestID() };
      await api("/soulseek/requests", "POST", {
        id: pending.current.id,
        ...selection,
      });
      pending.current = null;
      setNotice("Download requested. Follow its progress below.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!capabilities.allowed)
    return (
      <section className="content soulseek">
        <h1>Find music</h1>
        <p>
          {capabilities.configured
            ? "Soulseek is disabled or your account has not been granted access."
            : "The optional Soulseek container is not configured."}
        </p>
        {onLibrary && <button onClick={onLibrary}>Back to your library</button>}
      </section>
    );
  return (
    <section
      className={embedded ? "soulseek soulseek-embedded" : "content soulseek"}
    >
      <div className="soulseek-row">
        <div>
          {embedded ? <h2>Soulseek</h2> : <h1>Find music</h1>}
          <p>Search beyond your library and request songs or albums.</p>
        </div>
        {onLibrary && <button onClick={onLibrary}>Your library</button>}
      </div>
      <form onSubmit={(e) => void start(e)} className="soulseek-search">
        <label
          className="sr-only"
          htmlFor={embedded ? "soulseek-inline-query" : "soulseek-query"}
        >
          Soulseek search
        </label>
        <input
          id={embedded ? "soulseek-inline-query" : "soulseek-query"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Artist, song, or album"
          minLength={3}
          maxLength={200}
        />
        <button disabled={busy || text.trim().length < 3}>
          Search Soulseek
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {search && (
        <>
          <p role="status">
            {search.state} · {search.results.length} audio results
          </p>
          <div className="soulseek-results">
            {search.results.slice(offset, offset + 50).map((result, i) => (
              <article
                key={`${result.username}:${result.filename}:${i}`}
                className="soulseek-card"
              >
                <strong>{fileName(result.filename)}</strong>
                <p>
                  {result.username} · {fileSize(result.size)}
                  {result.bitRate ? ` · ${result.bitRate} kbps` : ""}
                  {result.sampleRate ? ` · ${result.sampleRate} Hz` : ""}
                  {result.bitDepth ? ` · ${result.bitDepth} bit` : ""}
                </p>
                <p className="soulseek-path">{result.folder}</p>
                <p>
                  {result.hasFreeUploadSlot
                    ? "Upload slot available"
                    : "Peer is busy"}{" "}
                  · Queue {result.queueLength}
                  {result.uploadSpeed
                    ? ` · ${(result.uploadSpeed / 1024).toFixed(0)} KiB/s`
                    : ""}
                </p>
                <div className="soulseek-actions">
                  <button
                    disabled={busy}
                    onClick={() => void download(result, [result.filename])}
                  >
                    Request song
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void openFolder(result)}
                  >
                    View album folder
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!search.results.length && /Completed/.test(search.state) && (
            <p>No audio results. Try a different artist or title.</p>
          )}
          <div className="soulseek-actions">
            {offset > 0 && (
              <button onClick={() => setOffset((v) => Math.max(0, v - 50))}>
                Previous results
              </button>
            )}
            {offset + 50 < search.results.length && (
              <button onClick={() => setOffset((v) => v + 50)}>
                Next results
              </button>
            )}
          </div>
        </>
      )}
      {folder && (
        <section className="soulseek-card">
          <div className="soulseek-row">
            <h2>{fileName(folder.result.folder)}</h2>
            <button onClick={() => setFolder(null)}>Close folder</button>
          </div>
          <p>{folder.result.username} · Complete audio folder listing</p>
          <div className="soulseek-folder">
            {folder.files.map((f) => (
              <label key={f.filename}>
                <input
                  type="checkbox"
                  checked={selected.includes(f.filename)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked
                        ? [...v, f.filename]
                        : v.filter((n) => n !== f.filename),
                    )
                  }
                />
                {fileName(f.filename)} · {fileSize(f.size)}
              </label>
            ))}
          </div>
          <div className="soulseek-actions">
            <button
              disabled={busy || !selected.length}
              onClick={() => void download(folder.result, selected)}
            >
              Request selected songs
            </button>
            <button
              disabled={busy || !folder.files.length}
              onClick={() => void download(folder.result, [], true)}
            >
              Request complete album folder
            </button>
          </div>
        </section>
      )}
      <SoulseekRequests admin={admin} revision={revision} />
    </section>
  );
}
