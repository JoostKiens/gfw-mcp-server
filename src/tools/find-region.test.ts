import { describe, expect, it, vi } from "vitest";

import { Cache } from "../cache/cache.js";
import type { GfwClient, GfwResult } from "../gfw-client/client.js";
import type { GfwEezRegion } from "../region.js";
import { findRegionInputSchema, handleFindRegion } from "./find-region.js";

function createMockClient(): GfwClient {
  return { get: vi.fn(), post: vi.fn() };
}

const regions: readonly GfwEezRegion[] = [
  { label: "French Exclusive Economic Zone", id: 5677, iso3: "FRA", isoSov1: "FRA", isoSov2: null, isoSov3: null, territory1: "France" },
  {
    label: "South Korean Exclusive Economic Zone",
    id: 8327,
    iso3: "KOR",
    isoSov1: "KOR",
    isoSov2: null,
    isoSov3: null,
    territory1: "South Korea",
  },
  {
    label: "North Korean Exclusive Economic Zone",
    id: 8328,
    iso3: "PRK",
    isoSov1: "PRK",
    isoSov2: null,
    isoSov3: null,
    territory1: "North Korea",
  },
];

const fixtureResponse: GfwResult<readonly GfwEezRegion[]> = { ok: true, value: regions };

describe("handleFindRegion", () => {
  it("resolves a matching name to dataset/id/label", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindRegion(client, new Cache(), { name: "France" });

    expect(result).toEqual({ ok: true, value: { dataset: "public-eez-areas", id: 5677, label: "French Exclusive Economic Zone" } });
  });

  it("returns an ambiguous response with candidates and no error", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindRegion(client, new Cache(), { name: "Korea" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect("candidates" in result.value && result.value.candidates.map((c) => c.id).sort()).toEqual([8327, 8328]);
  });

  it("returns a not-found response with empty candidates and actionable guidance", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindRegion(client, new Cache(), { name: "Atlantis" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect("candidates" in result.value && result.value.candidates).toEqual([]);
    expect("message" in result.value && result.value.message).toContain("region.id");
  });

  it("serves a repeated call from cache without refetching", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);
    const cache = new Cache<string, readonly GfwEezRegion[]>();

    await handleFindRegion(client, cache, { name: "France" });
    await handleFindRegion(client, cache, { name: "France" });

    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("passes through a GFW error as a Result without throwing", async () => {
    const client = createMockClient();
    const error: GfwResult<never> = { ok: false, error: { kind: "http-error", status: 404, message: "not found" } };
    vi.mocked(client.get).mockResolvedValue(error);

    const result = await handleFindRegion(client, new Cache(), { name: "France" });

    expect(result).toEqual({ ok: false, error: { kind: "gfw-error", error: error.error } });
  });
});

describe("findRegionInputSchema", () => {
  it("rejects an empty name", () => {
    expect(findRegionInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts a non-empty name", () => {
    expect(findRegionInputSchema.safeParse({ name: "France" }).success).toBe(true);
  });
});
