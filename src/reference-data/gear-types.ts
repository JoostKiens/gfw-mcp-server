import { z } from "zod";

/**
 * Fetched live from GFW's `public-global-fishing-effort:latest` dataset metadata
 * (`GET /v3/datasets/public-global-fishing-effort:latest`, `filters.fourwings[].id === "geartype"`),
 * which is the exact enum the `4wings/report` `geartype` filter accepts. Re-run that
 * request to refresh this list if GFW adds new gear types. Use `gearTypeSchema.options`
 * if the raw list of values is needed — don't add a separate exported array.
 */
export const gearTypeSchema = z.enum([
  "driftnets",
  "drifting_longlines",
  "dredge_fishing",
  "fishing",
  "fixed_gear",
  "other_fishing",
  "other_purse_seines",
  "other_seines",
  "pole_and_line",
  "pots_and_traps",
  "purse_seines",
  "seiners",
  "set_gillnets",
  "set_longlines",
  "squid_jigger",
  "trawlers",
  "trollers",
  "tuna_purse_seines",
]);

export type GearType = z.infer<typeof gearTypeSchema>;
