// SPDX-License-Identifier: GPL-2.0-or-later
import { Button } from "../ui/button";
import { FileUpload } from "../ui/file-upload";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import {
  CollapsibleContent,
  Collapsible,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { useEffect, useRef, useState } from "react";
import { Pencil, Camera, X } from "lucide-react";
import { api, APIError, uploadAvatar, type User } from "../../services/api";
import { Checkbox } from "../ui/Checkbox";
import { UserAvatar } from "./UserAvatar";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

type Group = { id: string; name: string };
type EditorProps = {
  user: User;
  adminMode?: boolean;
  groups?: Group[];
  onUpdated: (user: User) => void;
  onRevoked: (id: string) => void;
  onExpired: () => void;
  onBusy: (busy: boolean) => void;
};

export function AccountEditor({
  user,
  adminMode = false,
  groups = [],
  onUpdated,
  onRevoked,
  onExpired,
  onBusy,
}: EditorProps) {
  const [account, setAccount] = useState(user);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [administrator, setAdministrator] = useState(user.admin);
  const [groupIDs, setGroupIDs] = useState(user.groups || []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [confirmAvatar, setConfirmAvatar] = useState(false);
  const [dragging, setDragging] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingName) nameInput.current?.focus();
  }, [editingName]);
  useEffect(() => setAccount(user), [user]);
  const path = adminMode
    ? `/admin/users/${encodeURIComponent(account.id)}`
    : "/me";
  function updated(next: User) {
    setAccount(next);
    onUpdated(next);
  }
  async function run(action: string, work: () => Promise<string>) {
    if (busy) return;
    setBusy(action);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await work());
    } catch (error) {
      if (error instanceof APIError && error.status === 401) onExpired();
      else
        setError(
          error instanceof Error ? error.message : "Could not save changes.",
        );
    } finally {
      setBusy("");
      onBusy(false);
    }
  }
  function saveAvatar(file?: File) {
    if (!file || busy) return;
    void run("avatar", async () => {
      updated(await uploadAvatar(`${path}/avatar`, file));
      setConfirmAvatar(false);
      return "Avatar updated.";
    });
  }
  return (
    <div className="account-editor" aria-busy={!!busy}>
      <div className="profile-identity">
        <Button
          variant="ghost"
          type="button"
          className={`avatar-edit ${dragging ? "dragging" : ""}`}
          disabled={!!busy}
          aria-label={account.avatar ? "Manage avatar" : "Upload avatar"}
          title={
            account.avatar
              ? "Manage avatar or drop a replacement"
              : "Choose or drop a JPEG or PNG, up to 2 MiB"
          }
          onClick={() =>
            account.avatar
              ? setConfirmAvatar(true)
              : avatarInput.current?.click()
          }
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            saveAvatar(event.dataTransfer.files[0]);
          }}
        >
          <UserAvatar user={account} />
          <Camera
            size={15}
            className="avatar-edit-indicator"
            aria-hidden="true"
          />
        </Button>
        <FileUpload
          ref={avatarInput}

          aria-label="Avatar file"
          accept="image/jpeg,image/png"
          disabled={!!busy}
          onChange={(event) => {
            saveAvatar(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <div className="profile-name">
          {editingName ? (
            <Input
              ref={nameInput}
              form="account-details"
              aria-label="Display name"
              value={displayName}
              required
              maxLength={120}
              autoComplete="nickname"
              disabled={!!busy}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          ) : (
            <Button
              variant="ghost"
              type="button"
              className="name-edit"
              disabled={!!busy}
              aria-label="Edit display name"
              onClick={() => {
                setDisplayName(account.displayName);
                setEditingName(true);
              }}
            >
              <strong>{account.displayName}</strong>
              <Pencil size={14} aria-hidden="true" />
            </Button>
          )}
          <p>@{account.username}</p>
          <small>{account.admin ? "Administrator" : "Listener"}</small>
          {editingName && !adminMode && (
            <div className="inline-edit-actions">
              <Button
                variant="ghost"
                form="account-details"
                className="primary"
                disabled={!!busy || !displayName.trim()}
              >
                {busy === "details" ? "Saving…" : "Save name"}
              </Button>
              <Button
                variant="ghost"
                type="button"
                className="subtle"
                disabled={!!busy}
                onClick={() => {
                  setDisplayName(account.displayName);
                  setEditingName(false);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
      {confirmAvatar && (
        <div className="avatar-confirm">
          <p>Remove this avatar and return to initials?</p>
          <div className="inline-edit-actions">
            <Button
              variant="ghost"
              type="button"
              className="subtle"
              disabled={!!busy}
              onClick={() =>
                void run("avatar", async () => {
                  updated(await api<User>(`${path}/avatar`, "DELETE"));
                  setConfirmAvatar(false);
                  return "Avatar removed.";
                })
              }
            >
              Remove avatar
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="subtle"
              disabled={!!busy}
              onClick={() => avatarInput.current?.click()}
            >
              Replace
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="subtle"
              disabled={!!busy}
              onClick={() => setConfirmAvatar(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="auth-error editor-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="editor-feedback" role="status">
          {notice}
        </p>
      )}
      <Form
        id="account-details"
        className={adminMode ? "" : "profile-details-form"}
        onSubmit={(event) => {
          event.preventDefault();
          void run("details", async () => {
            const next = await api<User>(path, "PUT", {
              displayName,
              ...(adminMode
                ? {
                    username: username.trim().toLowerCase(),
                    groups: groupIDs,
                    admin: administrator,
                  }
                : {}),
            });
            updated(next);
            setDisplayName(next.displayName);
            setUsername(next.username);
            setGroupIDs(next.groups || []);
            setAdministrator(next.admin);
            setEditingName(false);
            return adminMode
              ? "User details, role, and groups saved."
              : "Profile saved.";
          });
        }}
      >
        {adminMode && (
          <fieldset disabled={!!busy}>
            <legend>Account details</legend>
            {adminMode && (
              <>
                <label>
                  Username
                  <Input
                    value={username}
                    required
                    maxLength={120}
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) =>
                      setUsername(event.target.value.toLowerCase())
                    }
                  />
                </label>
                <Checkbox
                  label="Administrator"
                  description="Can manage users, groups, library scans, and instance settings."
                  checked={administrator}
                  onChange={(event) => setAdministrator(event.target.checked)}
                />
                <fieldset className="editor-groups">
                  <legend>Groups</legend>
                  {groups.length ? (
                    groups.map((group) => (
                      <Checkbox
                        key={group.id}
                        label={group.name}
                        checked={groupIDs.includes(group.id)}
                        onChange={(event) =>
                          setGroupIDs((current) =>
                            event.target.checked
                              ? [...current, group.id]
                              : current.filter((id) => id !== group.id),
                          )
                        }
                      />
                    ))
                  ) : (
                    <p className="muted">
                      Create a group on the Groups page to assign it here.
                    </p>
                  )}
                </fieldset>
              </>
            )}
            <Button
              variant="ghost"
              className="primary"
              disabled={
                !displayName.trim() || (adminMode && !username.trim()) || !!busy
              }
            >
              {busy === "details"
                ? "Saving…"
                : adminMode
                  ? "Save user"
                  : "Save profile"}
            </Button>
          </fieldset>
        )}
      </Form>
      <Collapsible className="password-settings">
        <CollapsibleTrigger>
          {adminMode ? "Reset password" : "Change password"}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                fields = new FormData(form);
              const password = String(fields.get("password")),
                confirm = String(fields.get("confirmPassword"));
              void run("password", async () => {
                if (password !== confirm)
                  throw new Error("New passwords do not match.");
                if (
                  [...password].length < 3 ||
                  new TextEncoder().encode(password).length > 72
                )
                  throw new Error(
                    "Use a password of at least 3 characters, up to 72 bytes.",
                  );
                await api(`${path}/password`, "POST", {
                  password,
                  ...(!adminMode
                    ? { currentPassword: fields.get("currentPassword") }
                    : {}),
                });
                form.reset();
                if (adminMode) onRevoked(account.id);
                return adminMode
                  ? "Password reset. All sessions for this user were signed out."
                  : "Password changed. Your other sessions were signed out.";
              });
            }}
          >
            <fieldset disabled={!!busy}>
              {!adminMode && (
                <label>
                  Current password
                  <Input
                    name="currentPassword"
                    type="password"
                    required
                    maxLength={72}
                    autoComplete="current-password"
                  />
                </label>
              )}
              <label>
                New password
                <Input
                  name="password"
                  type="password"
                  required
                  minLength={3}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm new password
                <Input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={3}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </label>
              <p className="muted">
                {adminMode
                  ? "Resetting the password signs out all of this user's sessions."
                  : "Enter your current password to confirm. This session stays signed in."}
              </p>
              <Button variant="ghost" className="primary" disabled={!!busy}>
                {busy === "password"
                  ? "Updating…"
                  : adminMode
                    ? "Reset password"
                    : "Change password"}
              </Button>
            </fieldset>
          </Form>
        </CollapsibleContent>
      </Collapsible>
      {adminMode && (
        <fieldset disabled={!!busy}>
          <legend>Sessions</legend>
          <p className="muted">
            Sign this user out on all devices. They can sign in again with their
            password.
          </p>
          <Button
            variant="ghost"
            className="subtle"
            onClick={() =>
              void run("sessions", async () => {
                await api(`${path}/sessions`, "DELETE");
                onRevoked(account.id);
                return "All sessions revoked.";
              })
            }
          >
            {busy === "sessions" ? "Revoking…" : "Revoke sessions"}
          </Button>
        </fieldset>
      )}
    </div>
  );
}

export function UserEditorDialog({
  user,
  groups,
  onUpdated,
  onRevoked,
  onExpired,
  onClose,
}: Omit<EditorProps, "onBusy" | "adminMode"> & {
  groups: Group[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="user-editor-dialog"
        busy={busy}
        aria-describedby={undefined}
      >
        <div className="row dialog-heading">
          <DialogTitle asChild>
            <h2>Manage user</h2>
          </DialogTitle>
          <Button
            variant="ghost"
            aria-label="Close user editor"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </div>
        <AccountEditor
          user={user}
          adminMode
          groups={groups}
          onUpdated={onUpdated}
          onRevoked={onRevoked}
          onExpired={onExpired}
          onBusy={setBusy}
        />
        <div className="row">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
