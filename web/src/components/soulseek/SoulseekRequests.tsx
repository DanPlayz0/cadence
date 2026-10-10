// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import type { MusicLibrary } from "../../lib/libraries";
import {
  fileName,
  requestProgress,
  stateLabel,
  type SoulseekRequest,
  type SoulseekRule,
} from "../../lib/soulseek";
import "../../styles/Soulseek.css";

export function SoulseekDestination({
  rule,
  libraries,
  onChange,
  id,
}: {
  rule: SoulseekRule;
  libraries: MusicLibrary[];
  onChange: (rule: SoulseekRule) => void;
  id: string;
}) {
  const library = libraries.find((l) => l.id === rule.libraryId);
  return (
    <div className="soulseek-destination">
      <label>
        Destination library
        <select
          value={rule.libraryId}
          onChange={(e) => {
            const l = libraries.find((l) => l.id === e.target.value);
            onChange({
              ...rule,
              libraryId: e.target.value,
              folder: l?.folders[0] || "",
            });
          }}
        >
          <option value="">Choose a library</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Destination folder
        <input
          value={rule.folder}
          list={`${id}-folders`}
          placeholder="Choose a library folder or mounted subfolder"
          onChange={(e) => onChange({ ...rule, folder: e.target.value })}
        />
        <datalist id={`${id}-folders`}>
          {library?.folders.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
    </div>
  );
}
function RequestCard({
  request,
  admin,
  libraries,
  names,
  onAction,
  busy,
}: {
  request: SoulseekRequest;
  admin: boolean;
  libraries: MusicLibrary[];
  names: Record<string, string>;
  onAction: (id: string, action: string, rule?: SoulseekRule) => Promise<void>;
  busy: boolean;
}) {
  const [destination, setDestination] = useState(request.rule);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const review = ["review_before", "review_after", "blocked"].includes(
    request.state,
  );
  return (
    <article className="soulseek-card">
      <div className="soulseek-row">
        <div>
          <strong>{fileName(request.folder)}</strong>
          <p>
            {request.files.length} audio{" "}
            {request.files.length === 1 ? "file" : "files"} · {request.username}
            {admin ? ` · ${names[request.userId] || "Deleted listener"}` : ""}
          </p>
        </div>
        <span>{stateLabel(request.state)}</span>
      </div>
      <p>
        <time dateTime={request.created}>
          {new Date(request.created).toLocaleString()}
        </time>
      </p>
      {request.state === "downloading" && (
        <>
          <progress
            aria-label="Download progress"
            max={100}
            value={requestProgress(request)}
          />
          <span> {requestProgress(request)}%</span>
        </>
      )}
      {request.error && <p role="alert">{request.error}</p>}
      <details>
        <summary>Files and transfer status</summary>
        <ul>
          {request.files.map((f) => (
            <li key={f.filename}>
              {fileName(f.filename)} — {stateLabel(f.state)}
              {f.placeInQueue != null
                ? ` · Queue position ${f.placeInQueue}`
                : ""}
            </li>
          ))}
        </ul>
      </details>
      {admin && review && (
        <>
          <SoulseekDestination
            rule={destination}
            libraries={libraries}
            onChange={setDestination}
            id={request.id}
          />
          <p className="soulseek-help">
            Approval imports into this folder. Existing library sharing
            determines who can listen.
          </p>
        </>
      )}
      <div className="soulseek-actions">
        {admin && review && (
          <>
            <button
              disabled={busy || !destination.libraryId || !destination.folder}
              onClick={() => void onAction(request.id, "approve", destination)}
            >
              Approve{" "}
              {request.state === "review_before" ? "download" : "import"}
            </button>
            <button
              disabled={busy}
              onClick={() => void onAction(request.id, "reject")}
            >
              Reject
            </button>
          </>
        )}
        {[
          "queued",
          "downloading",
          "review_before",
          "review_after",
          "failed",
          "blocked",
        ].includes(request.state) && (
          <button
            disabled={busy}
            onClick={() => void onAction(request.id, "cancel")}
          >
            Cancel request
          </button>
        )}
        {["failed", "cancelled", "blocked"].includes(request.state) && (
          <button
            disabled={busy}
            onClick={() => void onAction(request.id, "retry")}
          >
            Retry
          </button>
        )}
        {admin &&
          ["rejected", "cancelled", "imported"].includes(request.state) &&
          (deleteConfirm ? (
            <>
              <span>Delete this batch’s staged files?</span>
              <button
                disabled={busy}
                onClick={() => void onAction(request.id, "delete-staging")}
              >
                Delete staged files
              </button>
              <button onClick={() => setDeleteConfirm(false)}>
                Keep files
              </button>
            </>
          ) : (
            <button onClick={() => setDeleteConfirm(true)}>
              Delete staging…
            </button>
          ))}
      </div>
    </article>
  );
}
export function SoulseekRequests({
  admin = false,
  revision = 0,
}: {
  admin?: boolean;
  revision?: number;
}) {
  const [items, setItems] = useState<SoulseekRequest[]>([]);
  const [libraries, setLibraries] = useState<MusicLibrary[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const limit = 25;
  const [offset, setOffset] = useState(0);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const v = await api<SoulseekRequest[]>(
        `/soulseek/requests?limit=${limit}&offset=${offset}`,
      );
      if (!mounted.current || seq !== sequence.current) return;
      setItems(v);
      setLoaded(true);
      setError("");
    } catch (e) {
      if (!mounted.current || seq !== sequence.current) return;
      setError((e as Error).message);
    }
  }, [offset]);
  useEffect(() => {
    let live = true;
    mounted.current = true;
    const poll = () => {
      if (live) void refresh();
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      live = false;
      mounted.current = false;
      sequence.current++;
      clearInterval(timer);
    };
  }, [refresh, revision]);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    void Promise.all([
      api<MusicLibrary[]>("/admin/libraries"),
      api<{ id: string; displayName: string; username: string }[]>(
        "/admin/users",
      ),
    ])
      .then(([ls, users]) => {
        if (live) {
          setLibraries(ls);
          setNames(
            Object.fromEntries(
              users.map((u) => [u.id, u.displayName || u.username]),
            ),
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [admin, revision]);
  async function action(id: string, action: string, rule?: SoulseekRule) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/soulseek/requests/${id}/actions`, "POST", {
        action,
        ...(rule ? { libraryId: rule.libraryId, folder: rule.folder } : {}),
      });
      setNotice("Request updated.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="soulseek-requests">
      <h2>{admin ? "Requests and review" : "Your downloads"}</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!loaded && !error && <p role="status">Loading requests…</p>}
      {loaded && !items.length && <p>No download requests yet.</p>}
      {items.map((r) => (
        <RequestCard
          key={r.id}
          request={r}
          admin={admin}
          libraries={libraries}
          names={names}
          onAction={action}
          busy={busy}
        />
      ))}
      <div className="soulseek-actions">
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - limit))}
        >
          Previous requests
        </button>
        <span>Page {Math.floor(offset / limit) + 1}</span>
        <button
          disabled={busy || items.length < limit}
          onClick={() => setOffset((n) => n + limit)}
        >
          Next requests
        </button>
      </div>
      <button disabled={busy} onClick={() => void refresh()}>
        Refresh requests
      </button>
    </section>
  );
}
