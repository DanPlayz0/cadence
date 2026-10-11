// SPDX-License-Identifier: GPL-2.0-or-later
import { Form } from "../ui/form";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { X } from "lucide-react";
import { PlaylistIcon } from "./PlaylistIcon";
import { PlaylistIconPicker } from "./PlaylistIconPicker";
export { PlaylistIcon } from "./PlaylistIcon";

export function PlaylistDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("music");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setIcon("music");
      setError("");
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent busy={busy} className="playlist-dialog">
        <div className="row dialog-heading">
          <DialogTitle>Create playlist</DialogTitle>
          <DialogDescription className="sr-only">
            Name your playlist and choose its icon.
          </DialogDescription>
          <Button
            variant="ghost"
            aria-label="Close playlist dialog"
            disabled={busy}
            onClick={() => onClose()}
          >
            <X size={20} />
          </Button>
        </div>
        <Form
          className="playlist-create"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !name.trim()) return;
            setBusy(true);
            setError("");
            try {
              await onCreate(name.trim(), icon);
              onClose();
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
            <Input
              autoFocus
              required
              maxLength={120}
              value={name}
              disabled={busy}
              placeholder="e.g. Late nights"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <PlaylistIconPicker
            key={String(open)}
            value={icon}
            onChange={setIcon}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <div className="row dialog-actions">
            <Button
              variant="ghost"
              type="button"
              className="subtle"
              disabled={busy}
              onClick={() => onClose()}
            >
              Cancel
            </Button>
            <Button disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create playlist"}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
