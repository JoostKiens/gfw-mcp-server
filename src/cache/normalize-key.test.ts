import { describe, expect, it } from "vitest";
import { normalizeKey } from "./normalize-key.js";

describe("normalizeKey", () => {
  it("produces identical output for differently-ordered top-level keys", () => {
    expect(normalizeKey({ a: 1, b: 2 })).toBe(normalizeKey({ b: 2, a: 1 }));
  });

  it("produces identical output for differently-ordered nested object keys", () => {
    const first = { region: { id: "eez-1", dataset: "public" }, datasets: ["x"] };
    const second = { region: { dataset: "public", id: "eez-1" }, datasets: ["x"] };
    expect(normalizeKey(first)).toBe(normalizeKey(second));
  });

  it("preserves array order, which changes the key", () => {
    expect(normalizeKey({ ids: [1, 2] })).not.toBe(normalizeKey({ ids: [2, 1] }));
  });

  it("produces different keys for semantically different params", () => {
    expect(normalizeKey({ a: 1 })).not.toBe(normalizeKey({ a: 2 }));
  });

  it("handles empty params and distinguishes them from a populated object", () => {
    expect(normalizeKey({})).toBe(normalizeKey({}));
    expect(normalizeKey({ a: "x" })).not.toBe(normalizeKey({}));
  });

  it("distinguishes Date values by their instant instead of collapsing to {}", () => {
    const early = normalizeKey({ start: new Date("2024-01-01") });
    const late = normalizeKey({ start: new Date("2025-06-01") });
    expect(early).not.toBe(late);
    expect(early).not.toBe(JSON.stringify({ start: {} }));
  });

  it("distinguishes NaN, Infinity, -Infinity, and null from each other", () => {
    const keys = new Set([
      normalizeKey({ limit: Number.NaN }),
      normalizeKey({ limit: Number.POSITIVE_INFINITY }),
      normalizeKey({ limit: Number.NEGATIVE_INFINITY }),
      normalizeKey({ limit: null }),
    ]);
    expect(keys.size).toBe(4);
  });

  it("distinguishes an explicit undefined value from an omitted key", () => {
    expect(normalizeKey({ filter: undefined })).not.toBe(normalizeKey({}));
  });

  it("throws a clear error on a circular params object instead of overflowing the stack", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => normalizeKey(circular)).toThrow(/circular reference/);
  });

  it("does not flag a repeated (non-circular) reference to the same object as circular", () => {
    const shared = { id: 1 };
    expect(() => normalizeKey({ a: shared, b: shared })).not.toThrow();
  });
});
