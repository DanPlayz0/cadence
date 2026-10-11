// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { api, type User } from "../../services/api";
import type { MusicLibrary } from "../../lib/libraries";
import {
  soulseekAudioFormats,
  type SoulseekAdminSettings,
  type SoulseekRule,
  type SoulseekSettings as Settings,
} from "../../lib/soulseek";
import { SoulseekDestination, SoulseekRequests } from "./SoulseekRequests";
import "../../styles/Soulseek.css";

const blankRule: SoulseekRule = {
  subject: "",
  mode: "review",
  libraryId: "",
  folder: "",
};
function RuleEditor({
  rule,
  onChange,
  libraries,
  id,
}: {
  rule: SoulseekRule;
  onChange: (v: SoulseekRule) => void;
  libraries: MusicLibrary[];
  id: string;
}) {
  return (
    <>
      <label>
        Import policy
        <select
          value={rule.mode}
          onChange={(e) =>
            onChange({ ...rule, mode: e.target.value as SoulseekRule["mode"] })
          }
        >
          <option value="review">Require administrator review</option>
          <option value="auto">Automatically import into a library</option>
        </select>
      </label>
      <SoulseekDestination
        id={id}
        rule={rule}
        libraries={libraries}
        onChange={onChange}
      />
      <p className="soulseek-help">
        {rule.mode === "auto"
          ? "A library and writable folder are required. This rule bypasses the default review policy."
          : "Destination is optional; an administrator chooses or confirms it during approval."}
      </p>
    </>
  );
}
function RuleList({
  title,
  rules,
  subjects,
  libraries,
  onChange,
  id,
}: {
  title: string;
  rules: SoulseekRule[];
  subjects: { id: string; name: string }[];
  libraries: MusicLibrary[];
  onChange: (v: SoulseekRule[]) => void;
  id: string;
}) {
  return (
    <section className="soulseek-card">
      <h3>{title}</h3>
      {rules.map((r, i) => (
        <div className="soulseek-rule" key={i}>
          <div className="soulseek-fields">
            <label>
              {id === "groups" ? "Group" : "User"}
              <select
                value={r.subject}
                onChange={(e) =>
                  onChange(
                    rules.map((v, n) =>
                      n === i ? { ...v, subject: e.target.value } : v,
                    ),
                  )
                }
              >
                <option value="">
                  Choose {id === "groups" ? "a group" : "a user"}
                </option>
                {subjects
                  .filter(
                    (s) =>
                      s.id === r.subject ||
                      !rules.some((v) => v.subject === s.id),
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <RuleEditor
              rule={r}
              onChange={(v) =>
                onChange(rules.map((old, n) => (n === i ? v : old)))
              }
              libraries={libraries}
              id={`${id}-${i}`}
            />
          </div>
          <div className="soulseek-actions">
            {id === "groups" && (
              <>
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...rules];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={i === rules.length - 1}
                  onClick={() => {
                    const next = [...rules];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    onChange(next);
                  }}
                >
                  Move down
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onChange(rules.filter((_, n) => n !== i))}
            >
              Remove rule
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={rules.length >= subjects.length}
        onClick={() =>
          onChange([
            ...rules,
            {
              ...blankRule,
              subject:
                subjects.find((s) => !rules.some((r) => r.subject === s.id))
                  ?.id || "",
            },
          ])
        }
      >
        Add {id === "groups" ? "group" : "user"} rule
      </button>
    </section>
  );
}
export function SoulseekSettings() {
  const [info, setInfo] = useState<SoulseekAdminSettings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [libraries, setLibraries] = useState<MusicLibrary[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [shareFolder, setShareFolder] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([
      api<SoulseekAdminSettings>("/admin/soulseek"),
      api<User[]>("/admin/users"),
      api<{ id: string; name: string }[]>("/admin/groups"),
      api<MusicLibrary[]>("/admin/libraries"),
    ])
      .then(([v, u, g, l]) => {
        if (live) {
          setInfo(v);
          setDraft(v.settings);
          setUsers(u);
          setGroups(g);
          setLibraries(l);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  // Refresh synchronization status without replacing unsaved form edits.
  useEffect(() => {
    let live = true;
    const timer = setInterval(() => {
      void api<SoulseekAdminSettings>("/admin/soulseek")
        .then((v) => {
          if (live) setInfo(v);
        })
        .catch(() => {});
    }, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const v = await api<SoulseekAdminSettings>(
        "/admin/soulseek",
        "PUT",
        draft,
      );
      setInfo(v);
      setDraft(v.settings);
      setNotice("Soulseek settings saved.");
      setRevision((n) => n + 1);
      window.dispatchEvent(new Event("cadence-soulseek-settings"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (key: "users" | "groups", id: string, checked: boolean) => {
    if (draft)
      setDraft({
        ...draft,
        [key]: checked
          ? [...draft[key], id]
          : draft[key].filter((v) => v !== id),
      });
  };
  if (!draft || !info)
    return (
      <div className="soulseek">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">Loading Soulseek settings…</p>
        )}
      </div>
    );
  return (
    <div className="soulseek">
      {!info.configured && (
        <p>
          Start the optional slskd container and configure its server
          credentials before enabling Soulseek. See the Soulseek setup guide in
          the repository documentation.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {info.settings.sharingError && (
        <p role="alert">{info.settings.sharingError}</p>
      )}
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy}>
          <section className="soulseek-card">
            <label className="soulseek-row">
              <strong>Enable Soulseek search and downloads</strong>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={!info.configured}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
            </label>
            <div className="soulseek-fields">
              <label>
                Search placement
                <select
                  value={draft.presentation}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      presentation: e.target.value as Settings["presentation"],
                    })
                  }
                >
                  <option value="separate">Separate Find music page</option>
                  <option value="combined">
                    Soulseek section in library search
                  </option>
                </select>
              </label>
              <label>
                Review timing
                <select
                  value={draft.reviewTiming}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reviewTiming: e.target.value as Settings["reviewTiming"],
                    })
                  }
                >
                  <option value="before">Approve before downloading</option>
                  <option value="after">
                    Download first; approve before importing
                  </option>
                </select>
              </label>
            </div>
            <p className="soulseek-help">
              Review timing applies to new requests. Automatic routing rules
              bypass review.
            </p>
          </section>
          <section className="soulseek-card">
            <h3>Download quality</h3>
            <label className="soulseek-row">
              <strong>Lossless audio only</strong>
              <input
                type="checkbox"
                checked={draft.losslessOnly}
                onChange={(e) =>
                  setDraft({ ...draft, losslessOnly: e.target.checked })
                }
              />
            </label>
            <p className="soulseek-help">
              Matches slskd's islossless filter: peers must report both sample
              rate and bit depth. Actual codecs are verified before import.
              Applies only to new requests.
            </p>
            <fieldset>
              <legend>Allowed audio formats</legend>
              <div className="soulseek-checks">
                {soulseekAudioFormats.map((format) => (
                  <label key={format}>
                    <input
                      type="checkbox"
                      checked={draft.allowedFormats.includes(format)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          allowedFormats: e.target.checked
                            ? [...draft.allowedFormats, format]
                            : draft.allowedFormats.filter((f) => f !== format),
                        })
                      }
                    />
                    {format === "m4a"
                      ? "M4A (ALAC or AAC)"
                      : format.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>
            {!draft.allowedFormats.length && (
              <p role="alert">
                Choose at least one allowed audio format before saving.
              </p>
            )}
            <p className="soulseek-help">
              Selected formats must also satisfy the lossless filter when
              enabled. Incorrectly advertised files may download to staging, but
              lossy audio will not be imported.
            </p>
          </section>
          <section className="soulseek-card">
            <h3>Who can search and download</h3>
            <p>
              Administrators always have access when enabled. Select individual
              listeners or groups.
            </p>
            <div className="soulseek-fields">
              <div>
                <h4>Users</h4>
                <div className="soulseek-checks">
                  {users
                    .filter((u) => !u.admin)
                    .map((u) => (
                      <label key={u.id}>
                        <input
                          type="checkbox"
                          checked={draft.users.includes(u.id)}
                          onChange={(e) =>
                            toggle("users", u.id, e.target.checked)
                          }
                        />
                        {u.displayName || u.username}
                      </label>
                    ))}
                </div>
              </div>
              <div>
                <h4>Groups</h4>
                <div className="soulseek-checks">
                  {groups.map((g) => (
                    <label key={g.id}>
                      <input
                        type="checkbox"
                        checked={draft.groups.includes(g.id)}
                        onChange={(e) =>
                          toggle("groups", g.id, e.target.checked)
                        }
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
                {!groups.length && <p>No groups configured.</p>}
              </div>
            </div>
          </section>
          <section className="soulseek-card">
            <h3>Default routing</h3>
            <RuleEditor
              rule={draft.default}
              onChange={(v) => setDraft({ ...draft, default: v })}
              libraries={libraries}
              id="default"
            />
            <p className="soulseek-help">
              Writable roots:{" "}
              {info.writableRoots?.join("; ") || "None configured"}. Changing
              host mounts requires recreating the containers.
            </p>
          </section>
          <p>
            User rules take precedence. Otherwise the first matching group rule
            wins, then the default applies.
          </p>
          <RuleList
            title="User routing overrides"
            rules={draft.userRules}
            subjects={users.map((u) => ({
              id: u.id,
              name: u.displayName || u.username,
            }))}
            libraries={libraries}
            onChange={(v) => setDraft({ ...draft, userRules: v })}
            id="users"
          />
          <RuleList
            title="Group routing overrides, in priority order"
            rules={draft.groupRules}
            subjects={groups}
            libraries={libraries}
            onChange={(v) => setDraft({ ...draft, groupRules: v })}
            id="groups"
          />
          <section className="soulseek-card">
            <h3>Share music on Soulseek</h3>
            <label>
              Sharing mode
              <select
                value={draft.sharing}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sharing: e.target.value as Settings["sharing"],
                  })
                }
              >
                <option value="disabled">Disabled</option>
                <option value="selected">Selected mounted folders</option>
                <option value="imported">
                  Successfully imported downloads only
                </option>
              </select>
            </label>
            <p>
              Shared music becomes available to Soulseek peers independently of
              library listening permissions. slskd must have matching read-only
              mounts. Staging is never shared automatically.
            </p>
            {draft.sharing === "selected" && (
              <>
                <div className="soulseek-search">
                  <input
                    aria-label="Folder to share"
                    list="soulseek-share-folders"
                    value={shareFolder}
                    placeholder="Mounted music folder"
                    onChange={(e) => setShareFolder(e.target.value)}
                  />
                  <datalist id="soulseek-share-folders">
                    {[...new Set(libraries.flatMap((l) => l.folders))].map(
                      (p) => (
                        <option key={p} value={p} />
                      ),
                    )}
                  </datalist>
                  <button
                    type="button"
                    disabled={
                      !shareFolder.trim() ||
                      draft.shareFolders.includes(shareFolder.trim())
                    }
                    onClick={() => {
                      setDraft({
                        ...draft,
                        shareFolders: [
                          ...draft.shareFolders,
                          shareFolder.trim(),
                        ],
                      });
                      setShareFolder("");
                    }}
                  >
                    Add folder
                  </button>
                </div>
                {draft.shareFolders.map((p) => (
                  <div key={p} className="soulseek-row">
                    <p className="soulseek-path">{p}</p>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          shareFolders: draft.shareFolders.filter(
                            (v) => v !== p,
                          ),
                        })
                      }
                    >
                      Remove folder
                    </button>
                  </div>
                ))}
              </>
            )}
          </section>
          <button disabled={busy || !draft.allowedFormats.length} type="submit">
            {busy ? "Saving…" : "Save Soulseek settings"}
          </button>
        </fieldset>
      </form>
      <SoulseekRequests admin revision={revision} />
    </div>
  );
}
