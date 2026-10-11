// SPDX-License-Identifier: GPL-2.0-or-later
export function artistNames(credit: string): string[] {
  const names = [
    ...new Set(
      credit
        .split(/,|\s+(?:feat\.?|ft\.?|featuring)\s+/i)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  return names.length ? names : ["Unknown artist"];
}
