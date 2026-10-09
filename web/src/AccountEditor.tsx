// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, APIError, uploadAvatar, type User } from "./api";
import { Checkbox } from "./Checkbox";
import { UserAvatar } from "./UserAvatar";
import { useDialogDismiss } from "./useDialogDismiss";

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
  const [groupIDs, setGroupIDs] = useState(user.groups || []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  return (
    <div className="account-editor" aria-busy={!!busy}>
      <div className="profile-identity">
        <UserAvatar user={account} />
        <div>
          <strong>{account.displayName}</strong>
          <p>@{account.username}</p>
          <small>{account.admin ? "Administrator" : "Listener"}</small>
        </div>
      </div>
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
      <fieldset disabled={!!busy} className="avatar-settings">
        <legend>Avatar</legend>
        <label>
          Upload avatar
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(event) => {
              const input = event.currentTarget,
                file = input.files?.[0];
              if (!file) return;
              void run("avatar", async () => {
                updated(await uploadAvatar(`${path}/avatar`, file));
                return "Avatar updated.";
              }).finally(() => {
                input.value = "";
              });
            }}
          />
        </label>
        <small>JPEG or PNG, up to 2 MiB. Images are cropped to a square.</small>
        <button
          type="button"
          className="subtle"
          disabled={!account.avatar || !!busy}
          onClick={() =>
            void run("avatar", async () => {
              updated(await api<User>(`${path}/avatar`, "DELETE"));
              return "Avatar removed.";
            })
          }
        >
          {busy === "avatar" ? "Updating avatar…" : "Remove avatar"}
        </button>
      </fieldset>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run("details", async () => {
            const next = await api<User>(path, "PUT", {
              displayName,
              ...(adminMode
                ? { username: username.trim().toLowerCase(), groups: groupIDs }
                : {}),
            });
            updated(next);
            setDisplayName(next.displayName);
            setUsername(next.username);
            setGroupIDs(next.groups || []);
            return adminMode
              ? "User details and groups saved."
              : "Profile saved.";
          });
        }}
      >
        <fieldset disabled={!!busy}>
          <legend>{adminMode ? "Account details" : "Display name"}</legend>
          <label>
            Display name
            <input
              value={displayName}
              required
              maxLength={120}
              autoComplete="nickname"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          {adminMode && (
            <>
              <label>
                Username
                <input
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
                    Create groups in Permissions to assign them here.
                  </p>
                )}
              </fieldset>
            </>
          )}
          <button
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
          </button>
        </fieldset>
      </form>
      <form
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
          <legend>{adminMode ? "Reset password" : "Change password"}</legend>
          {!adminMode && (
            <label>
              Current password
              <input
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
            <input
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
            <input
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
          <button className="primary" disabled={!!busy}>
            {busy === "password"
              ? "Updating…"
              : adminMode
                ? "Reset password"
                : "Change password"}
          </button>
        </fieldset>
      </form>
      {adminMode && (
        <fieldset disabled={!!busy}>
          <legend>Sessions</legend>
          <p className="muted">
            Sign this user out on all devices. They can sign in again with their
            password.
          </p>
          <button
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
          </button>
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const dismiss = useDialogDismiss(busy);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      {...dismiss}
      className="account-dialog user-editor-dialog"
      ref={dialog}
      aria-labelledby="user-editor-title"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <div className="row dialog-heading">
        <h2 id="user-editor-title">Manage user</h2>
        <button
          aria-label="Close user editor"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
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
      <form method="dialog">
        <button className="subtle" disabled={busy}>
          Done
        </button>
      </form>
    </dialog>
  );
}
