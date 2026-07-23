import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { Cache } from "../cache/cache.js";
import { normalizeKey } from "../cache/normalize-key.js";
import type { GfwClient, GfwError } from "../gfw-client/client.js";
import { gearTypeSchema, type GearType } from "../reference-data/gear-types.js";
import type { Result } from "../result.js";
import { collapseVesselIdentities, flattenVesselSearchEntries, type GfwVesselSearchResponse, type VesselIdentity } from "../vessel-identity.js";

const VESSEL_SEARCH_ENDPOINT = "/v3/vessels/search";
const VESSEL_IDENTITY_DATASET = "public-global-vessel-identity:latest";
const DEFAULT_LIMIT = 20;

// `gearTypeSchema` (src/reference-data/gear-types.ts) is sourced from the
// 4wings/fishing-effort dataset's geartype filter, per the ticket's explicit
// instruction to reuse it. The vessel-identity dataset that /v3/vessels/search
// actually queries has its own, differently-cased (UPPER_SNAKE_CASE) and
// differently-scoped geartypes vocabulary (verified live against
// GET /v3/datasets/public-global-vessel-identity:latest) — most values map by
// uppercasing, but these two don't exist in that dataset's vocabulary at all and
// will never match a vessel.
const GEARTYPES_UNSUPPORTED_BY_VESSEL_SEARCH: ReadonlySet<GearType> = new Set(["driftnets", "other_fishing"]);

const FIND_VESSELS_ATTRIBUTION =
  "Vessel data provided by Global Fishing Watch (globalfishingwatch.org), used under GFW's terms of use.";
const FIND_VESSELS_SELF_REPORT_CAVEAT =
  "Name, flag, MMSI, and callsign are self-reported via AIS and may be inaccurate, outdated, or intentionally falsified.";
const FIND_VESSELS_INFERRED_TYPE_CAVEAT =
  "Gear type and vessel type are GFW's own inferred classification (combining registry records, AIS behavior, " +
  "and a matching model) rather than a direct vessel self-report — treat as a best estimate, not a certified classification.";
const FIND_VESSELS_FILTER_WINDOW_CAVEAT =
  "flag/geartype filtering is applied locally, after GFW's search — GFW does not support combining a free-text " +
  "query with a structured filter in one request. A matching vessel ranked outside limit by the free-text search " +
  "won't appear; increase limit or narrow query if you expect more matches. The filter only checks each vessel's " +
  "current flag/geartype, not previouslyKnownAs history — a vessel that used to match won't appear if it doesn't " +
  "match now.";

// Process-lifetime, no ttlMs (vessel identity doesn't change within a process run —
// see docs/claude/architecture.md). A module-scope const here is a true singleton
// even under the HTTP transport's per-request McpServer construction, since Node's
// ES module cache only evaluates this file once per process.
const vesselSearchCache = new Cache<string, GfwVesselSearchResponse>();

