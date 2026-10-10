import { describe, it, expect, vi } from "vitest";
import { SessionCache, completeBlob } from "./cache";
describe("session audio cache", () => {
  it("evicts least recently used complete files within the cap", () => {
    const revoke = vi.fn();
    let n = 0;
    const c = new SessionCache(6, () => `blob:${++n}`, revoke);
    c.put("a", "1", new Blob(["aaa"]));
    c.put("b", "2", new Blob(["bbb"]));
    c.get("a");
    c.put("c", "3", new Blob(["ccc"]));
    expect(c.keys()).toEqual(["1", "3"]);
    expect(c.size).toBe(6);
    expect(revoke).toHaveBeenCalledWith("blob:2");
    expect(c.put("large", "4", new Blob(["toolarge"]))).toBe(false);
  });
  it("purges exclusions and logout data", () => {
    const revoke = vi.fn();
    const c = new SessionCache(10, () => "blob:x", revoke);
    c.put("a", "1", new Blob(["a"]));
    c.put("b", "2", new Blob(["b"]));
    c.retain(new Set(["2"]));
    expect(c.keys()).toEqual(["2"]);
    c.clear();
    expect(c.size).toBe(0);
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it("rejects partial responses and oversized bodies", async () => {
    await expect(
      completeBlob(new Response("abc", { status: 206 })),
    ).rejects.toThrow();
    await expect(completeBlob(new Response("abcdef"), 3)).rejects.toThrow();
    expect((await completeBlob(new Response("abc"))).size).toBe(3);
  });
});
