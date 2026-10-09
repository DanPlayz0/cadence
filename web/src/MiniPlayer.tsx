// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Music2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { cover, duration } from "./api";
import type { usePlayer } from "./player";
import { VolumeControl } from "./PlaybackControls";
import { ArtistLinks } from "./ArtistLinks";

type Player = ReturnType<typeof usePlayer>;
type PiP = {
  requestWindow: (options: {
    width: number;
    height: number;
  }) => Promise<Window>;
};
type RequestDetails = { reason?: string };

function preference(userID: string | undefined) {
  try {
    return (
      !userID || localStorage.getItem(`cadence:auto-pip:${userID}`) !== "false"
    );
  } catch {
    return true;
  }
}

export function useMiniPlayer(player: Player, userID: string | undefined) {
  const pip = (window as Window & { documentPictureInPicture?: PiP })
    .documentPictureInPicture;
  const supported = !!pip && window.isSecureContext;
  const [choice, setChoice] = useState(() => ({
    userID,
    enabled: preference(userID),
  }));
  const enabled =
    choice.userID === userID ? choice.enabled : preference(userID);
  const [target, setTarget] = useState<Window | null>(null);
  const [error, setError] = useState("");
  const active = useRef<{ window: Window; automatic: boolean } | null>(null);
  const pending = useRef(false);
  const dismissed = useRef(false);
  const latest = useRef({ player, userID, enabled });
  latest.current = { player, userID, enabled };

  const close = useCallback(() => {
    active.current?.window.close();
    active.current = null;
    setTarget(null);
  }, []);
  const setEnabled = (value: boolean) => {
    setChoice({ userID, enabled: value });
    try {
      if (userID)
        localStorage.setItem(`cadence:auto-pip:${userID}`, String(value));
    } catch {
      // Keep the preference for this session when browser storage is unavailable.
    }
    if (!value && active.current?.automatic) close();
  };

  const open = useCallback(
    async (automatic = false) => {
      const current = latest.current;
      if (!current.userID || !current.player.current || pending.current) return;
      if (
        automatic &&
        (!supported ||
          !current.enabled ||
          !current.player.playing ||
          !document.hidden ||
          dismissed.current)
      )
        return;
      if (active.current && !active.current.window.closed) {
        if (!automatic) active.current.window.focus();
        return;
      }
      pending.current = true;
      setError("");
      try {
        // Called directly by a click or Media Session's activation-bearing callback.
        // Open the HTTP/browser fallback synchronously to preserve click activation.
        const mini =
          supported && pip
            ? await pip.requestWindow({ width: 360, height: 280 })
            : window.open(
                "",
                "cadence-mini-player",
                "popup,width=360,height=280",
              );
        if (!mini) {
          setError(
            "The mini player popout was blocked. Allow popups for this site and try again.",
          );
          return;
        }
        const now = latest.current;
        if (
          now.userID !== current.userID ||
          !now.player.current ||
          (automatic &&
            (!now.enabled || !now.player.playing || !document.hidden))
        ) {
          mini.close();
          return;
        }
        mini.document.title = "Cadence mini player";
        mini.document.head.replaceChildren();
        mini.document.body.replaceChildren();
        for (const style of document.querySelectorAll(
          'style, link[rel="stylesheet"]',
        )) {
          const copy = style.cloneNode(true) as HTMLElement;
          if (style instanceof HTMLLinkElement)
            (copy as HTMLLinkElement).href = style.href;
          mini.document.head.appendChild(copy);
        }
        mini.document.body.classList.add("mini-player-body");
        active.current = { window: mini, automatic };
        mini.addEventListener(
          "pagehide",
          () => {
            if (active.current?.window !== mini) return;
            if (automatic && document.hidden) dismissed.current = true;
            active.current = null;
            setTarget(null);
          },
          { once: true },
        );
        setTarget(mini);
      } catch {
        if (!automatic && latest.current.userID === current.userID)
          setError(
            supported
              ? "Could not open the mini player. Check this site's picture-in-picture permission in your browser."
              : "Could not open the mini player popout. Allow popups for this site and try again.",
          );
      } finally {
        pending.current = false;
      }
    },
    [pip, supported],
  );

  useEffect(() => {
    const visible = () => {
      if (!document.hidden) {
        dismissed.current = false;
        if (active.current?.automatic) close();
      }
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", close);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pagehide", close);
    };
  }, [close]);
  useEffect(() => {
    if (
      !supported ||
      !userID ||
      !player.current ||
      !enabled ||
      !("mediaSession" in navigator)
    )
      return;
    const action = "enterpictureinpicture" as MediaSessionAction;
    try {
      navigator.mediaSession.setActionHandler(
        action,
        (details: MediaSessionActionDetails & RequestDetails) => {
          void open(details.reason === "contentoccluded" || document.hidden);
        },
      );
    } catch {
      // Some Document PiP browsers do not support automatic Media Session requests.
      return;
    }
    return () => {
      navigator.mediaSession.setActionHandler(action, null);
    };
  }, [supported, userID, !!player.current, enabled, open]);
  useEffect(() => {
    if (!player.current) close();
  }, [!!player.current, close]);
  useEffect(() => {
    setError("");
    dismissed.current = false;
    return close;
  }, [userID, close]);

  return {
    supported,
    popoutHelp: !window.isSecureContext
      ? "This HTTP address uses a regular popout window. Native always-on-top and automatic picture-in-picture require HTTPS or localhost."
      : !supported
        ? "This browser uses a regular popout window because native Document picture-in-picture is unavailable."
        : "",
    enabled,
    setEnabled,
    open,
    close,
    target,
    error,
    clearError: () => setError(""),
  };
}

export function MiniPlayer({
  player,
  target,
  onClose,
  onArtist,
}: {
  player: Player;
  target: Window | null;
  onClose: () => void;
  onArtist: (name: string) => void;
}) {
  const [failedCover, setFailedCover] = useState("");
  if (!target || !player.current) return null;
  const track = player.current;
  return createPortal(
    <main className="mini-player" aria-label="Cadence mini player">
      <div className="mini-player-heading">
        <span>CADENCE</span>
        <button aria-label="Close mini player" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="mini-player-track">
        <div className="mini-player-art">
          {track.artwork && failedCover !== track.id ? (
            <img
              src={new URL(cover(track.id), location.origin).href}
              alt=""
              onError={() => setFailedCover(track.id)}
            />
          ) : (
            <Music2 size={28} />
          )}
        </div>
        <div>
          <strong title={track.title}>{track.title}</strong>
          <ArtistLinks credit={track.artist} onNavigate={onArtist} />
        </div>
      </div>
      <div className="mini-player-controls">
        <button aria-label="Previous track" onClick={() => player.next(true)}>
          <SkipBack size={21} />
        </button>
        <button
          className="primary mini-player-play"
          aria-label={player.playing ? "Pause" : "Play"}
          onClick={player.toggle}
        >
          {player.playing ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button aria-label="Next track" onClick={() => player.next()}>
          <SkipForward size={21} />
        </button>
      </div>
      <div className="mini-player-seek">
        <span>{duration(player.position)}</span>
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={`${duration(player.position)} of ${duration(player.length)}`}
          min={0}
          max={player.length || 0}
          step={1}
          value={Math.min(player.position, player.length || 0)}
          disabled={!player.length}
          onChange={(event) => player.seek(Number(event.target.value))}
        />
        <span>{duration(player.length)}</span>
      </div>
      <VolumeControl value={player.volume} onChange={player.setVolume} />
    </main>,
    target.document.body,
  );
}
