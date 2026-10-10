// SPDX-License-Identifier: GPL-2.0-or-later
export type LyricLine = { time: number; text: string };
export type Lyrics = {
  found: boolean;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
  source: string;
};

export function parseLRC(source: string): LyricLine[] {
  const offset =
    Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines: LyricLine[] = [];
  for (const row of source.split(/\r?\n/)) {
    const times = [
      ...row.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g),
    ];
    const text = row
      .replace(/\[[^\]]*\]/g, "")
      .replace(/<\d+:\d+(?:\.\d+)?>/g, "")
      .trim();
    for (const stamp of times) {
      lines.push({
        time: Math.max(
          0,
          Number(stamp[1]) * 60 +
            Number(stamp[2]) +
            Number(`0.${stamp[3] || 0}`) -
            offset,
        ),
        text,
      });
      if (lines.length >= 5000) return lines.sort((a, b) => a.time - b.time);
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
export function activeLyric(lines: LyricLine[], position: number): number {
  let low = 0,
    high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
