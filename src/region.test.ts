import { describe, expect, it, vi } from "vitest";

import { Cache } from "./cache/cache.js";
import type { GfwClient, GfwResult } from "./gfw-client/client.js";
import { fetchEezRegions, matchRegion, normalizeRegionName, type GfwEezRegion } from "./region.js";

function createMockClient(): GfwClient {
  return { get: vi.fn(), post: vi.fn() };
}

// A representative slice of the live GET /v3/datasets/public-eez-areas/context-layers
// response (verified 2026-07-23), covering: a plain EEZ, a country with joint-regime
// entries sharing its territory1 (France, UK, USA), a genuinely ambiguous pair (Korea),
// and a diacritic label (Curaçao).
const regions: readonly GfwEezRegion[] = [
  { label: "Jordanian Exclusive Economic Zone", id: 8491, iso3: "JOR", isoSov1: "JOR", isoSov2: null, isoSov3: null, territory1: "Jordan" },
  { label: "French Exclusive Economic Zone", id: 5677, iso3: "FRA", isoSov1: "FRA", isoSov2: null, isoSov3: null, territory1: "France" },
  { label: "Joint regime area: France / Italy", id: 48976, iso3: null, isoSov1: "FRA", isoSov2: "ITA", isoSov3: null, territory1: "France" },
  { label: "Joint regime area: Spain / France", id: 48966, iso3: null, isoSov1: "ESP", isoSov2: "FRA", isoSov3: null, territory1: "France" },
  { label: "British Exclusive Economic Zone", id: 5696, iso3: "GBR", isoSov1: "GBR", isoSov2: null, isoSov3: null, territory1: "United Kingdom" },
  {
    label: "Joint regime area: United Kingdom / Denmark (Faeroe Islands)",
    id: 48967,
    iso3: null,
    isoSov1: "GBR",
    isoSov2: "DNK",
    isoSov3: null,
    territory1: "United Kingdom",
  },
  {
    label: "United States Exclusive Economic Zone",
    id: 8456,
    iso3: "USA",
    isoSov1: "USA",
    isoSov2: null,
    isoSov3: null,
    territory1: "United States",
  },
  { label: "Joint regime area: United States / Russia", id: 48978, iso3: null, isoSov1: "USA", isoSov2: "RUS", isoSov3: null, territory1: "United States" },
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
  { label: "Dutch Exclusive Economic Zone (Curaçao)", id: 26517, iso3: "CUW", isoSov1: "NLD", isoSov2: null, isoSov3: null, territory1: "Curaçao" },
];

describe("normalizeRegionName", () => {
  it("lowercases, strips diacritics, and collapses punctuation/whitespace", () => {
    expect(normalizeRegionName("Curaçao")).toBe("curacao");
    expect(normalizeRegionName("  United   Kingdom ")).toBe("united kingdom");
    expect(normalizeRegionName("Côte d'Ivoire")).toBe("cote d ivoire");
  });
});

describe("matchRegion", () => {
  it("resolves an exact iso3 match", () => {
    expect(matchRegion("JOR", regions)).toEqual({ kind: "matched", region: regions[0] });
  });

  it("resolves a plain country name to its primary EEZ, not the joint-regime entries sharing its territory1", () => {
    const result = matchRegion("France", regions);
    expect(result).toEqual({ kind: "matched", region: regions.find((r) => r.id === 5677) });
  });

  it("resolves 'UK' via the alias table to the British EEZ", () => {
    const result = matchRegion("UK", regions);
    expect(result).toEqual({ kind: "matched", region: regions.find((r) => r.id === 5696) });
  });

  it("resolves 'USA' via the alias table to the United States EEZ", () => {
    const result = matchRegion("USA", regions);
    expect(result).toEqual({ kind: "matched", region: regions.find((r) => r.id === 8456) });
  });

  it("resolves a diacritic-bearing label from a plain-ASCII query", () => {
    const result = matchRegion("Curacao", regions);
    expect(result).toEqual({ kind: "matched", region: regions.find((r) => r.id === 26517) });
  });

  it("returns ambiguous candidates when a query genuinely matches more than one country's own EEZ", () => {
    const result = matchRegion("Korea", regions);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(result.candidates.map((r) => r.id).sort()).toEqual([8327, 8328]);
    expect(result.truncated).toBe(false);
  });

  it("flags truncation when more candidates match than the cap", () => {
    const manyRegions: readonly GfwEezRegion[] = Array.from({ length: 12 }, (_, i) => ({
      label: `Testland ${i} Exclusive Economic Zone`,
      id: 90000 + i,
      iso3: `T0${i}`,
      isoSov1: `T0${i}`,
      isoSov2: null,
      isoSov3: null,
      territory1: `Testland ${i}`,
    }));

    const result = matchRegion("Testland", manyRegions);

    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(result.candidates).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("returns not-found for a query matching nothing", () => {
    expect(matchRegion("Atlantis", regions)).toEqual({ kind: "not-found" });
  });
});

describe("fetchEezRegions", () => {
  it("fetches once and serves subsequent calls from cache", async () => {
    const client = createMockClient();
    const response: GfwResult<readonly GfwEezRegion[]> = { ok: true, value: regions };
    vi.mocked(client.get).mockResolvedValue(response);
    const cache = new Cache<string, readonly GfwEezRegion[]>();

    await fetchEezRegions(client, cache);
    const second = await fetchEezRegions(client, cache);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ ok: true, value: regions });
  });

  it("passes through a GFW error as a Result without throwing", async () => {
    const client = createMockClient();
    const error: GfwResult<never> = { ok: false, error: { kind: "http-error", status: 404, message: "not found" } };
    vi.mocked(client.get).mockResolvedValue(error);

    const result = await fetchEezRegions(client, new Cache());

    expect(result).toEqual({ ok: false, error: { kind: "gfw-error", error: error.error } });
  });
});
