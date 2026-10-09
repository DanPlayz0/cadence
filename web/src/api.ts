// SPDX-License-Identifier: GPL-2.0-or-later
export type User = {
  id: string;
  username: string;
  displayName: string;
  admin: boolean;
  groups?: string[];
  avatar: boolean;
  avatarVersion: number;
};
export type Track = {
  id: string;
  title: string;
  artist: string;
  albumArtist?: string;
  album?: string;
  albumId?: string;
  single?: boolean;
  number: number;
  disc: number;
  year: string;
  genre: string;
  duration: number;
  codec: string;
  mime: string;
  artwork: boolean;
  liked: boolean;
};
export type Album = {
  id: string;
  title: string;
  artist: string;
  tracks: number;
  coverId: string;
};
export type Artist = { name: string; tracks: number };
export type Playlist = { id: string; name: string; icon: string };
export type Page = {
  items: Track[];
  total: number;
  limit: number;
  offset: number;
};
export type Session = { user: User; csrf: string };
let csrf = "";
export function setSession(s: Session | null) {
  csrf = s?.csrf ?? "";
}
export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  keepalive = false,
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    keepalive,
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res
    .json()
    .catch(() => ({ error: "Invalid server response" }));
  if (!res.ok) throw new APIError(res.status, data.error || "Request failed");
  return data as T;
}
export function cover(id: string) {
  return `/api/v1/tracks/${encodeURIComponent(id)}/art`;
}

export async function uploadAvatar(path: string, file: File): Promise<User> {
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Choose an image under 2 MiB.");
  const res = await fetch(`/api/v1${path}`, {
    method: "PUT",
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-CSRF-Token": csrf,
    },
    body: file,
  });
  const data = await res
    .json()
    .catch(() => ({ error: "Invalid server response" }));
  if (!res.ok)
    throw new APIError(res.status, data.error || "Could not upload avatar.");
  return data as User;
}
export function stream(id: string, quality: string) {
  return `/api/v1/tracks/${encodeURIComponent(id)}/stream?quality=${quality}`;
}
export function duration(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
