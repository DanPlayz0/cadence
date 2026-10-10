// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Shield,
  Trash2,
  LayoutDashboard,
  Library,
  Users,
  LockKeyhole,
  Tags,
  Activity,
  Plus,
  X,
  Pencil,
} from "lucide-react";
import { api, User } from "./api";
import { Checkbox } from "./Checkbox";
import { UserEditorDialog } from "./AccountEditor";
import { UserAvatar } from "./UserAvatar";
import { TrackMetadataEditor } from "./TrackMetadataEditor";
import { SuggestionReview } from "./SuggestionReview";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
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
const sections = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "An overview of your music server.",
  },
  {
    id: "library",
    label: "Libraries",
    icon: Library,
    description: "Manage folders and scan your collection.",
  },
  {
    id: "people",
    label: "Users",
    icon: Users,
    description: "Create accounts and manage listeners.",
  },
  {
    id: "permissions",
    label: "Groups",
    icon: LockKeyhole,
    description: "Manage groups and library exclusions.",
  },
  {
    id: "metadata",
    label: "Metadata",
    icon: Tags,
    description: "Configure external metadata providers.",
  },
  {
    id: "suggestions",
    label: "Metadata review",
    icon: Tags,
    description: "Review and apply catalog changes.",
  },
  {
    id: "activity",
    label: "Scan activity",
    icon: Activity,
    description: "View scans and reported issues.",
  },
];
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
  const [creatingUser, setCreatingUser] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  useEffect(() => {
    setSelectedUser(null);
    setCreatingUser(false);
  }, [tab]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [enrichment, setEnrichment] = useState(false);
  const [loading, setLoading] = useState(false);
  const [full, setFull] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
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
      <div className="admin-layout">
        <nav className="admin-navigation" aria-label="Server administration">
          <div className="admin-navigation-title">
            <Shield size={20} /> Administration
          </div>
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              className={tab === id ? "selected" : ""}
              onClick={() => {
                setSelectedUser(null);
                onTab(id);
                if (id === "suggestions") void loadSuggestions();
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">INSTANCE SETTINGS</p>
              <h1 tabIndex={-1}>
                {sections.find((section) => section.id === tab)?.label}
              </h1>
              <p className="subtitle">
                {sections.find((section) => section.id === tab)?.description}
              </p>
            </div>
            {tab === "people" && (
              <button
                className="add-user-button"
                aria-label="Add user"
                onClick={() => setCreatingUser(true)}
              >
                <Plus size={22} />
              </button>
            )}
          </div>
          {tab === "dashboard" && (
            <>
              <div className="admin-overview">
                {[
                  {
                    label: "Music folders",
                    value: roots.length,
                    target: "library",
                  },
                  { label: "Listeners", value: users.length, target: "people" },
                  {
                    label: "User groups",
                    value: groups.length,
                    target: "permissions",
                  },
                ].map((item) => (
                  <button
                    className="admin-stat"
                    key={item.label}
                    onClick={() => onTab(item.target)}
                  >
                    <strong>{item.value.toLocaleString()}</strong>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="panel">
                <h2>Library status</h2>
                <p>
                  {scans.some((scan) => scan.status === "running")
                    ? "A library scan is in progress."
                    : "No library scan is running."}
                </p>
                {scans[0] && (
                  <p className="muted">
                    Latest scan: {scans[0].status.replaceAll("_", " ")} ·{" "}
                    {scans[0].indexed.toLocaleString()} files indexed ·{" "}
                    {new Date(scans[0].started).toLocaleString()}
                  </p>
                )}
                <div className="row">
                  <button className="primary" onClick={() => onTab("library")}>
                    <RefreshCw size={16} /> Manage library
                  </button>
                  <button onClick={() => onTab("activity")}>
                    View scan activity
                  </button>
                </div>
              </div>
              <div className="panel">
                <h2>Metadata providers</h2>
                <p className="muted">
                  External lookups are {enrichment ? "enabled" : "disabled"}.
                  Review suggested changes before applying them to your catalog.
                </p>
                <div className="row">
                  <button onClick={() => onTab("metadata")}>
                    Configure metadata
                  </button>
                  <button
                    onClick={() => {
                      onTab("suggestions");
                      void loadSuggestions();
                    }}
                  >
                    Review changes
                  </button>
                </div>
              </div>
            </>
          )}
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
                    disabled={missingOnly}
                    onChange={(e) => setFull(e.target.checked)}
                  />
                  <Checkbox
                    label="Rescan only missing metadata or artwork"
                    description="Recheck tracks with missing titles, artists, albums, album artists, or artwork, plus new files. Complete tracks are skipped."
                    checked={missingOnly}
                    onChange={(e) => {
                      setMissingOnly(e.target.checked);
                      if (e.target.checked) setFull(false);
                    }}
                  />
                  <button
                    className="primary"
                    disabled={
                      loading || scans.some((s) => s.status === "running")
                    }
                    onClick={() =>
                      void perform(() =>
                        api("/admin/scans", "POST", { full, missingOnly }),
                      )
                    }
                  >
                    <RefreshCw size={16} /> Scan library
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === "metadata" && (
            <>
              <div className="panel">
                <h2>Optional metadata enrichment</h2>
                <p className="muted">
                  MusicBrainz and Cover Art Archive can suggest catalog changes.
                  Set METADATA_USER_AGENT with contact information on the
                  server. Enable this, then rescan missing metadata or run a
                  full scan to include existing files.
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
            </>
          )}
          {tab === "activity" && (
            <>
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
              <Dialog
                open={creatingUser}
                onOpenChange={(open) => {
                  if (!loading) setCreatingUser(open);
                }}
              >
                <DialogContent busy={loading}>
                  <div className="row dialog-heading">
                    <DialogTitle>Add user</DialogTitle>
                    <button
                      aria-label="Close add user"
                      disabled={loading}
                      onClick={() => setCreatingUser(false)}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <DialogDescription>
                    Create an account for a new listener.
                  </DialogDescription>
                  <form
                    className="admin-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      void perform(async () => {
                        await api("/admin/users", "POST", {
                          username: String(f.get("username"))
                            .trim()
                            .toLowerCase(),
                          displayName: f.get("displayName"),
                          password: f.get("password"),
                          admin: f.get("admin") === "on",
                        });
                        form.reset();
                        setCreatingUser(false);
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
                </DialogContent>
              </Dialog>
              <div className="listener-grid">
                {users.map((u) => (
                  <button
                    type="button"
                    className="listener-card"
                    key={u.id}
                    aria-label={`Manage ${u.displayName} (@${u.username})`}
                    onClick={() => setSelectedUser(u)}
                  >
                    <span className="listener-card-portrait">
                      <UserAvatar user={u} fallback="icon" />
                    </span>
                    <span className="listener-card-footer">
                      <span className="listener-card-details">
                        <strong>{u.displayName}</strong>
                        <small>@{u.username}</small>
                        <span className="listener-card-role">
                          {u.admin ? (
                            <>
                              <Shield size={14} /> Administrator
                            </>
                          ) : (
                            "Listener"
                          )}
                        </span>
                      </span>
                      <Pencil size={18} aria-hidden="true" />
                    </span>
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
                      await api("/admin/groups", "POST", {
                        name: f.get("name"),
                      });
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
                        {groups.find((g) => g.id === e.groupId)?.name} ·{" "}
                        {e.kind}
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
                <p className="muted">
                  Choose metadata for a song to compare all of its pending
                  sources and replace individual fields.
                </p>
                <details className="bulk-review-section">
                  <summary>Bulk accept by field</summary>
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
                      those not loaded below. If a song has conflicting changes
                      for one field, the newest wins.
                    </p>
                  </fieldset>
                </details>
                {bulkNotice && (
                  <p className="bulk-review-notice" role="status">
                    {bulkNotice}
                  </p>
                )}
                <SuggestionReview
                  suggestions={suggestions}
                  busy={loading}
                  onApplied={() => loadSuggestions()}
                  onDismiss={(id) =>
                    void perform(async () => {
                      await api(`/admin/suggestions/${id}/resolve`, "POST", {
                        accept: false,
                      });
                      await loadSuggestions();
                    })
                  }
                />
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
      </div>
    </section>
  );
}
