// SPDX-License-Identifier: GPL-2.0-or-later
import { Button } from "../ui/button";
import { Form } from "../ui/form";
import { Input } from "../ui/input";
import { useCallback, useEffect, useState } from "react";
import { Folder, Plus, Pencil, Trash2, X, ChevronRight } from "lucide-react";
import { api, User } from "../../services/api";
import { Checkbox } from "../ui/Checkbox";
import { broaderOverlaps, MusicLibrary } from "../../lib/libraries";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";

type FolderPage = {
  path: string;
  parent: string;
  items: { name: string; path: string }[];
  total: number;
  offset: number;
};

export function LibraryManager({
  users,
  groups,
  onChanged,
}: {
  users: User[];
  groups: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [libraries, setLibraries] = useState<MusicLibrary[]>([]);
  const [draft, setDraft] = useState<MusicLibrary | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<FolderPage | null>(null);
  const [folderError, setFolderError] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setLibraries(await api<MusicLibrary[]>("/admin/libraries"));
      setLoaded(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    setPage(null);
    setFolderError("");
    void api<FolderPage>(
      `/admin/folders?${new URLSearchParams({ path: folderPath, limit: "50", offset: String(offset) })}`,
    )
      .then((value) => {
        if (live) setPage(value);
      })
      .catch((e) => {
        if (live) setFolderError(e.message);
      });
    return () => {
      live = false;
    };
  }, [!!draft, folderPath, offset]);

  function open(value: MusicLibrary) {
    setDraft({
      ...value,
      folders: [...value.folders],
      users: [...value.users],
      groups: [...value.groups],
    });
    setFolderPath("");
    setOffset(0);
    setError("");
  }
  function browse(path: string) {
    setFolderPath(path);
    setOffset(0);
  }
  function addFolder(path: string) {
    setDraft(
      (value) =>
        value && { ...value, folders: [...new Set([...value.folders, path])] },
    );
  }
  function toggle(kind: "users" | "groups", id: string) {
    setDraft(
      (value) =>
        value && {
          ...value,
          [kind]: value[kind].includes(id)
            ? value[kind].filter((item) => item !== id)
            : [...value[kind], id],
        },
    );
  }
  const overlaps = draft ? broaderOverlaps(draft, libraries) : [];
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const { id, ...body } = draft;
      await api(
        `/admin/libraries${id ? `/${encodeURIComponent(id)}` : ""}`,
        id ? "PUT" : "POST",
        body,
      );
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/libraries/${encodeURIComponent(id)}`, "DELETE");
      setDeleting(null);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel library-manager">
      <div className="row">
        <h2>Libraries</h2>
        <Button
          variant="ghost"
          className="primary"
          disabled={!loaded || busy}
          onClick={() =>
            open({
              id: "",
              name: "",
              folders: [],
              everyone: false,
              users: [],
              groups: [],
            })
          }
        >
          <Plus size={16} /> Add library
        </Button>
      </div>
      <p className="muted">
        Choose folders from mounted storage and share each library with
        listeners. Folder changes request an incremental scan. Music files stay
        read-only.
      </p>
      {error && !draft && (
        <p role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      {loaded && libraries.length === 0 && (
        <p>
          Create your first library to start scanning music. New libraries are
          accessible to administrators until you share them.
        </p>
      )}
      {libraries.map((value) => (
        <article className="library-card" key={value.id}>
          <div className="row">
            <h3>{value.name}</h3>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`Edit ${value.name}`}
              onClick={() => open(value)}
            >
              <Pencil size={16} />
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`Delete ${value.name}`}
              onClick={() => setDeleting(value.id)}
            >
              <Trash2 size={16} />
            </Button>
          </div>
          {value.folders.map((path) => (
            <code key={path}>{path}</code>
          ))}
          <p className="muted">
            {value.everyone
              ? "Shared with everyone"
              : `${value.users.length} users · ${value.groups.length} groups · Administrators`}
          </p>
          {value.name === "Existing music" && value.everyone && (
            <p className="muted">
              This library preserves access from before library setup. Narrow
              its folders or remove sharing with everyone before making this
              music private.
            </p>
          )}
          {deleting === value.id && (
            <div role="alert">
              <p>
                Remove this library and its sharing? Music files and saved
                catalog data will be preserved.
              </p>
              <div className="row">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void remove(value.id)}
                >
                  Remove library
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </article>
      ))}
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(null);
        }}
      >
        <DialogContent className="library-editor" busy={busy}>
          <DialogTitle>
            {draft?.id ? "Edit library" : "Add library"}
          </DialogTitle>
          <DialogDescription>
            Select music folders and who can listen. Administrators can access
            every library; group exclusions still apply.
          </DialogDescription>
          {draft && (
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={busy}>
                <label htmlFor="music-library-name">Library name</label>
                <Input
                  id="music-library-name"
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  autoFocus
                />
                <h3>Selected folders</h3>
                {!draft.folders.length && (
                  <p className="muted">
                    Select at least one folder below. All descendants are
                    included.
                  </p>
                )}
                {draft.folders.map((path) => (
                  <div className="row" key={path}>
                    <code>{path}</code>
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={`Remove folder ${path}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          folders: draft.folders.filter((p) => p !== path),
                        })
                      }
                    >
                      <X size={16} />
                    </Button>
                  </div>
                ))}
                <h3>Browse mounted folders</h3>
                <p className="muted">
                  Only storage shared with the server is shown. If a drive or
                  folder is missing, mount it in Docker and recreate the app,
                  then return here to choose your music folders.
                </p>
                <div className="row">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => browse("")}
                  >
                    Mounted storage
                  </Button>
                  {folderPath && (
                    <>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => browse(page?.parent || "")}
                      >
                        Up
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={!page}
                        onClick={() => addFolder(page!.path)}
                      >
                        Add this folder
                      </Button>
                    </>
                  )}
                </div>
                {folderPath && <code>{folderPath}</code>}
                {folderError && <p role="alert">{folderError}</p>}
                {!page && !folderError && <p role="status">Loading folders…</p>}
                <div className="folder-picker">
                  {page?.items.map((folder) => (
                    <div className="row" key={`${folder.path}:${folder.name}`}>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => browse(folder.path)}
                      >
                        <Folder size={16} />
                        <span>{folder.name}</span>
                        <ChevronRight size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={draft.folders.includes(folder.path)}
                        onClick={() => addFolder(folder.path)}
                      >
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
                {page && page.total === 0 && (
                  <p className="muted">
                    No subfolders. You can select the current folder.
                  </p>
                )}
                {page && page.total > 50 && (
                  <div className="row">
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 50))}
                    >
                      Previous
                    </Button>
                    <span>
                      {offset + 1}–{Math.min(offset + 50, page.total)} of{" "}
                      {page.total}
                    </span>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={offset + 50 >= page.total}
                      onClick={() => setOffset(offset + 50)}
                    >
                      Next
                    </Button>
                  </div>
                )}
                <h3>Sharing</h3>
                <Checkbox
                  label="Everyone"
                  description="Includes current and future listeners."
                  checked={draft.everyone}
                  onChange={(event) =>
                    setDraft({ ...draft, everyone: event.target.checked })
                  }
                />
                {!draft.everyone && (
                  <div className="library-recipients">
                    <div>
                      <h4>Users</h4>
                      {users
                        .filter((user) => !user.admin)
                        .map((user) => (
                          <Checkbox
                            key={user.id}
                            label={user.displayName || user.username}
                            checked={draft.users.includes(user.id)}
                            onChange={() => toggle("users", user.id)}
                          />
                        ))}
                    </div>
                    <div>
                      <h4>Groups</h4>
                      {groups.map((group) => (
                        <Checkbox
                          key={group.id}
                          label={group.name}
                          checked={draft.groups.includes(group.id)}
                          onChange={() => toggle("groups", group.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {overlaps.length > 0 && (
                  <p className="library-warning" role="status">
                    Overlapping music is also shared through{" "}
                    {overlaps.map((other) => other.name).join(", ")}. Restrict
                    those libraries too if this music should be private.
                  </p>
                )}
              </fieldset>
              {error && <p role="alert">{error}</p>}
              <div className="row">
                <Button
                  variant="ghost"
                  className="primary"
                  disabled={busy || !draft.name.trim() || !draft.folders.length}
                >
                  {busy ? "Saving…" : "Save library"}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
              </div>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
