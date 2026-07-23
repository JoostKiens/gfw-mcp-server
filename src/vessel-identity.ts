/**
 * GFW's `/v3/vessels/search` response, one entry per matched real-world vessel.
 * Verified against a live call to `/v3/vessels/search` (2026-07-23) — nullable
 * self-report fields come back as JSON `null`, not an omitted key.
 */
export interface GfwVesselSearchResponse {
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  readonly entries: readonly GfwVesselSearchEntry[];
}

export interface GfwVesselSearchEntry {
  readonly selfReportedInfo: readonly GfwSelfReportedInfo[];
  readonly combinedSourcesInfo?: readonly GfwCombinedSourcesInfo[];
}

/** AIS self-report fields only — gear/vessel type live on `combinedSourcesInfo` instead. */
export interface GfwSelfReportedInfo {
  readonly id: string;
  readonly ssvid?: string | null;
  readonly shipname?: string | null;
  readonly flag?: string | null;
  readonly callsign?: string | null;
  readonly imo?: string | null;
  readonly transmissionDateFrom?: string | null;
  readonly transmissionDateTo?: string | null;
}

export interface GfwCombinedSourcesTypeEntry {
  readonly name: string;
  readonly yearFrom?: number;
  readonly yearTo?: number;
}

/**
 * One entry per identity within the search result, keyed by `vesselId` — matches
 * 1:1 to a `selfReportedInfo[].id`. A single GFW "entry" can hold more than one of
 * these when the same MMSI has broadcast under more than one internal identity
 * (confirmed live: MMSI 725000410 / "DON TITO" has two). `source` on each
 * type entry is GFW's own inference (e.g. "COMBINATION_OF_REGISTRY_AND_AIS_INFERRED_NN_INFO")
 * — this is a computed classification, not a vessel self-report.
 */
export interface GfwCombinedSourcesInfo {
  readonly vesselId: string;
  readonly geartypes?: readonly GfwCombinedSourcesTypeEntry[];
  readonly shiptypes?: readonly GfwCombinedSourcesTypeEntry[];
}

/** One flattened record per `selfReportedInfo` item, its own identity's gear/type attached. */
export interface RawVesselIdentityRecord {
  readonly vesselId: string;
  readonly name: string | undefined;
  readonly flag: string | undefined;
  readonly mmsi: string | undefined;
  readonly imo: string | undefined;
  readonly callsign: string | undefined;
  readonly geartype: string | undefined;
  readonly vesselType: string | undefined;
  readonly transmissionDateFrom: string | undefined;
  readonly transmissionDateTo: string | undefined;
}

export interface PreviousVesselIdentity {
  readonly name: string | undefined;
  readonly flag: string | undefined;
  readonly mmsi: string | undefined;
  readonly transmissionDateFrom: string | undefined;
  readonly transmissionDateTo: string | undefined;
}

/** One row per real-world vessel — the shape `find_vessels` returns. */
export interface VesselIdentity {
  readonly vesselId: string;
  readonly name: string | undefined;
  readonly flag: string | undefined;
  readonly mmsi: string | undefined;
  readonly imo: string | undefined;
  readonly callsign: string | undefined;
  readonly geartype: string | undefined;
  readonly vesselType: string | undefined;
  readonly previouslyKnownAs: readonly PreviousVesselIdentity[];
}

/**
 * Flattens GFW's nested response into one record per `selfReportedInfo` item,
 * matching each one to its own `combinedSourcesInfo` entry by `vesselId` — never
 * attributed entry-wide, since one entry can legitimately hold multiple distinct
 * identities (see `GfwCombinedSourcesInfo`'s doc comment).
 */
export function flattenVesselSearchEntries(response: GfwVesselSearchResponse): readonly RawVesselIdentityRecord[] {
  return response.entries.flatMap((entry) => {
    const combinedByVesselId = new Map((entry.combinedSourcesInfo ?? []).map((info) => [info.vesselId, info]));

    return entry.selfReportedInfo.map((record): RawVesselIdentityRecord => {
      const combined = combinedByVesselId.get(record.id);
      return {
        vesselId: record.id,
        name: record.shipname ?? undefined,
        flag: record.flag ?? undefined,
        mmsi: record.ssvid ?? undefined,
        imo: record.imo ?? undefined,
        callsign: record.callsign ?? undefined,
        geartype: mostRecentTypeName(combined?.geartypes),
        vesselType: mostRecentTypeName(combined?.shiptypes),
        transmissionDateFrom: record.transmissionDateFrom ?? undefined,
        transmissionDateTo: record.transmissionDateTo ?? undefined,
      };
    });
  });
}

function mostRecentTypeName(entries: readonly GfwCombinedSourcesTypeEntry[] | undefined): string | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  return entries.reduce((latest, entry) => ((entry.yearTo ?? -Infinity) > (latest.yearTo ?? -Infinity) ? entry : latest)).name;
}

/**
 * Groups by `vesselId` (the real vessel identity, per `selfReportedInfo[].id`).
 * The most recent record in each group (by `transmissionDateTo`, falling back to
 * `transmissionDateFrom`, then original order) becomes the primary identity; the
 * rest fold into `previouslyKnownAs`, most-recent-first. Distinct `vesselId`s
 * always stay as distinct rows.
 */
export function collapseVesselIdentities(records: readonly RawVesselIdentityRecord[]): readonly VesselIdentity[] {
  const groups = new Map<string, RawVesselIdentityRecord[]>();
  for (const record of records) {
    const group = groups.get(record.vesselId);
    if (group) {
      group.push(record);
    } else {
      groups.set(record.vesselId, [record]);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const [primary, ...history] = group.slice().sort(byMostRecentFirst);
    return {
      vesselId: primary.vesselId,
      name: primary.name,
      flag: primary.flag,
      mmsi: primary.mmsi,
      imo: primary.imo,
      callsign: primary.callsign,
      geartype: primary.geartype,
      vesselType: primary.vesselType,
      previouslyKnownAs: history.map(
        (record): PreviousVesselIdentity => ({
          name: record.name,
          flag: record.flag,
          mmsi: record.mmsi,
          transmissionDateFrom: record.transmissionDateFrom,
          transmissionDateTo: record.transmissionDateTo,
        }),
      ),
    };
  });
}

function byMostRecentFirst(a: RawVesselIdentityRecord, b: RawVesselIdentityRecord): number {
  const recencyA = recencyKey(a);
  const recencyB = recencyKey(b);
  return recencyB.localeCompare(recencyA);
}

function recencyKey(record: RawVesselIdentityRecord): string {
  return record.transmissionDateTo ?? record.transmissionDateFrom ?? "";
}
