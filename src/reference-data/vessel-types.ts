import { z } from "zod";

/**
 * Fetched live from GFW's `public-global-vessel-identity:latest` dataset metadata
 * (`GET /v3/datasets/public-global-vessel-identity:latest`,
 * `filters.vessels[].id === "combinedSourcesInfo.shiptypes.name"`). The fishing-effort
 * dataset used by `4wings/report` has no vessel-type filter of its own, so this is the
 * closest live GFW enum for vessel type classification. Re-run that request to refresh
 * this list if GFW adds new vessel types. Use `vesselTypeSchema.options` if the raw
 * list of values is needed — don't add a separate exported array.
 */
export const vesselTypeSchema = z.enum([
  "BUNKER",
  "CARGO",
  "CARRIER",
  "DISCREPANCY",
  "FISHING",
  "GEAR",
  "OTHER",
  "PASSENGER",
  "SEISMIC_VESSEL",
  "SUPPORT",
]);

export type VesselType = z.infer<typeof vesselTypeSchema>;
