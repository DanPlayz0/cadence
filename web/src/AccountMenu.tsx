// SPDX-License-Identifier: GPL-2.0-or-later
import { useRef, useState } from "react";
import {
  ChevronDown,
  Headphones,
  ListMusic,
  LogOut,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import type { User } from "./api";

import type { Quality } from "./player";
import { QualitySelect, VolumeControl } from "./PlaybackControls";
import { volumeLabel } from "./volume";
import { AccountEditor } from "./AccountEditor";
import { UserAvatar } from "./UserAvatar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import { Checkbox } from "./Checkbox";
import type { useMiniPlayer } from "./MiniPlayer";

export function AccountMenu({
  user,
  quality,
  volume,
  offline,
  miniPlayer,
  hasTrack,
  onQuality,
  onVolume,
  onAdmin,
  onQueue,
  onLogout,
  onUpdated,
  onExpired,
}: {
  user: User;
  quality: Quality;
  volume: number;
  offline: boolean;
  miniPlayer: ReturnType<typeof useMiniPlayer>;
  hasTrack: boolean;
  onQuality: (quality: Quality) => void;
  onVolume: (volume: number) => void;
  onAdmin: () => void;
  onQueue: () => void;
  onLogout: () => Promise<void>;
  onUpdated: (user: User) => void;
  onExpired: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingBusy, setEditingBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"profile" | "settings">("profile");
  const trigger = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  function closeMenu() {
    setOpen(false);
  }
  function showPanel(next: "profile" | "settings") {
    closeMenu();
    setPanel(next);
    setProfileOpen(next === "profile");
    setDialogOpen(true);
  }

  return (
    <div className="account">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            ref={trigger}
            className="account-trigger"
            aria-label={`Account menu for ${user.displayName}`}
          >
            <UserAvatar user={user} />
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="account-menu"
          align="end"
          aria-label="Account"
          onCloseAutoFocus={(event) => {
            if (dialogOpen) event.preventDefault();
          }}
        >
          <DropdownMenuLabel className="account-summary">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => showPanel("profile")}>
            <UserRound size={17} /> Your profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => showPanel("settings")}>
            <Headphones size={17} /> Listening settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              closeMenu();
              onQueue();
            }}
          >
            <ListMusic size={17} /> Play queue
          </DropdownMenuItem>
          {user.admin && (
            <DropdownMenuItem
              onSelect={() => {
                closeMenu();
                onAdmin();
              }}
            >
              <Settings size={17} /> Instance settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={busy}
            onSelect={async () => {
              setBusy(true);
              try {
                await onLogout();
              } finally {
                setBusy(false);
                closeMenu();
              }
            }}
          >
            <LogOut size={17} /> {busy ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!editingBusy) {
            setDialogOpen(next);
            if (!next) setProfileOpen(false);
          }
        }}
      >
        <DialogContent
          busy={editingBusy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="row dialog-heading">
            <DialogTitle>
              {panel === "profile" ? "Your profile" : "Listening settings"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Manage your profile or listening preferences.
            </DialogDescription>
            <Button
              variant="ghost"
              aria-label="Close account details"
              disabled={editingBusy}
              onClick={() => setDialogOpen(false)}
            >
              <X size={20} />
            </Button>
          </div>
          {panel === "profile" ? (
            profileOpen && (
              <AccountEditor
                user={user}
                onUpdated={onUpdated}
                onRevoked={() => {}}
                onExpired={onExpired}
                onBusy={setEditingBusy}
              />
            )
          ) : (
            <div className="listening-settings">
              <div className="setting-field">
                <span>Playback quality</span>
                <QualitySelect value={quality} onChange={onQuality} />
              </div>
              <div className="setting-field volume-setting">
                <span>Volume · {volumeLabel(volume)}</span>
                <VolumeControl value={volume} onChange={onVolume} />
              </div>
              <Checkbox
                label="Automatically open mini player"
                description={
                  miniPlayer.supported
                    ? "Keep controls visible when you switch tabs while music plays. Your browser must allow automatic picture-in-picture for this site. Saved in this browser."
                    : "This browser does not support floating Document picture-in-picture controls. System media controls are still available."
                }
                checked={miniPlayer.enabled}
                disabled={!miniPlayer.supported}
                onChange={(event) =>
                  miniPlayer.setEnabled(event.target.checked)
                }
              />
              {miniPlayer.supported && (
                <Button
                  variant="ghost"
                  disabled={!hasTrack}
                  onClick={() => void miniPlayer.open()}
                >
                  Open mini player
                </Button>
              )}
              {miniPlayer.error && <p role="alert">{miniPlayer.error}</p>}
              <p className="muted">
                Changes apply immediately in this tab. High and Saver require a
                server connection for conversion.
              </p>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!editingBusy) {
                setDialogOpen(false);
                setProfileOpen(false);
              }
            }}
          >
            <Button disabled={editingBusy}>Done</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
