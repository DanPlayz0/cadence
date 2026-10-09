// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Shield, Trash2, X } from "lucide-react";
import { api, User } from "./api";
import { Checkbox } from "./Checkbox";
import { UserEditorDialog } from "./AccountEditor";
import { UserAvatar } from "./UserAvatar";
import { TrackMetadataEditor } from "./TrackMetadataEditor";
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
const reviewFields = {
  title: "Titles",
  artist: "Artists",
  album: "Albums",
  albumArtist: "Album artists",
  year: "Years",
  genre: "Genres",
  number: "Track numbers",
  disc: "Disc numbers",
  artwork: "Artwork",
};
export function Admin({
  report,
  onUpdated,
  onRevoked,
  onExpired,
  tab,
  onTab,
}: {
  report: (s: string) => void;
  onUpdated: (user: User) => void;
  onRevoked: (id: string) => void;
  onExpired: () => void;
  tab: string;
  onTab: (tab: string) => void;
}) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  useEffect(() => setSelectedUser(null), [tab]);
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
  const [suggestionRevision, setSuggestionRevision] = useState(0);
  const [acceptFields, setAcceptFields] = useState<string[]>(
    Object.keys(reviewFields),
  );
  const [bulkNotice, setBulkNotice] = useState("");
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
        setSuggestionRevision((current) => current + 1);
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
    if (loading) return;
    report("");
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
      {selectedUser && (
        <UserEditorDialog
          key={selectedUser.id}
          user={selectedUser}
          groups={groups}
          onClose={() => setSelectedUser(null)}
          onUpdated={(next) => {
            setSelectedUser(next);
            setUsers((current) =>
              current.map((user) => (user.id === next.id ? next : user)),
            );
            onUpdated(next);
          }}
          onRevoked={onRevoked}
          onExpired={onExpired}
        />
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SERVER, YOUR RULES</p>
          <h1 tabIndex={-1}>Instance settings</h1>
          <p className="subtitle">Keep the collection running smoothly.</p>
        </div>
        <Shield size={42} />
      </div>
      <div className="tabs" role="tablist" aria-label="Instance settings">
        {["library", "people", "permissions", "suggestions"].map((t) => (
          <button
            key={t}
            role="tab"
            id={`admin-tab-${t}`}
            aria-controls="admin-tab-panel"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(event) => {
              const tabs = ["library", "people", "permissions", "suggestions"];
              const index = tabs.indexOf(t);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              document.getElementById(`admin-tab-${tabs[next]}`)?.click();
              document.getElementById(`admin-tab-${tabs[next]}`)?.focus();
            }}
            className={tab === t ? "selected" : ""}
            onClick={() => {
              setSelectedUser(null);
              onTab(t);
              if (t === "suggestions") void loadSuggestions();
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="admin-tab-panel"
        aria-labelledby={`admin-tab-${tab}`}
        tabIndex={0}
      >
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
                <Checkbox
                  label="Re-read all files and generate metadata suggestions"
                  checked={full}
                  onChange={(e) => setFull(e.target.checked)}
                />
                <button
                  className="primary"
                  disabled={
                    loading || scans.some((s) => s.status === "running")
                  }
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
                MusicBrainz and Cover Art Archive can suggest catalog changes.
                Set METADATA_USER_AGENT with contact information on the server.
                Enable this, then run a full scan to include existing files.
              </p>
              <Checkbox
                label="Enable external lookups"
                checked={enrichment}
                disabled={loading}
                onChange={(e) =>
                  void perform(() =>
                    api("/admin/settings", "PUT", {
                      enrichment: e.target.checked,
                    }),
                  )
                }
              />
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
                      username: String(f.get("username")).trim().toLowerCase(),
                      displayName: f.get("displayName"),
                      password: f.get("password"),
                      admin: f.get("admin") === "on",
                    });
                    form.reset();
                  });
                }}
              >
                <label>
                  Display name
                  <input
                    name="displayName"
                    required
                    maxLength={120}
                    autoComplete="nickname"
                  />
                </label>
                <label>
                  Username
                  <input
                    name="username"
                    required
                    maxLength={120}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => {
                      e.currentTarget.value =
                        e.currentTarget.value.toLowerCase();
                    }}
                  />
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
                <Checkbox
                  name="admin"
                  label="Administrator"
                  description="Can manage listeners, library scans, and instance settings."
                  disabled={loading}
                />
                <button className="primary" disabled={loading}>
                  Create account
                </button>
              </form>
            </div>
            <div className="panel">
              <h2>Listeners</h2>
              {users.map((u) => (
                <button
                  className="user-row user-select"
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                >
                  <UserAvatar user={u} />
                  <span>
                    <strong>{u.displayName}</strong>
                    <small>@{u.username}</small>
                  </span>
                  {u.admin && <span className="badge">admin</span>}
                  <span className="user-edit-label">Manage</span>
                </button>
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
                <button
                  className="primary"
                  disabled={loading || !groups.length}
                >
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
            <TrackMetadataEditor
              revision={suggestionRevision}
              onSuggestions={() => loadSuggestions()}
            />
            <div className="panel">
              <h2>Review changes</h2>
              <fieldset className="bulk-review" disabled={loading}>
                <legend>Fields to accept</legend>
                <div className="bulk-review-fields">
                  {Object.entries(reviewFields).map(([field, label]) => (
                    <Checkbox
                      key={field}
                      label={label}
                      checked={acceptFields.includes(field)}
                      onChange={(event) => {
                        setBulkNotice("");
                        setAcceptFields((current) =>
                          event.target.checked
                            ? [...current, field]
                            : current.filter((value) => value !== field),
                        );
                      }}
                    />
                  ))}
                </div>
                <div className="row bulk-review-actions">
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => {
                      setAcceptFields(Object.keys(reviewFields));
                      setBulkNotice("");
                    }}
                  >
                    Select all fields
                  </button>
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => {
                      setAcceptFields([]);
                      setBulkNotice("");
                    }}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!acceptFields.length || !suggestions.length}
                    onClick={() =>
                      void perform(async () => {
                        setBulkNotice("");
                        const result = await api<{ accepted: number }>(
                          "/admin/suggestions/accept-all",
                          "POST",
                          { fields: acceptFields },
                        );
                        setBulkNotice(
                          `${result.accepted} ${result.accepted === 1 ? "change" : "changes"} accepted.`,
                        );
                        await loadSuggestions();
                      })
                    }
                  >
                    {loading ? "Working…" : "Accept all selected fields"}
                  </button>
                </div>
                <p className="muted">
                  Applies to all pending changes in these fields, including
                  those not loaded below. If a song has conflicting changes for
                  one field, the newest wins.
                </p>
              </fieldset>
              {bulkNotice && (
                <p className="bulk-review-notice" role="status">
                  {bulkNotice}
                </p>
              )}
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
                          → {s.value || "(empty)"}
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
                  No pending suggestions. Run a full scan to check existing
                  music.
                </p>
              )}
              {more && (
                <button
                  className="load-more"
                  disabled={loading}
                  onClick={() => void loadSuggestions(suggestionOffset + 100)}
                >
                  Load more
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
