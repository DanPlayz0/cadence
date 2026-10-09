// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from "vitest";
import { canMoveQueueItem } from "./queue";
it("keeps history and the current song fixed while allowing upcoming reordering", () => {
  expect(canMoveQueueItem(2, -1, 1, 4)).toBe(false);
  expect(canMoveQueueItem(1, 1, 1, 4)).toBe(false);
  expect(canMoveQueueItem(0, 1, 1, 4)).toBe(false);
  expect(canMoveQueueItem(3, -1, 1, 4)).toBe(true);
  expect(canMoveQueueItem(2, 1, 1, 4)).toBe(true);
  expect(canMoveQueueItem(3, 1, 1, 4)).toBe(false);
  expect(canMoveQueueItem(1, -1, -1, 4)).toBe(true);
});
