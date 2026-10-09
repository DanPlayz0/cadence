// SPDX-License-Identifier: GPL-2.0-or-later
export function canMoveQueueItem(
  index: number,
  direction: number,
  current: number,
  length: number,
) {
  const target = index + direction;
  return (
    Number.isInteger(index) &&
    (direction === -1 || direction === 1) &&
    index >= 0 &&
    index < length &&
    target >= 0 &&
    target < length &&
    (current < 0 || (index > current && target > current))
  );
}
