// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Shield, Trash2, X } from "lucide-react";
import { api, User } from "./api";
type Group = { id: string; name: string };
type Exclusion = { id: string; groupId: string; kind: string; target: string };
type Suggestion = {
  id: string;
  trackId: string;
  field: string;
  value: string;
  source: string;
  title: string;
  current: string;
};
type Scan = {
  id: string;
  started: string;
  finished: string | null;
  status: string;
  indexed: number;
  errors: string[];
};
export function Admin({ report }: { report: (s: string) => void }) {
  const [tab, setTab] = useState("library");
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [enrichment, setEnrichment] = useState(false);
  const [loading, setLoading] = useState(false);
  const [full, setFull] = useState(false);
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const [more, setMore] = useState(false);
  const load = useCallback(async () => {
    try {
      const [u, g, e, s, c] = await Promise.all([
        api<User[]>("/admin/users"),
        api<Group[]>("/admin/groups"),
        api<Exclusion[]>("/admin/exclusions"),
        api<Scan[]>("/admin/scans"),
        api<{ roots: string[]; settings: { enrichment: boolean } }>(
          "/admin/config",
        ),
      ]);
      setUsers(u);
      setGroups(g);
      setExclusions(e);
      setScans(s);
      setRoots(c.roots);
      setEnrichment(c.settings.enrichment);
    } catch (e) {
      report((e as Error).message);
    }
  }, [report]);
  const loadSuggestions = useCallback(
    async (offset = 0) => {
      try {
        const v = await api<Suggestion[]>(
          `/admin/suggestions?limit=100&offset=${offset}`,
        );
        setSuggestions((s) => (offset ? [...s, ...v] : v));
        setSuggestionOffset(offset);
        setMore(v.length === 100);
      } catch (e) {
        report((e as Error).message);
      }
    },
    [report],
  );
  useEffect(() => {
    void load();
    void loadSuggestions();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load, loadSuggestions]);
  async function perform(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      await fn();
      await load();
    } catch (e) {
      report((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="content admin">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SERVER, YOUR RULES</p>
          <h1>Instance settings</h1>
          <p className="subtitle">Keep the collection running smoothly.</p>
        </div>
        <Shield size={42} />
      </div>
      <div className="tabs">
        {["library", "people", "permissions", "suggestions"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => {
              setTab(t);
              if (t === "suggestions") void loadSuggestions();
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "library" && (
        <>
          <div className="panel">
            <h2>Music folders</h2>
            <p className="muted">
              Configured with MUSIC_ROOTS. Files are read-only; accepted
              corrections live in the catalog.
            </p>
            {roots.map((r) => (
              <code key={r}>{r}</code>
            ))}
            <div className="row scan-controls">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={full}
                  onChange={(e) => setFull(e.target.checked)}
                />{" "}
                Re-read all files and generate metadata suggestions
              </label>
              <button
                className="primary"
                disabled={loading || scans.some((s) => s.status === "running")}
                onClick={() =>
                  void perform(() => api("/admin/scans", "POST", { full }))
                }
              >
                <RefreshCw size={16} /> Scan library
              </button>
            </div>
          </div>
          <div className="panel">
            <h2>Optional metadata enrichment</h2>
            <p className="muted">
              MusicBrainz and Cover Art Archive can suggest catalog changes. Set
              METADATA_USER_AGENT with contact information on the server. Enable
              this, then run a full scan to include existing files.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={enrichment}
                disabled={loading}
                onChange={(e) =>
                  void perform(() =>
                    api("/admin/settings", "PUT", {
                      enrichment: e.target.checked,
                    }),
                  )
                }
              />{" "}
              Enable external lookups
            </label>
          </div>
          <div className="panel">
            <h2>Recent scans</h2>
            {scans.map((s) => (
              <div className="scan" key={s.id}>
                <div className="row">
                  <strong>{s.status.replaceAll("_", " ")}</strong>
                  <span>{s.indexed.toLocaleString()} files indexed</span>
                </div>
                <small>{new Date(s.started).toLocaleString()}</small>
                {s.errors.length > 0 && (
                  <details>
                    <summary>
                      {s.errors.length} reported issues (first 200)
                    </summary>
                    {s.errors.map((e, i) => (
                      <p key={i} className="scan-error">
                        {e}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            ))}
            {!scans.length && <p className="muted">No scans yet.</p>}
          </div>
        </>
      )}
      {tab === "people" && (
        <>
          <div className="panel">
            <h2>Invite a listener</h2>
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void perform(async () => {
                  await api("/admin/users", "POST", {
                    name: f.get("name"),
                    password: f.get("password"),
                    admin: f.get("admin") === "on",
                  });
                  form.reset();
                });
              }}
            >
              <label>
                Username
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Initial password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={3}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </label>
              <label className="checkbox">
                <input name="admin" type="checkbox" /> Administrator
              </label>
              <button className="primary" disabled={loading}>
                Create account
              </button>
            </form>
          </div>
          <div className="panel">
            <h2>Listeners</h2>
            {users.map((u) => (
              <div className="user-row" key={u.id}>
                <div className="row">
                  <strong>
                    {u.name} {u.admin && <span className="badge">admin</span>}
                  </strong>
                  <button
                    className="subtle"
                    disabled={loading}
                    onClick={() =>
                      void perform(() =>
                        api(`/admin/users/${u.id}/sessions`, "DELETE"),
                      )
                    }
                  >
                    Revoke sessions
                  </button>
                </div>
                <div className="group-toggles">
                  {groups.map((g) => (
                    <label className="checkbox" key={g.id}>
                      <input
                        type="checkbox"
                        checked={u.groups?.includes(g.id) ?? false}
                        disabled={loading}
                        onChange={(e) => {
                          const ids = new Set(u.groups);
                          if (e.target.checked) ids.add(g.id);
                          else ids.delete(g.id);
                          void perform(() =>
                            api(`/admin/users/${u.id}/groups`, "PUT", {
                              groups: [...ids],
                            }),
                          );
                        }}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "permissions" && (
        <>
          <div className="panel">
            <h2>User groups</h2>
            <p className="muted">
              Everyone starts with access to all music. Exclusions from any
              assigned group win, including for administrators.
            </p>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void perform(async () => {
                  await api("/admin/groups", "POST", { name: f.get("name") });
                  form.reset();
                });
              }}
            >
              <input
                aria-label="Group name"
                name="name"
                placeholder="New group name"
                required
                maxLength={120}
              />
              <button className="primary" disabled={loading}>
                Create group
              </button>
            </form>
            <div className="group-toggles">
              {groups.map((g) => (
                <span className="badge" key={g.id}>
                  {g.name}
                </span>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2>Exclude music</h2>
            <p className="muted">
              Use a track or album ID from its API response, or an absolute
              folder path inside a configured root. A folder exclusion also
              applies to its descendants.
            </p>
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void perform(async () => {
                  await api("/admin/exclusions", "POST", {
                    groupId: f.get("groupId"),
                    kind: f.get("kind"),
                    target: f.get("target"),
                  });
                  form.reset();
                });
              }}
            >
              <label>
                Group
                <select name="groupId" required>
                  <option value="">Choose group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exclude by
                <select name="kind">
                  <option value="folder">Folder</option>
                  <option value="album">Album ID</option>
                  <option value="track">Track ID</option>
                </select>
              </label>
              <label className="wide">
                Folder path or ID
                <input
                  name="target"
                  required
                  placeholder="/music/Artist/Album"
                />
              </label>
              <button className="primary" disabled={loading || !groups.length}>
                Add exclusion
              </button>
            </form>
            {exclusions.map((e) => (
              <div className="exclusion row" key={e.id}>
                <div>
                  <strong>
                    {groups.find((g) => g.id === e.groupId)?.name} · {e.kind}
                  </strong>
                  <code>{e.target}</code>
                </div>
                <button
                  aria-label="Delete exclusion"
                  disabled={loading}
                  onClick={() =>
                    void perform(() =>
                      api(`/admin/exclusions/${e.id}`, "DELETE"),
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "suggestions" && (
        <>
          <div className="panel">
            <h2>Suggest a catalog correction</h2>
            <p className="muted">
              Corrections can be reviewed below. Original tags and music files
              are always preserved.
            </p>
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void perform(async () => {
                  await api("/admin/suggestions", "POST", {
                    trackId: f.get("trackId"),
                    field: f.get("field"),
                    value: f.get("value"),
                  });
                  form.reset();
                  await loadSuggestions();
                });
              }}
            >
              <label>
                Track ID
                <input name="trackId" required />
              </label>
              <label>
                Field
                <select name="field">
                  {[
                    "title",
                    "artist",
                    "album",
                    "albumArtist",
                    "year",
                    "genre",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Suggested value
                <input name="value" required maxLength={500} />
              </label>
              <button className="primary" disabled={loading}>
                Add suggestion
              </button>
            </form>
          </div>
          <div className="panel">
            <h2>Review changes</h2>
            {suggestions.map((s) => (
              <div className="suggestion" key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <p>
                    <span className="badge">{s.field}</span>{" "}
                    {s.field === "artwork" ? (
                      "Suggested album artwork"
                    ) : (
                      <>
                        <span className="old-value">
                          {s.current || "(empty)"}
                        </span>{" "}
                        → {s.value}
                      </>
                    )}
                  </p>
                  {s.field === "artwork" && (
                    <img
                      className="suggestion-art"
                      src={`/api/v1/admin/suggestions/${s.id}/art`}
                      alt="Suggested album artwork"
                      loading="lazy"
                    />
                  )}
                  <small>{s.source}</small>
                </div>
                <div className="row">
                  <button
                    className="primary small"
                    disabled={loading}
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          `/admin/suggestions/${s.id}/resolve`,
                          "POST",
                          { accept: true },
                        );
                        await loadSuggestions();
                      })
                    }
                  >
                    <Check size={15} /> Accept
                  </button>
                  <button
                    className="subtle"
                    disabled={loading}
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          `/admin/suggestions/${s.id}/resolve`,
                          "POST",
                          { accept: false },
                        );
                        await loadSuggestions();
                      })
                    }
                  >
                    <X size={15} /> Dismiss
                  </button>
                </div>
              </div>
            ))}
            {!suggestions.length && (
              <p className="muted">
                No pending suggestions. Run a full scan to check existing music.
              </p>
            )}
            {more && (
              <button
                className="load-more"
                onClick={() => void loadSuggestions(suggestionOffset + 100)}
              >
                Load more
              </button>
            )}
          </div>
          <div className="panel">
            <h2>Restore an extracted value</h2>
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(() =>
                  api(
                    `/admin/tracks/${encodeURIComponent(String(f.get("trackId")))}/overrides/${f.get("field")}`,
                    "DELETE",
                  ),
                );
              }}
            >
              <label>
                Track ID
                <input name="trackId" required />
              </label>
              <label>
                Override field
                <select name="field">
                  {[
                    "title",
                    "artist",
                    "album",
                    "albumArtist",
                    "year",
                    "genre",
                    "artwork",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <button className="subtle" disabled={loading}>
                Remove override
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
