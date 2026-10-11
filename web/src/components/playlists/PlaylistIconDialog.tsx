// SPDX-License-Identifier: GPL-2.0-or-later
import { Form } from "../ui/form";
import { useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { PlaylistIcon } from "./PlaylistIcon";
import { PlaylistIconPicker } from "./PlaylistIconPicker";

export function PlaylistIconDialog({
  name,
  initialIcon,
  onClose,
  onSave,
}: {
  name: string;
  initialIcon: string;
  onClose: () => void;
  onSave: (icon: string) => Promise<void>;
}) {
  const [icon, setIcon] = useState(initialIcon || "music");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent busy={busy} className="playlist-dialog">
        <div className="row dialog-heading">
          <DialogTitle>Change playlist icon</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a new icon for {name}.
          </DialogDescription>
          <Button
            type="button"
            variant="ghost"
            aria-label="Close icon dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </div>
        <Form
          className="playlist-create"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await onSave(icon);
              onClose();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not update playlist icon.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="playlist-preview">
            <PlaylistIcon name={icon} size={36} />
            <span>{name}</span>
          </div>
          <PlaylistIconPicker value={icon} onChange={setIcon} disabled={busy} />
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <div className="row dialog-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
