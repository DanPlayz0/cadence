// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from "vitest";
import { artistNames } from "./artists";

it("splits comma-separated artists and cleans empty/duplicate credits", () => {
  expect(artistNames("A, B")).toEqual(["A", "B"]);
  expect(artistNames(" A ,B, A, , C\t")).toEqual(["A", "B", "C"]);
  expect(artistNames("AC/DC, 音楽 & Friends")).toEqual([
    "AC/DC",
    "音楽 & Friends",
  ]);
  expect(artistNames("Earth & Wind feat. Guest")).toEqual([
    "Earth & Wind feat. Guest",
  ]);
  expect(artistNames("  , , ")).toEqual(["Unknown artist"]);
});