export const findVesselsInputSchema = z.object({
  query: z.string().min(1).describe("Vessel name, MMSI, IMO, or callsign to search for."),
  flag: z.string().min(1).optional().describe("Flag state (ISO3 code) to filter results by."),
  geartype: gearTypeSchema.optional().describe("Restrict results to vessels using this gear type."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max number of distinct vessels to return, applied before identity collapse and before flag/geartype filtering. Defaults to 20."),
});

export type FindVesselsInput = z.infer<typeof findVesselsInputSchema>;

export interface FindVesselsOutput {
  readonly vessels: readonly VesselIdentity[];
  readonly dataCaveats: readonly string[];
}

export type FindVesselsError = { readonly kind: "gfw-error"; readonly error: GfwError };

function resolvedLimit(input: FindVesselsInput): number {
  return input.limit ?? DEFAULT_LIMIT;
}

// GFW's vessel search endpoint rejects `flag`/`geartype` as direct query params
// (verified live: `flags[0]=`/`geartypes[0]=`/`flag=`/`geartype=` all 422 with
// "property X should not exist"), and structured filtering only exists via a
// `where=` advanced-query string — but `query` and `where` can NOT be used
// together on this endpoint at all (verified live: 422 "These properties
// [query,where] can not be used together"). Since `query` does GFW's own
// free-text/fuzzy matching across name/MMSI/IMO/callsign (not reimplementable
// here), the request only ever sends `query`; flag/geartype are applied as a
// local post-filter in `matchesFilters` instead.
export function buildVesselSearchPath(input: FindVesselsInput): string {
  const params = new URLSearchParams();
  params.set("query", input.query);
  params.set("datasets[0]", VESSEL_IDENTITY_DATASET);
  params.set("limit", String(resolvedLimit(input)));
  return `${VESSEL_SEARCH_ENDPOINT}?${params.toString()}`;
}

// Matches against the vessel's current (collapsed-primary) flag/geartype only —
// not previouslyKnownAs history, so a vessel that used to carry a matching flag
// or geartype but doesn't currently won't match. GFW always returns flag as
// uppercase ISO3 and geartype as UPPER_SNAKE_CASE, so both sides of the compare
// are normalized to uppercase — an un-normalized flag input silently returned
// zero matches for any caller who didn't happen to pass it pre-uppercased.
function matchesFilters(vessel: VesselIdentity, input: FindVesselsInput): boolean {
  if (input.flag && vessel.flag !== input.flag.toUpperCase()) {
    return false;
  }
  if (input.geartype && vessel.geartype !== input.geartype.toUpperCase()) {
    return false;
  }
  return true;
}

function buildDataCaveats(input: FindVesselsInput): readonly string[] {
  const caveats = [FIND_VESSELS_ATTRIBUTION, FIND_VESSELS_SELF_REPORT_CAVEAT, FIND_VESSELS_INFERRED_TYPE_CAVEAT];
  if (input.flag || input.geartype) {
    caveats.push(FIND_VESSELS_FILTER_WINDOW_CAVEAT);
  }
  if (input.geartype && GEARTYPES_UNSUPPORTED_BY_VESSEL_SEARCH.has(input.geartype)) {
    caveats.push(
      `GFW's vessel-identity dataset doesn't classify vessels as "${input.geartype}" — this filter will return no ` +
        "matches even if vessels of this type exist.",
    );
  }
  return caveats;
}

export async function handleFindVessels(
  client: GfwClient,
  cache: Cache<string, GfwVesselSearchResponse>,
  input: FindVesselsInput,
): Promise<Result<FindVesselsOutput, FindVesselsError>> {
  // Only query/limit affect the actual GFW request (flag/geartype are a local
  // post-filter) — keying the cache on the full input would create redundant
  // cache entries and redundant GFW calls for requests that fetch identical data.
  const cacheKey = normalizeKey({ query: input.query, limit: resolvedLimit(input) });

  let response = cache.get(cacheKey);
  if (response === undefined) {
    const result = await client.get<GfwVesselSearchResponse>(buildVesselSearchPath(input));
    if (!result.ok) {
      return { ok: false, error: { kind: "gfw-error", error: result.error } };
    }
    response = result.value;
    cache.set(cacheKey, response);
  }

  const vessels = collapseVesselIdentities(flattenVesselSearchEntries(response)).filter((vessel) => matchesFilters(vessel, input));
  return { ok: true, value: { vessels, dataCaveats: buildDataCaveats(input) } };
}

function formatFindVesselsError(error: FindVesselsError): string {
  return `find_vessels failed: ${error.error.message}`;
}

export function registerFindVesselsTool(server: McpServer, client: GfwClient): void {
  server.registerTool(
    "find_vessels",
    {
      description:
        "Search for vessels by name, MMSI, IMO, or callsign. Returns one row per distinct " +
        "real-world vessel, collapsing AIS name/flag-change history into a previouslyKnownAs " +
        "list rather than one row per historical broadcast. Note: `limit` applies to raw AIS " +
        "records before identity collapse and before flag/geartype filtering, so a vessel with " +
        "a long name-change history — or a small limit combined with a flag/geartype filter — " +
        "can crowd out or exclude other distinct matches.",
      inputSchema: findVesselsInputSchema,
    },
    async (input) => {
      const result = await handleFindVessels(client, vesselSearchCache, input);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: formatFindVesselsError(result.error) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }] };
    },
  );
}
