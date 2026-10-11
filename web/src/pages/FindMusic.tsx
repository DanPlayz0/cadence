// SPDX-License-Identifier: GPL-2.0-or-later
import { Button } from "../components/ui/button";
import { Form } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/Checkbox";
import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import {
  fileName,
  fileSize,
  requestID,
  type SoulseekCapabilities,
  type SoulseekSearch,
  type SoulseekResult,
  type SoulseekFile,
} from "../lib/soulseek";
import { SoulseekRequests } from "../components/soulseek/SoulseekRequests";
import "../styles/Soulseek.css";

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
        {onLibrary && (
          <Button variant="ghost" onClick={onLibrary}>
            Back to your library
          </Button>
        )}
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
        {onLibrary && (
          <Button variant="ghost" onClick={onLibrary}>
            Your library
          </Button>
        )}
      </div>
      <p className="soulseek-help">
        Download policy:{" "}
        {capabilities.losslessOnly
          ? "Lossless audio only"
          : "Any audio quality"}{" "}
        · Formats: {capabilities.allowedFormats.join(", ").toUpperCase()}. Album
        requests omit tracks that do not match this policy.
      </p>
      <Form onSubmit={(e) => void start(e)} className="soulseek-search">
        <label
          className="sr-only"
          htmlFor={embedded ? "soulseek-inline-query" : "soulseek-query"}
        >
          Soulseek search
        </label>
        <Input
          id={embedded ? "soulseek-inline-query" : "soulseek-query"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Artist, song, or album"
          minLength={3}
          maxLength={200}
        />
        <Button variant="ghost" disabled={busy || text.trim().length < 3}>
          Search Soulseek
        </Button>
      </Form>
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
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void download(result, [result.filename])}
                  >
                    Request song
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void openFolder(result)}
                  >
                    View album folder
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {!search.results.length && /Completed/.test(search.state) && (
            <p>
              No audio results match the download quality policy. Try a
              different artist or title.
            </p>
          )}
          <div className="soulseek-actions">
            {offset > 0 && (
              <Button
                variant="ghost"
                onClick={() => setOffset((v) => Math.max(0, v - 50))}
              >
                Previous results
              </Button>
            )}
            {offset + 50 < search.results.length && (
              <Button variant="ghost" onClick={() => setOffset((v) => v + 50)}>
                Next results
              </Button>
            )}
          </div>
        </>
      )}
      {folder && (
        <section className="soulseek-card">
          <div className="soulseek-row">
            <h2>{fileName(folder.result.folder)}</h2>
            <Button variant="ghost" onClick={() => setFolder(null)}>
              Close folder
            </Button>
          </div>
          <p>
            {folder.result.username} · Audio files matching the download quality
            policy
          </p>
          {!folder.files.length && (
            <p>
              No audio files in this folder match the download quality policy.
            </p>
          )}
          <p className="soulseek-help">
            Album requests include only eligible audio; excluded tracks are
            omitted.
          </p>
          <div className="soulseek-folder">
            {folder.files.map((f) => (
              <label key={f.filename}>
                <Checkbox
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
            <Button
              variant="ghost"
              disabled={busy || !selected.length}
              onClick={() => void download(folder.result, selected)}
            >
              Request selected songs
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !folder.files.length}
              onClick={() => void download(folder.result, [], true)}
            >
              Request eligible album songs
            </Button>
          </div>
        </section>
      )}
      <SoulseekRequests admin={admin} revision={revision} />
    </section>
  );
}
