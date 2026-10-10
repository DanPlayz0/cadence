// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { requestID, requestProgress, type SoulseekRequest } from "./soulseek";
describe("Soulseek transfers", () => {
  it("generates request keys on HTTP deployments without crypto.randomUUID", () => {
    const a = requestID();
    expect(a).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(requestID()).not.toBe(a);
  });
  it("weights album progress by file size and bounds remote counters", () => {
    const request = {
      files: [
        { size: 100, bytesTransferred: 100 },
        { size: 900, bytesTransferred: 0 },
      ],
    } as SoulseekRequest;
    expect(requestProgress(request)).toBe(10);
    request.files[1].bytesTransferred = 10000;
    expect(requestProgress(request)).toBe(100);
    expect(requestProgress({ files: [] } as unknown as SoulseekRequest)).toBe(
      0,
    );
  });
});
