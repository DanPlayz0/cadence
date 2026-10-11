// SPDX-License-Identifier: GPL-2.0-or-later
import type { usePlayer } from "../../hooks/usePlayer";
import { Button } from "../ui/button";

export function PlaybackStatus({
  player,
}: {
  player: ReturnType<typeof usePlayer>;
}) {
  const block = player.blocked;
  return (
    <>
      {player.sourceLabel && (
        <div className="playback-source" role="status">
          {player.sourceLabel}
        </div>
      )}
      {block && (
        <div
          className="playback-block"
          role="alert"
          aria-label="Lossless playback paused"
        >
          <p>
            <strong>{player.current?.title}</strong>
            {" — "}
            {block.reason === "mp3"
              ? "This track is MP3. Lossless requires a FLAC, ALAC, or PCM source."
              : block.reason === "unsupported"
                ? "Your browser could not play this original audio. Check the connection, try another browser, or change playback quality."
                : "This track has a lossy or unknown codec. Change playback quality to play it."}
          </p>
          <div className="playback-block-actions">
            {block.reason === "mp3" && (
              <>
                <Button onClick={() => player.resolveBlocked(block, "track")}>
                  Allow this track
                </Button>
                <Button onClick={() => player.resolveBlocked(block, "session")}>
                  Allow MP3 fallback this session
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => player.resolveBlocked(block, "skip")}
            >
              Skip track
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
