// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { volumeDb, volumeGain } from "./volume";

describe("perceptual volume", () => {
  it("mutes at zero and never amplifies above unity", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(-1)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(2)).toBe(1);
  });
  it("maps equal slider steps to equal dB steps and gain ratios", () => {
    expect(volumeDb(0.5)).toBe(-30);
    expect(volumeGain(0.5)).toBeCloseTo(0.0316228);
    expect(volumeGain(0.8) / volumeGain(0.7)).toBeCloseTo(
      volumeGain(0.7) / volumeGain(0.6),
    );
    expect(volumeGain(0.9)).toBeCloseTo(0.501187);
  });
});
