import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { Cache } from "../cache/cache.js";
import type { GfwClient } from "../gfw-client/client.js";
import { EEZ_DATASET_ID, fetchEezRegions, matchRegion, type FetchEezRegionsError, type GfwEezRegion } from "../region.js";
import type { Result } from "../result.js";

export const findRegionInputSchema = z.object({
  name: z.string().min(1).describe("Free-text region name to resolve, e.g. a country name (\"France\") or common variant (\"UK\", \"USA\")."),
});

export type FindRegionInput = z.infer<typeof findRegionInputSchema>;

interface RegionCandidate {
  readonly label: string;
  readonly id: number;
}

export type FindRegionOutput =
  | { readonly dataset: string; readonly id: number; readonly label: string }
  | { readonly message: string; readonly candidates: readonly RegionCandidate[] };

export type FindRegionError = FetchEezRegionsError;

function toCandidate(region: GfwEezRegion): RegionCandidate {
  return { label: region.label, id: region.id };
}

export async function handleFindRegion(
  client: GfwClient,
  cache: Cache<string, readonly GfwEezRegion[]>,
  input: FindRegionInput,
): Promise<Result<FindRegionOutput, FindRegionError>> {
  const regionsResult = await fetchEezRegions(client, cache);
  if (!regionsResult.ok) {
    return regionsResult;
  }

  const match = matchRegion(input.name, regionsResult.value);

  if (match.kind === "matched") {
    return { ok: true, value: { dataset: EEZ_DATASET_ID, id: match.region.id, label: match.region.label } };
  }

  if (match.kind === "ambiguous") {
    const truncationNote = match.truncated ? " More matches exist beyond this list — narrow the name to see them." : "";
    return {
      ok: true,
      value: {
        message: `"${input.name}" matches more than one EEZ. Pick one of the candidates below and pass its ` +
          `region.id/region.dataset directly, or narrow the name.${truncationNote}`,
        candidates: match.candidates.map(toCandidate),
      },
    };
  }

  return {
    ok: true,
    value: {
      message: `No EEZ matched "${input.name}". Pass region.id/region.dataset directly if you know the numeric ` +
        `id, or check the spelling.`,
      candidates: [],
    },
  };
}

function formatFindRegionError(error: FindRegionError): string {
  return `find_region failed: ${error.error.message}`;
}

export function registerFindRegionTool(server: McpServer, client: GfwClient): void {
  // Process-lifetime, no ttlMs: GFW's EEZ list doesn't change within a process run
  // (see docs/claude/architecture.md). Module-scope const is a true singleton even
  // under the HTTP transport's per-request McpServer construction, since Node's ES
  // module cache only evaluates this file once per process.
  const eezRegionCache = new Cache<string, readonly GfwEezRegion[]>();

  server.registerTool(
    "find_region",
    {
      description:
        "Resolve a free-text region name (EEZ/country names, e.g. \"France\", \"UK\") to the region.dataset + " +
        "region.id pair other GFW report tools expect. EEZ only — does not resolve MPA or RFMO names. Returns " +
        "either a single resolved region, or a not-found/ambiguous response listing candidates and instructions " +
        "to pass region.id/region.dataset directly instead.",
      inputSchema: findRegionInputSchema,
    },
    async (input) => {
      const result = await handleFindRegion(client, eezRegionCache, input);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: formatFindRegionError(result.error) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }] };
    },
  );
}
