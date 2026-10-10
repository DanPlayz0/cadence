// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Users, Download } from "lucide-react";
import { api, APIError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Checkbox } from "../components/ui/Checkbox";
type Profile = {
  name: string;
  mbid: string;
  type: string;
  country: string;
  description: string;
  biography: string;
  image: string;
  imageSource: string;
  wikipedia: string;
  genres: string[];
  links: { label: string; url: string }[];
  warning: string;
  updated: string;
};
export function ArtistProfile({
  artist,
  admin,
  onExpired,
}: {
  artist: string;
  admin: boolean;
  onExpired: () => void;
}) {
  const refreshTrigger = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [avatarURL, setAvatarURL] = useState("");
  const [mbid, setMBID] = useState("");
  const [refreshOpen, setRefreshOpen] = useState(false),
    [missingOnly, setMissingOnly] = useState(true),
    [notice, setNotice] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ profile: Profile | null }>(
      `/artists/profile?artist=${encodeURIComponent(artist)}`,
    )
      .then((data) => {
        if (live) {
          setProfile(data.profile);
          setAvatarURL(data.profile?.image || "");
          setMBID(data.profile?.mbid || "");
        }
      })
      .catch((error) => {
        if (live) {
          if (error instanceof APIError && error.status === 401) onExpired();
          else setError(error.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [artist, onExpired]);
  return (
    <section className="panel artist-profile" aria-label="Artist profile">
      <div className="artist-profile-info">
        {profile?.image && !imageFailed ? (
          <img
            className="artist-profile-photo"
            src={profile.image}
            alt={`${profile.name} artist photo`}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="artist-profile-placeholder">
            <Users size={36} />
          </div>
        )}
        <div>
          <h2>About {profile?.name || artist}</h2>
          {loading ? (
            <p role="status">Loading artist profile…</p>
          ) : profile ? (
            <>
              <p className="muted">
                {[profile.type, profile.country, profile.description]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {profile.genres.length > 0 && (
                <p className="artist-genres">{profile.genres.join(" · ")}</p>
              )}
              {profile.biography ? (
                <p
                  className="artist-biography"
                  tabIndex={0}
                  aria-label="Artist biography"
                >
                  {profile.biography}
                </p>
              ) : (
                <p className="muted">
                  No biography is available for this artist yet.
                </p>
              )}
              <div className="artist-source-links">
                {profile.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
              {profile.wikipedia && (
                <p className="muted artist-attribution">
                  Biography:{" "}
                  <a href={profile.wikipedia} target="_blank" rel="noreferrer">
                    Wikipedia contributors
                  </a>{" "}
                  ·{" "}
                  <a
                    href="https://creativecommons.org/licenses/by-sa/4.0/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CC BY-SA
                  </a>
                  .{" "}
                  {profile.imageSource && (
                    <a
                      href={profile.imageSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Photo credits and license
                    </a>
                  )}
                </p>
              )}
              {profile.warning && (
                <p role="status" className="muted">
                  {profile.warning}
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              {admin
                ? "Fetch this artist’s profile to add facts, genres, source links, and an available biography or photo."
                : "This artist’s profile has not been fetched yet."}
            </p>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {admin && (
        <div className="artist-profile-actions">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const data = await api<{ profile: Profile }>(
                  "/admin/artists/avatar",
                  "PUT",
                  { artist, image: avatarURL },
                );
                setProfile(data.profile);
                setAvatarURL(data.profile.image);
                setImageFailed(false);
                setNotice(
                  "Artist avatar saved. Reopen the artist grid to see it there.",
                );
              } catch (error) {
                if (error instanceof APIError && error.status === 401)
                  onExpired();
                else setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Artist avatar URL
              <Input
                type="url"
                value={avatarURL}
                maxLength={2000}
                placeholder="https://…"
                disabled={loading || busy}
                onChange={(event) => setAvatarURL(event.target.value)}
              />
            </label>
            <Button disabled={loading || busy}>Save avatar</Button>
            <p className="muted">
              Use an HTTPS image URL, or leave blank to remove the avatar.
            </p>
          </form>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const data = await api<{ profile: Profile }>(
                  "/admin/artists/profile",
                  "POST",
                  { artist, mbid },
                );
                setProfile(data.profile);
                setAvatarURL(data.profile?.image || "");
                setMBID(data.profile.mbid);
                setImageFailed(false);
                setNotice("Artist profile updated.");
              } catch (error) {
                if (error instanceof APIError && error.status === 401)
                  onExpired();
                else setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              MusicBrainz artist ID (optional)
              <Input
                value={mbid}
                disabled={busy}
                maxLength={36}
                placeholder="Use an ID to choose a specific artist"
                onChange={(event) => setMBID(event.target.value)}
              />
            </label>
            <Button disabled={loading || busy}>
              <Download size={16} />
              {busy
                ? "Fetching…"
                : profile
                  ? "Update artist profile"
                  : "Fetch artist profile"}
            </Button>
          </form>
          <Button
            variant="outline"
            ref={refreshTrigger}
            disabled={busy}
            onClick={() => {
              setError("");
              setRefreshOpen(true);
            }}
          >
            <RefreshCw size={16} />
            Refresh this artist’s songs
          </Button>
        </div>
      )}
      <Dialog
        open={refreshOpen}
        onOpenChange={(next) => {
          if (!busy) setRefreshOpen(next);
        }}
      >
        <DialogContent
          className="artist-scan-dialog"
          busy={busy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            refreshTrigger.current?.focus();
          }}
        >
          <DialogTitle>Refresh {artist}’s songs</DialogTitle>
          <DialogDescription>
            Re-read metadata and artwork for this artist’s library songs.
            Accepted edits stay preserved. External lookups run if metadata
            enrichment is enabled in Instance settings.
          </DialogDescription>
          <Checkbox
            label="Only songs missing metadata or artwork"
            checked={missingOnly}
            disabled={busy}
            onChange={(event) => setMissingOnly(event.target.checked)}
          />
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="row dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setRefreshOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  await api("/admin/scans", "POST", {
                    artist,
                    full: true,
                    missingOnly,
                  });
                  setRefreshOpen(false);
                  setNotice(
                    "Artist scan started. Follow results and metadata suggestions in Instance settings.",
                  );
                } catch (error) {
                  if (error instanceof APIError && error.status === 401)
                    onExpired();
                  else setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Starting…" : "Start artist scan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
