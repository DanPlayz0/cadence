// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from "vitest";
import { parseLRC, activeLyric } from "./lyrics";

it("parses repeated timestamps, offsets, enhanced tags and blank instrumental breaks", () => {
  const lines = parseLRC(
    "[ar:Artist]\n[offset:500]\n[00:02.50][00:10.500]First <00:03.00>line\n[00:05]\n[00:61]invalid\n[00:01.2]Early",
  );
  expect(lines).toEqual([
    { time: 0.7, text: "Early" },
    { time: 2, text: "First line" },
    { time: 4.5, text: "" },
    { time: 10, text: "First line" },
  ]);
  expect(activeLyric(lines, 0)).toBe(-1);
  expect(activeLyric(lines, 2)).toBe(1);
  expect(activeLyric(lines, 11)).toBe(3);
  expect(activeLyric(lines, 0.8)).toBe(0);
});
it("handles duplicate timestamps, missing sync and seeking backwards", () => {
  const lines = parseLRC("[00:01]One\n[00:01]Two\n[00:03]Three");
  expect(activeLyric(lines, 1)).toBe(1);
  expect(activeLyric(lines, 4)).toBe(2);
  expect(activeLyric(lines, 2)).toBe(1);
  expect(parseLRC("Plain lyrics only")).toEqual([]);
  expect(activeLyric([], 20)).toBe(-1);
});
