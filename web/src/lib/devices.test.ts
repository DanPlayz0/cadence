// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { describeClient } from "./devices";
describe("client identification", () => {
  it("recognizes browsers without mistaking Chromium variants for Chrome", () => {
    const chrome =
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.1 Safari/537.36";
    expect(describeClient(chrome)).toEqual({
      name: "Chrome",
      version: "140.0.1",
      platform: "Windows",
    });
    expect(describeClient(chrome + " Edg/140.0.2").name).toBe("Edge");
    expect(describeClient(chrome + " OPR/120.1").name).toBe("Opera");
    expect(
      describeClient("Mozilla/5.0 (Android) Chrome/130.0 SamsungBrowser/28.0")
        .name,
    ).toBe("Samsung Internet");
    expect(
      describeClient("Mozilla/5.0 (iPhone) FxiOS/140.0 Mobile Safari/605.1")
        .name,
    ).toBe("Firefox");
    expect(
      describeClient("Mozilla/5.0 (Macintosh) Version/18.1 Safari/605.1"),
    ).toEqual({ name: "Safari", version: "18.1", platform: "macOS" });
  });
  it("preserves non-browser product versions and handles missing agents", () => {
    expect(describeClient("MusicApp/2.4.1 (Android)")).toEqual({
      name: "MusicApp",
      version: "2.4.1",
      platform: "Android",
    });
    expect(describeClient("").name).toBe("Unknown client");
    expect(describeClient("custom device").name).toBe("Other client");
  });
});
