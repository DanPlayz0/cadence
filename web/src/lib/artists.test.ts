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
    "Earth & Wind",
    "Guest",
  ]);
  expect(artistNames("  , , ")).toEqual(["Unknown artist"]);
});

it.each([
  "feat.",
  "feat",
  "ft.",
  "ft",
  "featuring",
  "FEAT.",
  "Ft",
  "FeAtUrInG",
])("splits featuring marker %s into separate artists", (marker) => {
  expect(artistNames(`Alec Benjamin ${marker} Alessia Cara`)).toEqual([
    "Alec Benjamin",
    "Alessia Cara",
  ]);
});

it("preserves order and deduplicates mixed credits with whitespace", () => {
  expect(
    artistNames(
      " Alec Benjamin\tfeat.\tAlessia Cara, Alec Benjamin featuring Guest ft. Alessia Cara, , ",
    ),
  ).toEqual(["Alec Benjamin", "Alessia Cara", "Guest"]);
});

it("preserves band names and requires whitespace around featuring markers", () => {
  for (const name of [
    "AC/DC",
    "Florence & the Machine",
    "Dan + Shay",
    "Earth Wind and Fire",
    "Little Feat",
    "feat. Guest",
    "A feat.",
    "Afeat. B",
    "A feat.B",
  ]) {
    expect(artistNames(name)).toEqual([name]);
  }
});
