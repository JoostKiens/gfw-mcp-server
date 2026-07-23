import { describe, expect, it, vi } from "vitest";

import { Cache } from "../cache/cache.js";
import type { GfwClient, GfwResult } from "../gfw-client/client.js";
import type { GfwVesselSearchResponse } from "../vessel-identity.js";
import { buildVesselSearchPath, findVesselsInputSchema, handleFindVessels } from "./find-vessels.js";

function createMockClient(): GfwClient {
  return { get: vi.fn(), post: vi.fn() };
}

const fixtureResponse: GfwResult<GfwVesselSearchResponse> = {
  ok: true,
  value: {
    limit: 20,
    offset: 0,
    total: 2,
    entries: [
      {
        selfReportedInfo: [{ id: "abc123", shipname: "F/V EXAMPLE", flag: "ESP" }],
        combinedSourcesInfo: [{ vesselId: "abc123", geartypes: [{ name: "TRAWLERS" }], shiptypes: [{ name: "FISHING" }] }],
      },
      {
        selfReportedInfo: [{ id: "xyz789", shipname: "F/V OTHER", flag: "PRT" }],
        combinedSourcesInfo: [{ vesselId: "xyz789", geartypes: [{ name: "PURSE_SEINES" }], shiptypes: [{ name: "FISHING" }] }],
      },
    ],
  },
};

const emptyResponse: GfwResult<GfwVesselSearchResponse> = { ok: true, value: { limit: 20, offset: 0, total: 0, entries: [] } };

const notFound: GfwResult<never> = {
  ok: false,
  error: { kind: "http-error", status: 404, message: "GFW could not find the requested resource." },
};

describe("handleFindVessels", () => {
  it("returns collapsed vessels and dataCaveats on the happy path", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.vessels.map((v) => v.vesselId).sort()).toEqual(["abc123", "xyz789"]);
  });

  it("filters results locally by flag without sending flag to GFW", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE", flag: "ESP" });

    if (!result.ok) throw new Error("expected success");
    expect(result.value.vessels.map((v) => v.vesselId)).toEqual(["abc123"]);
    expect(client.get).toHaveBeenCalledWith(expect.not.stringContaining("flag"));
  });

  it("filters results locally by flag case-insensitively, matching GFW's always-uppercase flag values", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE", flag: "esp" });

    if (!result.ok) throw new Error("expected success");
    expect(result.value.vessels.map((v) => v.vesselId)).toEqual(["abc123"]);
  });

  it("filters results locally by geartype, uppercasing to match GFW's vocabulary", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE", geartype: "purse_seines" });

    if (!result.ok) throw new Error("expected success");
    expect(result.value.vessels.map((v) => v.vesselId)).toEqual(["xyz789"]);
  });

  it("returns an empty vessel list, not an error, for a genuinely empty GFW response", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(emptyResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "NO SUCH VESSEL" });

    expect(result).toEqual({ ok: true, value: { vessels: [], dataCaveats: expect.any(Array) } });
  });

  it("states GFW attribution, the AIS self-report caveat, and the inferred-classification caveat", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE" });

    if (!result.ok) throw new Error("expected success");
    expect(result.value.dataCaveats.some((c) => c.includes("Global Fishing Watch"))).toBe(true);
    expect(result.value.dataCaveats.some((c) => c.includes("self-reported via AIS"))).toBe(true);
    expect(result.value.dataCaveats.some((c) => c.includes("inferred classification"))).toBe(true);
  });

  it("adds a filter-window caveat only when flag or geartype is actually requested", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);

    const unfiltered = await handleFindVessels(client, new Cache(), { query: "EXAMPLE" });
    const filtered = await handleFindVessels(client, new Cache(), { query: "EXAMPLE", flag: "ESP" });

    if (!unfiltered.ok || !filtered.ok) throw new Error("expected success");
    expect(unfiltered.value.dataCaveats.some((c) => c.includes("applied locally"))).toBe(false);
    expect(filtered.value.dataCaveats.some((c) => c.includes("applied locally"))).toBe(true);
  });

  it("adds an extra caveat when the requested geartype isn't in the vessel-identity dataset's vocabulary", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(emptyResponse);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE", geartype: "driftnets" });

    if (!result.ok) throw new Error("expected success");
    expect(result.value.dataCaveats.some((c) => c.includes('"driftnets"'))).toBe(true);
  });

  it("serves a repeated identical query from cache without calling GFW again", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);
    const cache = new Cache<string, GfwVesselSearchResponse>();

    await handleFindVessels(client, cache, { query: "EXAMPLE" });
    await handleFindVessels(client, cache, { query: "EXAMPLE" });

    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("treats an omitted limit and the documented default limit as the same cache entry", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);
    const cache = new Cache<string, GfwVesselSearchResponse>();

    await handleFindVessels(client, cache, { query: "EXAMPLE" });
    await handleFindVessels(client, cache, { query: "EXAMPLE", limit: 20 });

    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch from GFW when only flag/geartype differ, since they don't affect the GFW request", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);
    const cache = new Cache<string, GfwVesselSearchResponse>();

    await handleFindVessels(client, cache, { query: "EXAMPLE", flag: "ESP" });
    await handleFindVessels(client, cache, { query: "EXAMPLE", geartype: "trawlers" });

    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("calls GFW again for a different query", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(fixtureResponse);
    const cache = new Cache<string, GfwVesselSearchResponse>();

    await handleFindVessels(client, cache, { query: "EXAMPLE" });
    await handleFindVessels(client, cache, { query: "OTHER" });

    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it("passes through a GFW error as a Result without throwing", async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue(notFound);

    const result = await handleFindVessels(client, new Cache(), { query: "EXAMPLE" });

    expect(result).toEqual({ ok: false, error: { kind: "gfw-error", error: notFound.error } });
  });
});

describe("buildVesselSearchPath", () => {
  it("encodes only query, dataset, and limit — GFW rejects query combined with where", () => {
    const path = buildVesselSearchPath({ query: "EXAMPLE", flag: "ESP", geartype: "trawlers", limit: 5 });
    expect(path).toBe("/v3/vessels/search?query=EXAMPLE&datasets%5B0%5D=public-global-vessel-identity%3Alatest&limit=5");
  });

  it("defaults limit to 20 when omitted", () => {
    const path = buildVesselSearchPath({ query: "EXAMPLE" });
    const url = new URL(`https://example.test${path}`);
    expect(url.searchParams.get("limit")).toBe("20");
  });
});

describe("findVesselsInputSchema", () => {
  it("rejects an empty query", () => {
    expect(findVesselsInputSchema.safeParse({ query: "" }).success).toBe(false);
  });

  it("accepts a query with flag/geartype/limit omitted", () => {
    expect(findVesselsInputSchema.safeParse({ query: "EXAMPLE" }).success).toBe(true);
  });

  it("rejects a geartype not in the reference-data enum", () => {
    expect(findVesselsInputSchema.safeParse({ query: "EXAMPLE", geartype: "not-a-real-geartype" }).success).toBe(false);
  });
});
