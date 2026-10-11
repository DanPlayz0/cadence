// SPDX-License-Identifier: GPL-2.0-or-later
export const soulseekAudioFormats = [
  "flac",
  "wav",
  "m4a",
  "mp3",
  "aac",
  "ogg",
  "opus",
] as const;
export type SoulseekDownloadPolicy = {
  losslessOnly: boolean;
  allowedFormats: string[];
};
export type SoulseekCapabilities = SoulseekDownloadPolicy & {
  configured: boolean;
  enabled: boolean;
  allowed: boolean;
  presentation: "separate";
};
export type SoulseekRule = {
  subject: string;
  mode: "review" | "auto";
  libraryId: string;
  folder: string;
};
export type SoulseekSettings = SoulseekDownloadPolicy & {
  enabled: boolean;
  users: string[];
  groups: string[];
  presentation: "separate";
  reviewTiming: "before" | "after";
  default: SoulseekRule;
  userRules: SoulseekRule[];
  groupRules: SoulseekRule[];
  sharing: "disabled" | "selected" | "imported";
  shareFolders: string[];
  sharingError: string;
};
export type SoulseekFile = {
  filename: string;
  size: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  length?: number;
};
export type SoulseekResult = SoulseekFile & {
  username: string;
  folder: string;
  queueLength: number;
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
};
export type SoulseekSearch = {
  id: string;
  state: string;
  results: SoulseekResult[];
};
export type SoulseekRequest = {
  downloadPolicy?: SoulseekDownloadPolicy;
  id: string;
  userId: string;
  username: string;
  folder: string;
  files: (SoulseekFile & {
    state: string;
    bytesTransferred: number;
    placeInQueue?: number;
  })[];
  rule: SoulseekRule;
  reviewTiming: "before" | "after";
  approved: boolean;
  state: string;
  error: string;
  created: string;
};
export type SoulseekAdminSettings = {
  settings: SoulseekSettings;
  configured: boolean;
  writableRoots: string[];
  staging: string;
};
export function fileName(path: string) {
  return path.replaceAll("\\", "/").split("/").pop() || path;
}
// getRandomValues also works on HTTP LAN deployments where randomUUID is absent.
export function requestID() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function fileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
export function requestProgress(request: SoulseekRequest) {
  const total = request.files.reduce((n, f) => n + f.size, 0);
  return total
    ? Math.min(
        100,
        Math.round(
          (request.files.reduce(
            (n, f) => n + Math.max(0, f.bytesTransferred),
            0,
          ) /
            total) *
            100,
        ),
      )
    : 0;
}
export function stateLabel(state: string) {
  const labels: Record<string, string> = {
    review_before: "Awaiting download approval",
    review_after: "Awaiting import approval",
    queued: "Waiting to start",
    downloading: "Downloading",
    importing: "Importing into library",
    imported: "Added to library",
    failed: "Transfer failed",
    blocked: "Import needs attention",
    cancelling: "Cancelling",
    cancelled: "Cancelled",
    rejected: "Rejected",
    deleted: "Staging deleted",
  };
  return labels[state] || state;
}
