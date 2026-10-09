// SPDX-License-Identifier: GPL-2.0-or-later
type Entry = { blob: Blob; url: string; trackId: string };
export class SessionCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private maxBytes = 256 * 1024 * 1024,
    private createURL = (b: Blob) => URL.createObjectURL(b),
    private revokeURL = (u: string) => URL.revokeObjectURL(u),
  ) {}
  get(key: string) {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value?.url;
  }
  has(trackId: string) {
    return [...this.entries.values()].some((e) => e.trackId === trackId);
  }
  keys() {
    return [...new Set([...this.entries.values()].map((e) => e.trackId))];
  }
  put(key: string, trackId: string, blob: Blob) {
    if (blob.size > this.maxBytes) return false;
    this.remove(key);
    while (this.bytes + blob.size > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.remove(oldest);
    }
    this.entries.set(key, { blob, url: this.createURL(blob), trackId });
    this.bytes += blob.size;
    return true;
  }
  private remove(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    this.revokeURL(e.url);
    this.bytes -= e.blob.size;
    this.entries.delete(key);
  }
  retain(allowed: Set<string>) {
    for (const [key, e] of this.entries)
      if (!allowed.has(e.trackId)) this.remove(key);
  }
  clear() {
    for (const key of this.entries.keys()) this.remove(key);
  }
  get size() {
    return this.bytes;
  }
}
export async function completeBlob(
  res: Response,
  maxBytes = 256 * 1024 * 1024,
): Promise<Blob> {
  if (!res.ok || res.status === 206) throw new Error("Full audio required");
  const size = Number(res.headers.get("Content-Length"));
  if (size > maxBytes) throw new Error("Audio exceeds session cache");
  if (!res.body) throw new Error("Audio unavailable");
  const reader = res.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Audio exceeds session cache");
      parts.push(new Uint8Array(value));
    }
  } catch (err) {
    await reader.cancel();
    throw err;
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts, {
    type: res.headers.get("Content-Type") ?? "audio/mpeg",
  });
}
