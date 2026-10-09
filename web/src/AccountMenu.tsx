// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
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

export function AccountMenu({
  user,
  quality,
  volume,
  offline,
  onQuality,
  onVolume,
  onAdmin,
  onQueue,
  onLogout,
}: {
  user: User;
  quality: Quality;
  volume: number;
  offline: boolean;
  onQuality: (quality: Quality) => void;
  onVolume: (volume: number) => void;
  onAdmin: () => void;
  onQueue: () => void;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"profile" | "settings">("profile");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function closeMenu() {
    setOpen(false);
    trigger.current?.focus();
  }
  function showPanel(next: "profile" | "settings") {
    closeMenu();
    setPanel(next);
    dialog.current?.showModal();
  }

  return (
    <div className="account" ref={root}>
      <button
        ref={trigger}
        className="account-trigger"
        aria-label={`Account menu for ${user.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="user-avatar">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="account-menu"
          id="account-menu"
          role="menu"
          aria-label="Account"
          ref={menu}
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeMenu();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          <div className="account-summary" role="presentation">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
          <button role="menuitem" onClick={() => showPanel("profile")}>
            <UserRound size={17} /> Your profile
          </button>
          <button role="menuitem" onClick={() => showPanel("settings")}>
            <Headphones size={17} /> Listening settings
          </button>
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              onQueue();
            }}
          >
            <ListMusic size={17} /> Play queue
          </button>
          {user.admin && (
            <button
              role="menuitem"
              onClick={() => {
                closeMenu();
                onAdmin();
              }}
            >
              <Settings size={17} /> Instance settings
            </button>
          )}
          <button
            role="menuitem"
            disabled={busy}
            onClick={async () => {
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
          </button>
        </div>
      )}
      <dialog
        className="account-dialog"
        ref={dialog}
        aria-labelledby="account-title"
        onClose={() => trigger.current?.focus()}
      >
        <div className="row dialog-heading">
          <h2 id="account-title">
            {panel === "profile" ? "Your profile" : "Listening settings"}
          </h2>
          <button
            aria-label="Close account details"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        {panel === "profile" ? (
          <>
            <div className="profile-identity">
              <span className="user-avatar">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{user.displayName}</strong>
                <p>@{user.username}</p>
              </div>
            </div>
            <dl className="profile-details">
              <div>
                <dt>Account</dt>
                <dd>{user.admin ? "Administrator" : "Listener"}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  {offline ? "Offline session" : "Connected to your instance"}
                </dd>
              </div>
            </dl>
            <p className="muted">
              Your account is managed by this music instance's administrator.
            </p>
          </>
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
            <p className="muted">
              Changes apply immediately in this tab. High and Saver require a
              server connection for conversion.
            </p>
          </div>
        )}
        <form method="dialog">
          <button className="primary">Done</button>
        </form>
      </dialog>
    </div>
  );
}
