import type { Cache } from "./cache/cache.js";
import type { GfwClient, GfwError } from "./gfw-client/client.js";
import type { Result } from "./result.js";

export const EEZ_CONTEXT_LAYERS_ENDPOINT = "/v3/datasets/public-eez-areas/context-layers";
export const EEZ_DATASET_ID = "public-eez-areas";

/** Single fixed key — the whole EEZ list is fetched once per process, not per query. */
const EEZ_CACHE_KEY = "eez-regions";

/**
 * GFW's EEZ context-layer entry (verified live against
 * GET /v3/datasets/public-eez-areas/context-layers, 2026-07-23). Joint-regime and
 * overlapping-claim entries (e.g. "Joint regime area: France / Italy") share
 * `territory1` with the country they border but come back with `iso3: null` and a
 * second `isoSov2`/`isoSov3` — that's the documented signal for "not a country's own
 * EEZ", used in `matchRegion` to prefer a country's primary EEZ over these.
 */
export interface GfwEezRegion {
  readonly label: string;
  readonly id: number;
  readonly iso3: string | null;
  readonly isoSov1: string | null;
  readonly isoSov2: string | null;
  readonly isoSov3: string | null;
  readonly territory1: string | null;
}

export type RegionMatchResult =
  | { readonly kind: "matched"; readonly region: GfwEezRegion }
  | { readonly kind: "ambiguous"; readonly candidates: readonly GfwEezRegion[]; readonly truncated: boolean }
  | { readonly kind: "not-found" };

const MAX_AMBIGUOUS_CANDIDATES = 10;

// Only entries where the alias itself doesn't already equal a live iso3/label/territory1
// field belong here (verified against a live fetch, 2026-07-23) — e.g. "russia"/"iran"/
// "tanzania" already exact-match their own territory1 without an alias, and "laos"/
// "czechia" have no EEZ in the dataset at all (landlocked), so aliasing them can never
// resolve to anything.
const REGION_ALIASES: Record<string, string> = {
  uk: "united kingdom",
  usa: "united states",
  us: "united states",
  "cote d'ivoire": "ivory coast",
};

/** Lowercase, strip diacritics, collapse whitespace/punctuation to single spaces. */
const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeRegionName(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function candidateTerms(query: string): readonly string[] {
  const normalized = normalizeRegionName(query);
  const alias = REGION_ALIASES[normalized];
  return alias && alias !== normalized ? [normalized, alias] : [normalized];
}

function fieldsOf(region: GfwEezRegion): readonly string[] {
  return [region.iso3, region.label, region.territory1].filter((field): field is string => field !== null).map(normalizeRegionName);
}

function exactMatches(terms: readonly string[], regions: readonly GfwEezRegion[]): readonly GfwEezRegion[] {
  return regions.filter((region) => fieldsOf(region).some((field) => terms.includes(field)));
}

function containmentMatches(terms: readonly string[], regions: readonly GfwEezRegion[]): readonly GfwEezRegion[] {
  return regions.filter((region) => {
    const fields = fieldsOf(region);
    return terms.some((term) => fields.some((field) => field.includes(term) || term.includes(field)));
  });
}

/**
 * A plain country name query (e.g. "France") legitimately exact/containment-matches
 * both the country's own EEZ and any joint-regime/overlapping-claim entries that
 * share its `territory1` (e.g. "Joint regime area: France / Italy") — GFW's own
 * `iso3: null` marks those as not the country's own EEZ. When at least one candidate
 * has a real `iso3`, drop the `iso3: null` ones rather than surfacing a false
 * ambiguity for the common case.
 */
function preferPrimaryEez(candidates: readonly GfwEezRegion[]): readonly GfwEezRegion[] {
  const primary = candidates.filter((region) => region.iso3 !== null);
  return primary.length > 0 ? primary : candidates;
}

export function matchRegion(query: string, regions: readonly GfwEezRegion[]): RegionMatchResult {
  const terms = candidateTerms(query);

  const exact = preferPrimaryEez(exactMatches(terms, regions));
  if (exact.length === 1) return { kind: "matched", region: exact[0] };
  if (exact.length > 1) return toAmbiguous(exact);

  const containment = preferPrimaryEez(containmentMatches(terms, regions));
  if (containment.length === 1) return { kind: "matched", region: containment[0] };
  if (containment.length > 1) return toAmbiguous(containment);

  return { kind: "not-found" };
}

function toAmbiguous(candidates: readonly GfwEezRegion[]): RegionMatchResult {
  return {
    kind: "ambiguous",
    candidates: candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES),
    truncated: candidates.length > MAX_AMBIGUOUS_CANDIDATES,
  };
}

export type FetchEezRegionsError = { readonly kind: "gfw-error"; readonly error: GfwError };

/** Fetch-once, cache-for-process-lifetime — same shape as find_vessels' cache, single fixed key. */
export async function fetchEezRegions(
  client: GfwClient,
  cache: Cache<string, readonly GfwEezRegion[]>,
): Promise<Result<readonly GfwEezRegion[], FetchEezRegionsError>> {
  const cached = cache.get(EEZ_CACHE_KEY);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const result = await client.get<readonly GfwEezRegion[]>(EEZ_CONTEXT_LAYERS_ENDPOINT);
  if (!result.ok) {
    return { ok: false, error: { kind: "gfw-error", error: result.error } };
  }

  cache.set(EEZ_CACHE_KEY, result.value);
  return { ok: true, value: result.value };
}
