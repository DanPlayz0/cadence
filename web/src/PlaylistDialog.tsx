// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
import {
  Disc3,
  Headphones,
  Heart,
  Moon,
  Music2,
  Sparkles,
  X,
} from "lucide-react";

const icons = {
  music: Music2,
  heart: Heart,
  headphones: Headphones,
  disc: Disc3,
  sparkles: Sparkles,
  moon: Moon,
};
export function PlaylistIcon({
  name,
  size = 19,
}: {
  name?: string;
  size?: number;
}) {
  const Icon = icons[name as keyof typeof icons] || Music2;
  return <Icon size={size} aria-hidden="true" />;
}

export function PlaylistDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("music");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setIcon("music");
      setError("");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      className="account-dialog playlist-dialog"
      ref={dialog}
      aria-labelledby="playlist-dialog-title"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <div className="row dialog-heading">
        <h2 id="playlist-dialog-title">Create playlist</h2>
        <button
          aria-label="Close playlist dialog"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <form
        className="playlist-create"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          setError("");
          try {
            await onCreate(name.trim(), icon);
            dialog.current?.close();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not create playlist.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="playlist-preview">
          <PlaylistIcon name={icon} size={36} />
          <span>{name.trim() || "Your next mix"}</span>
        </div>
        <label>
          Playlist name
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            disabled={busy}
            placeholder="e.g. Late nights"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset disabled={busy}>
          <legend>Choose an icon</legend>
          <div className="playlist-icons">
            {Object.keys(icons).map((value) => (
              <label key={value} className={value === icon ? "selected" : ""}>
                <input
                  type="radio"
                  name="playlist-icon"
                  value={value}
                  checked={value === icon}
                  onChange={() => setIcon(value)}
                />
                <PlaylistIcon name={value} size={22} />
                <span>{value}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <div className="row dialog-actions">
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create playlist"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
