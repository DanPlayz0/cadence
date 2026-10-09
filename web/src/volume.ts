// SPDX-License-Identifier: GPL-2.0-or-later
// Equal slider steps are equal dB steps; zero is an explicit mute.
export function volumeDb(value: number) {
  return -60 + Math.max(0, Math.min(1, value)) * 60;
}
export function volumeGain(value: number) {
  return value <= 0 ? 0 : 10 ** (volumeDb(value) / 20);
}
export function volumeLabel(value: number) {
  return value <= 0
    ? "Muted"
    : `${Math.round(value * 100)}% · ${volumeDb(value).toFixed(1)} dB`;
}
