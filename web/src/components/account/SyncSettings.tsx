// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { api, APIError } from "../../services/api";
import type {
  Connection,
  ExportStatus,
  Preferences,
  Provider,
  SyncStatus,
} from "../../services/sync";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/Checkbox";

function dateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function SyncSettings({
  userId,
  onExpired,
}: {
  userId: string;
  onExpired: () => void;
}) {
  const [status, setStatus] = useState<SyncStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [provider, setProvider] = useState<Provider>("lastfm");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return dateInput(d);
  });
  const [to, setTo] = useState(() => dateInput(new Date()));
  const [preview, setPreview] = useState<ExportStatus>();
  const [job, setJob] = useState<ExportStatus>();
  const exportKey = `cadence:sync-export:${userId}`;
  function failure(e: unknown) {
    if (e instanceof APIError && e.status === 401) onExpired();
    else setError(e instanceof Error ? e.message : "Sync request failed");
  }
  async function refresh() {
    setStatus(await api<SyncStatus>("/sync"));
  }
  useEffect(() => {
    if (
      status?.connections.length &&
      !status.connections.some((c) => c.provider === provider)
    ) {
      setProvider(status.connections[0].provider);
      setPreview(undefined);
    }
  }, [status, provider]);
  useEffect(() => {
    let active = true;
    try {
      const id = localStorage.getItem(exportKey);
      if (id)
        void api<ExportStatus>(`/sync/exports/${encodeURIComponent(id)}`)
          .then((v) => {
            if (active) setJob(v);
          })
          .catch((e) => {
            if (active && !(e instanceof APIError && e.status === 404))
              failure(e);
          });
    } catch {
      /* Export still works when browser storage is unavailable. */
    }
    return () => {
      active = false;
    };
  }, [exportKey]);
  useEffect(() => {
    let active = true;
    const load = () =>
      void api<SyncStatus>("/sync")
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch((e) => {
          if (active) failure(e);
        });
    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!job?.id || job.pending === 0) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api<ExportStatus>(`/sync/exports/${job.id}`)
        .then((v) => {
          if (active) setJob(v);
        })
        .catch((e) => {
          if (active) failure(e);
        });
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.pending]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  function preferences(
    c: Connection,
    field: keyof Preferences,
    value: boolean,
  ) {
    void action(() =>
      api(`/sync/${c.provider}/preferences`, "PUT", {
        plays: c.plays,
        nowPlaying: c.nowPlaying,
        likes: c.likes,
        [field]: value,
      }),
    );
  }
  function range() {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    )
      throw new Error("Choose a valid date range");
    return { from: start.toISOString(), to: end.toISOString() };
  }
  const connections = status?.connections ?? [];
  const exportConnection = connections.find((c) => c.provider === provider);
  return (
    <section className="sync-settings" aria-labelledby="sync-heading">
      <h3 id="sync-heading">Sync</h3>
      <p className="muted">
        Choose what Cadence sends to your accounts. Plays qualify after half a
        song or four minutes; songs must be longer than 30 seconds.
      </p>
      {error && <p role="alert">{error}</p>}
      {!status && !error && <p role="status">Loading connections…</p>}
      {status &&
        (["lastfm", "listenbrainz"] as Provider[]).map((p) => {
          const c = connections.find((c) => c.provider === p);
          const name = p === "lastfm" ? "Last.fm" : "ListenBrainz";
          return (
            <fieldset key={p} disabled={busy} className="sync-provider">
              <legend>{name}</legend>
              {c && (
                <>
                  <p>
                    Connected as <strong>{c.username}</strong>
                    {c.paused ? " · Needs reconnection" : ""}
                  </p>
                  <Checkbox
                    label="Sync plays"
                    checked={c.plays}
                    onChange={(e) => preferences(c, "plays", e.target.checked)}
                  />
                  <Checkbox
                    label="Sync now playing"
                    checked={c.nowPlaying}
                    onChange={(e) =>
                      preferences(c, "nowPlaying", e.target.checked)
                    }
                  />
                  <Checkbox
                    label="Sync likes"
                    description="Send new likes and unlikes. Existing likes are not exported."
                    checked={c.likes}
                    onChange={(e) => preferences(c, "likes", e.target.checked)}
                  />
                  <p className="muted">
                    {c.pending} pending · Last successful sync:{" "}
                    {c.lastSuccess
                      ? new Date(c.lastSuccess).toLocaleString()
                      : "None yet"}
                  </p>
                  {c.waitingFeedback > 0 && (
                    <p className="muted">
                      {c.waitingFeedback} like changes are waiting for a
                      ListenBrainz recording identifier. They can sync after
                      this song reports now playing. No artificial plays will be
                      sent.
                    </p>
                  )}
                  {c.error && <p role="status">{c.error}</p>}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void action(() => api(`/sync/${p}`, "DELETE"))
                    }
                  >
                    Disconnect {name}
                  </Button>
                </>
              )}
              {p === "lastfm" ? (
                <>
                  <Button
                    disabled={!status.lastfmAuthorizationAvailable}
                    onClick={() =>
                      void action(async () => {
                        const result = await api<{ url: string }>(
                          "/sync/lastfm/authorize",
                          "POST",
                        );
                        window.location.assign(result.url);
                      })
                    }
                  >
                    {c ? "Reconnect" : "Connect"} Last.fm
                  </Button>
                  {!status.lastfmAuthorizationAvailable && (
                    <p className="muted">
                      The instance administrator must configure Last.fm in
                      Instance settings → Sync and set PUBLIC_URL.
                    </p>
                  )}
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await api("/sync/listenbrainz/connect", "POST", {
                        token,
                      });
                      setToken("");
                    });
                  }}
                >
                  <label>
                    Personal token{" "}
                    <input
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      aria-label="ListenBrainz personal token"
                    />
                  </label>
                  <a
                    href="https://listenbrainz.org/profile/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get your ListenBrainz token
                  </a>
                  <Button type="submit" disabled={!token.trim()}>
                    {c ? "Reconnect" : "Connect"} ListenBrainz
                  </Button>
                </form>
              )}
            </fieldset>
          );
        })}
      {connections.length > 0 && (
        <fieldset disabled={busy} className="sync-provider">
          <legend>Export verified history</legend>
          <p className="muted">
            Only listens verified after this feature was installed qualify.
            Older local play records are excluded. Dates use your local time.
            Previously sent listens are skipped.
          </p>
          <label>
            Service{" "}
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as Provider);
                setPreview(undefined);
              }}
            >
              <option
                value="lastfm"
                disabled={!connections.some((c) => c.provider === "lastfm")}
              >
                Last.fm
              </option>
              <option
                value="listenbrainz"
                disabled={
                  !connections.some((c) => c.provider === "listenbrainz")
                }
              >
                ListenBrainz
              </option>
            </select>
          </label>
          <label>
            From{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
          <label>
            Through{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
          <Button
            disabled={!exportConnection?.plays}
            onClick={() =>
              void action(async () => {
                setPreview(
                  await api<ExportStatus>(
                    `/sync/${provider}/exports/preview?${new URLSearchParams(range())}`,
                  ),
                );
              })
            }
          >
            Preview export
          </Button>
          {preview && (
            <>
              <p role="status">
                {preview.eligible} verified · {preview.previouslySent} already
                sent · {preview.excluded} excluded local plays
              </p>
              <Button
                disabled={
                  !exportConnection?.plays ||
                  preview.eligible <= preview.previouslySent
                }
                onClick={() =>
                  void action(async () => {
                    const result = await api<ExportStatus>(
                      `/sync/${provider}/exports`,
                      "POST",
                      range(),
                    );
                    setJob(result);
                    setPreview(undefined);
                    try {
                      localStorage.setItem(exportKey, result.id);
                    } catch {}
                  })
                }
              >
                Export to {provider === "lastfm" ? "Last.fm" : "ListenBrainz"}
              </Button>
            </>
          )}
          {!exportConnection?.plays && (
            <p className="muted">
              Connect this service and enable Sync plays to export.
            </p>
          )}
          {job && (
            <p role="status">
              Export: {job.sent} sent · {job.pending} pending · {job.rejected}{" "}
              rejected · {job.cancelled} cancelled
            </p>
          )}
          {job?.failures?.map((f, i) => (
            <p key={i} className="muted">
              {f.artist} — {f.title}: {f.error}
            </p>
          ))}
          {job && job.rejected > 25 && (
            <p className="muted">Showing the first 25 rejected records.</p>
          )}
        </fieldset>
      )}
    </section>
  );
}
