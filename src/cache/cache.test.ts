import { describe, expect, it } from "vitest";
import { Cache } from "./cache.js";

describe("Cache", () => {
  it("returns undefined for a key that was never set", () => {
    const cache = new Cache<string, number>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns the stored value within the TTL window", () => {
    const cache = new Cache<string, number>({ ttlMs: 1000 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("has() reflects presence of an unexpired key and absence of a missing key", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("missing")).toBe(false);
  });

  it("expires entries after ttlMs using the injected clock", () => {
    let t = 0;
    const cache = new Cache<string, number>({ ttlMs: 1000, now: () => t });
    cache.set("a", 1);
    t = 1000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
  });

  it("is present right up to the expiry boundary and gone at it", () => {
    let t = 0;
    const cache = new Cache<string, number>({ ttlMs: 1000, now: () => t });
    cache.set("a", 1);
    t = 999;
    expect(cache.get("a")).toBe(1);
    t = 1000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("never expires when ttlMs is omitted", () => {
    let t = 0;
    const cache = new Cache<string, number>({ now: () => t });
    cache.set("a", 1);
    t += 10 * 365 * 24 * 60 * 60 * 1000; // +10 years
    expect(cache.get("a")).toBe(1);
  });

  it("does not let one key's expiry affect another", () => {
    let t = 0;
    const cache = new Cache<string, number>({ ttlMs: 1000, now: () => t });
    cache.set("a", 1);
    t = 500;
    cache.set("b", 2);
    t = 1000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });
});
