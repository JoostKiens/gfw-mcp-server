import { describe, expect, it } from "vitest";

import {
  collapseVesselIdentities,
  flattenVesselSearchEntries,
  type GfwVesselSearchResponse,
  type RawVesselIdentityRecord,
} from "./vessel-identity.js";

function response(entries: GfwVesselSearchResponse["entries"]): GfwVesselSearchResponse {
  return { limit: 20, offset: 0, total: entries.length, entries };
}

describe("flattenVesselSearchEntries", () => {
  it("matches each selfReportedInfo record to its own combinedSourcesInfo entry by vesselId", () => {
    // Real fixture: MMSI 725000410 / "DON TITO" broadcasts under two distinct
    // internal identities, each with its own gear/type history — captured live
    // from GET /v3/vessels/search on 2026-07-23.
    const records = flattenVesselSearchEntries(
      response([
        {
          selfReportedInfo: [
            {
              id: "5983b16a4-4039-bb42-0e92-14f4f9d16b3e",
              ssvid: "725000410",
              shipname: "DON TITO",
              flag: "CHL",
              imo: "9105827",
              transmissionDateFrom: "2024-07-18T10:33:05Z",
              transmissionDateTo: "2026-07-21T23:59:41Z",
            },
            {
              id: "9e075a986-6162-fe6e-b25e-81188438a00c",
              ssvid: "725000410",
              shipname: "DON TITO",
              flag: "CHL",
              imo: null,
              transmissionDateFrom: "2012-01-19T14:24:39Z",
              transmissionDateTo: "2025-03-06T04:11:18Z",
            },
          ],
          combinedSourcesInfo: [
            {
              vesselId: "5983b16a4-4039-bb42-0e92-14f4f9d16b3e",
              geartypes: [{ name: "TUNA_PURSE_SEINES", yearFrom: 2024, yearTo: 2026 }],
              shiptypes: [{ name: "FISHING", yearFrom: 2024, yearTo: 2026 }],
            },
            {
              vesselId: "9e075a986-6162-fe6e-b25e-81188438a00c",
              geartypes: [{ name: "OTHER", yearFrom: 2012, yearTo: 2025 }],
              shiptypes: [{ name: "FISHING", yearFrom: 2012, yearTo: 2025 }],
            },
          ],
        },
      ]),
    );

    expect(records).toHaveLength(2);
    expect(records.find((r) => r.vesselId === "5983b16a4-4039-bb42-0e92-14f4f9d16b3e")?.geartype).toBe("TUNA_PURSE_SEINES");
    expect(records.find((r) => r.vesselId === "9e075a986-6162-fe6e-b25e-81188438a00c")?.geartype).toBe("OTHER");
  });

  it("picks the most recent combinedSourcesInfo type entry by yearTo within one identity", () => {
    const records = flattenVesselSearchEntries(
      response([
        {
          selfReportedInfo: [{ id: "abc123" }],
          combinedSourcesInfo: [
            {
              vesselId: "abc123",
              geartypes: [
                { name: "trawlers", yearTo: 2019 },
                { name: "purse_seines", yearTo: 2023 },
              ],
            },
          ],
        },
      ]),
    );

    expect(records[0]?.geartype).toBe("purse_seines");
  });

  it("converts JSON null self-report fields to undefined and leaves gear/type undefined with no combinedSourcesInfo match", () => {
    const records = flattenVesselSearchEntries(
      response([{ selfReportedInfo: [{ id: "abc123", imo: null, callsign: null }] }]),
    );

    expect(records[0]).toMatchObject({
      vesselId: "abc123",
      name: undefined,
      imo: undefined,
      callsign: undefined,
      geartype: undefined,
      vesselType: undefined,
    });
  });

  it("returns an empty list for an empty response", () => {
    expect(flattenVesselSearchEntries(response([]))).toEqual([]);
  });
});

describe("collapseVesselIdentities", () => {
  function record(overrides: Partial<RawVesselIdentityRecord> & Pick<RawVesselIdentityRecord, "vesselId">): RawVesselIdentityRecord {
    return {
      name: undefined,
      flag: undefined,
      mmsi: undefined,
      imo: undefined,
      callsign: undefined,
      geartype: undefined,
      vesselType: undefined,
      transmissionDateFrom: undefined,
      transmissionDateTo: undefined,
      ...overrides,
    };
  }

  it("collapses a vessel with a name-change history into one row, most-recent-first history", () => {
    const vessels = collapseVesselIdentities([
      record({ vesselId: "abc123", name: "OLDEST NAME", flag: "ESP", transmissionDateTo: "2019-06-01" }),
      record({ vesselId: "abc123", name: "CURRENT NAME", flag: "PRT", transmissionDateTo: "2023-01-01" }),
      record({ vesselId: "abc123", name: "MIDDLE NAME", flag: "FRA", transmissionDateTo: "2021-03-01" }),
    ]);

    expect(vessels).toHaveLength(1);
    expect(vessels[0]?.vesselId).toBe("abc123");
    expect(vessels[0]?.name).toBe("CURRENT NAME");
    expect(vessels[0]?.flag).toBe("PRT");
    expect(vessels[0]?.previouslyKnownAs).toEqual([
      { name: "MIDDLE NAME", flag: "FRA", mmsi: undefined, transmissionDateFrom: undefined, transmissionDateTo: "2021-03-01" },
      { name: "OLDEST NAME", flag: "ESP", mmsi: undefined, transmissionDateFrom: undefined, transmissionDateTo: "2019-06-01" },
    ]);
  });

  it("keeps two genuinely different vessels as separate rows", () => {
    const vessels = collapseVesselIdentities([
      record({ vesselId: "abc123", name: "F/V ONE" }),
      record({ vesselId: "xyz789", name: "F/V TWO" }),
    ]);

    expect(vessels).toHaveLength(2);
    expect(vessels.map((v) => v.vesselId).sort()).toEqual(["abc123", "xyz789"]);
  });

  it("returns an empty list for no records", () => {
    expect(collapseVesselIdentities([])).toEqual([]);
  });

  it("falls back to a stable, deterministic order when no records in a group have a transmission date", () => {
    const vessels = collapseVesselIdentities([
      record({ vesselId: "abc123", name: "FIRST INSERTED" }),
      record({ vesselId: "abc123", name: "SECOND INSERTED" }),
    ]);

    expect(vessels[0]?.name).toBe("FIRST INSERTED");
    expect(vessels[0]?.previouslyKnownAs[0]?.name).toBe("SECOND INSERTED");
  });
});
