// SPDX-License-Identifier: GPL-2.0-or-later
import { api, type Page, type Track } from "../services/api";

export async function playlistTracks(
  playlistId: string,
  stillCurrent: () => boolean,
  fetchPage: typeof api = api,
): Promise<Track[] | null> {
  const tracks: Track[] = [];
  while (stillCurrent()) {
    const params = new URLSearchParams({
      playlist: playlistId,
      limit: "500",
      offset: String(tracks.length),
    });
    const page = await fetchPage<Page>(`/tracks?${params}`);
    if (!stillCurrent()) return null;
    tracks.push(...page.items);
    if (tracks.length >= page.total) return tracks;
    if (!page.items.length)
      throw new Error("The playlist changed while loading. Try again.");
  }
  return null;
}
