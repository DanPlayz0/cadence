// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { duration } from "./api";
import type { Route } from "./navigation";
import type { usePlayer } from "./player";
import type { usePanelResize } from "./usePanelResize";
import { NowPlaying } from "./MobileMusic";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./LyricsPanel";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";

export function useMobilePlayback() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function PlaybackPanel({
  open,
  onClose,
  mobile,
  tab,
  onTab,
  resize,
  player,
  onArtist,
  onNavigate,
  onAdded,
  onExpired,
  fromNowPlaying = false,
}: {
  open: boolean;
  onClose: () => void;
  mobile: boolean;
  tab: "queue" | "lyrics" | "now";
  onTab: (tab: "queue" | "lyrics" | "now") => void;
  resize: ReturnType<typeof usePanelResize>;
  player: ReturnType<typeof usePlayer>;
  onArtist: (name: string) => void;
  onNavigate: (route: Route) => void;
  onAdded: (title: string) => void;
  onExpired: () => void;
  fromNowPlaying?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const expanded = mobile ? tab === "now" || mobileExpanded : resize.expanded;
  const toggleExpanded = mobile
    ? () => setMobileExpanded((value) => !value)
    : resize.toggleExpanded;
  const title =
    tab === "now" ? "Now Playing" : tab === "queue" ? "Play queue" : "Lyrics";
  useEffect(() => {
    if (!open || !mobile) setMobileExpanded(false);
    else if (fromNowPlaying) setMobileExpanded(true);
  }, [open, mobile, fromNowPlaying]);
  useEffect(() => {
    if (!open || mobile) return;
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open, mobile]);
  useEffect(() => {
    if (!open || !mobile) return;
    const host = document.getElementById("play-queue");
    if (host && !host.contains(document.activeElement))
      host.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open, mobile, tab]);
  const content = (
    <>
      {!mobile && (
        <div
          className="panel-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label={
            resize.mode === "side"
              ? "Resize playback panel width"
              : "Resize playback panel height"
          }
          aria-orientation={resize.mode === "side" ? "vertical" : "horizontal"}
          aria-controls="play-queue"
          aria-valuemin={resize.bounds.min}
          aria-valuemax={resize.bounds.max}
          aria-valuenow={resize.size}
          aria-valuetext={`${Math.round(resize.size)} pixels`}
          title="Drag to resize. Arrow keys resize; Home/End choose minimum/maximum; Enter resets."
          {...resize.handle}
        />
      )}
      <div className="row playback-panel-heading">
        {mobile && fromNowPlaying && tab !== "now" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to Now Playing"
            onClick={() => onTab("now")}
          >
            <ChevronLeft size={20} />
          </Button>
        )}
        {mobile ? (
          <DialogTitle asChild>
            <h2>{title}</h2>
          </DialogTitle>
        ) : (
          <h2>{title}</h2>
        )}
        <div className="playback-panel-actions">
          {tab !== "now" && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                expanded
                  ? "Restore playback panel size"
                  : "Expand playback panel"
              }
              aria-pressed={expanded}
              onClick={toggleExpanded}
              title={expanded ? "Restore size" : "Expand panel"}
            >
              {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              tab === "now"
                ? "Close Now Playing"
                : tab === "queue"
                  ? "Close queue"
                  : "Close lyrics"
            }
            onClick={() => onClose()}
          >
            <X size={20} />
          </Button>
        </div>
      </div>
      {tab !== "now" && (
        <div
          className="playback-tabs"
          role="tablist"
          aria-label="Playback panel"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const next = tab === "queue" ? "lyrics" : "queue";
              onTab(next);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[id="${next}-tab"]`)
                ?.focus();
            }
          }}
        >
          <button
            id="queue-tab"
            role="tab"
            aria-selected={tab === "queue"}
            aria-controls="queue-content"
            tabIndex={tab === "queue" ? 0 : -1}
            onClick={() => onTab("queue")}
          >
            Queue
          </button>
          <button
            id="lyrics-tab"
            role="tab"
            aria-selected={tab === "lyrics"}
            aria-controls="lyrics-content"
            tabIndex={tab === "lyrics" ? 0 : -1}
            onClick={() => onTab("lyrics")}
          >
            Lyrics
          </button>
        </div>
      )}
      {tab === "now" ? (
        <NowPlaying player={player} onArtist={onArtist} onPanel={onTab} />
      ) : tab === "lyrics" ? (
        <div id="lyrics-content" role="tabpanel" aria-labelledby="lyrics-tab">
          <LyricsPanel
            onArtist={onArtist}
            track={player.current}
            position={player.position}
            onSeek={player.seek}
            onExpired={onExpired}
          />
        </div>
      ) : (
        <div id="queue-content" role="tabpanel" aria-labelledby="queue-tab">
          <QueuePanel
            player={player}
            onArtist={onArtist}
            onNavigate={onNavigate}
            onAdded={onAdded}
          />
        </div>
      )}

      {mobile && tab !== "now" && (
        <div
          className="playback-sheet-transport"
          aria-label="Playback controls"
        >
          <div className="controls">
            <button
              aria-label="Previous track"
              disabled={!player.canPrevious}
              onClick={() => player.next(true)}
            >
              <SkipBack size={20} />
            </button>
            <button
              className="play-button"
              aria-label={player.playing ? "Pause" : "Play"}
              disabled={!player.current && !player.canNext}
              onClick={player.toggle}
            >
              {player.playing ? <Pause size={21} /> : <Play size={21} />}
            </button>
            <button
              aria-label="Next track"
              disabled={!player.canNext}
              onClick={() => player.next()}
            >
              <SkipForward size={20} />
            </button>
          </div>
          <div className="timeline">
            <span>{duration(player.position)}</span>
            <input
              type="range"
              aria-label="Seek"
              aria-valuetext={`${duration(player.position)} of ${duration(player.length)}`}
              min={0}
              max={player.length || 1}
              step={0.1}
              value={Math.min(player.position, player.length || 1)}
              disabled={!player.current || !player.length}
              onChange={(event) => player.seek(Number(event.target.value))}
            />
            <span>{duration(player.length)}</span>
          </div>
        </div>
      )}
    </>
  );
  if (mobile)
    return (
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
      >
        <DialogContent
          id="play-queue"
          className={`queue-panel playback-sheet ${expanded ? "playback-sheet-expanded" : ""}`}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            if (document.activeElement instanceof HTMLElement)
              opener.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (
              opener.current?.isConnected &&
              !opener.current.closest("[inert]")
            )
              opener.current.focus();
          }}
        >
          {content}
        </DialogContent>
      </Dialog>
    );
  return open ? (
    <aside
      className="queue-panel"
      id="play-queue"
      ref={panel}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
    >
      {content}
    </aside>
  ) : null;
}
