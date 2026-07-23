# Writing an MCP tool in this repo

This is the concrete pattern for adding or modifying a tool in `src/tools/`. Read `architecture.md` and `conventions.md` first — this doc assumes both.

## The shape of a tool file

Every tool file follows the same skeleton:

```typescript
// 1. Zod input schema — only fields this tool needs (Interface Segregation, see conventions.md)
const inputSchema = z.object({ /* ... */ });

// 2. Pure logic functions — summarization, validation beyond Zod, formatting.
//    These are unit-tested directly, with fixture data, no MCP or network involved.
function summarizeX(raw: GfwXResponse): XSummary { /* ... */ }

// 3. The tool handler — thin orchestration, wired to gfw-client/cache/queue.
//    This is the only part that touches the network or MCP protocol types.
async function handleGetX(input: XInput): Promise<Result<XSummary, ToolError>> { /* ... */ }

// 4. Tool registration — name, description, schema, handler.
```

The handler should read as a straight-line sequence: validate → resolve names → fetch (cache/queue if applicable) → summarize → attach caveats → return. If it doesn't read that way, the logic that's making it complicated probably belongs in a separate pure function.

## Checklist for a new or changed tool

Before considering a tool done:

- [ ] **Input schema validates only what this tool uses.** No shared mega-schema. Enum fields reference `reference-data/`, not a hardcoded list.
- [ ] **Every response includes `dataCaveats: readonly string[]`** if the tool returns GFW activity/detection/event/insight data. State the caveat specifically (e.g. "AIS-based; vessels not broadcasting AIS won't appear") — not generic boilerplate.
- [ ] **No raw GFW arrays pass through unmodified.** If a GFW response contains a list of grid cells, events, or entries, the tool returns a summary (totals, breakdowns, distinct counts) computed by a pure function — not `response.entries` handed to the LLM as-is. If you genuinely believe raw pass-through is correct for a specific field, that's worth a second look before shipping it, not a default.
- [ ] **If it calls `4wings/report`** (fishing activity, dark-vessel detections, vessel presence): goes through the report queue and 15-min cache (`src/cache/`), never calls the GFW endpoint directly. Validates date range ≤ 366 days client-side before any network call.
- [ ] **Errors are `Result`, not exceptions**, for anything GFW or validation can produce (see `conventions.md`). The tool handler converts the final `Result` to the MCP response/error shape at the boundary.
- [ ] **Name resolution (region, vessel) reuses existing resolvers** (`find_region` logic, vessel identity collapse) rather than reimplementing matching logic per-tool.
- [ ] **Unit test with fixture data** covers: the happy path, at least one boundary condition specific to this tool (e.g. the 366-day cutoff, an empty-results case, a not-found case), and the summarization math against known fixture inputs/outputs.
- [ ] **Tool description (the string the LLM sees)** is specific about what the tool does and doesn't cover — e.g. `get_vessel_presence`'s description should note it's not a continuous track, since that's a common misreading of what "presence" means.

## Vessel identity collapse (used by `find_vessels`, referenced elsewhere)

GFW's vessel search returns multiple historical AIS identities per real-world vessel (name/flag changes over time). The canonical collapse logic — group by `selfReportedInfo[].id`, surface most-recent identity as primary fields, fold older identities into `previouslyKnownAs` — lives in one place and is reused by any tool that needs to resolve or display vessel identity, not reimplemented per-tool.

## Encounter event merging (used by `get_vessel_events`)

Encounter events come back as one row per vessel involved (composite ID `eventId.1`/`eventId.2`). Merge these into a single encounter record with both parties named before returning — never surface the raw two-row split to the LLM.

## Region name fuzzy matching (used by `find_region`, referenced elsewhere)

`find_region` resolves a free-text name against the cached EEZ id+name list (see `architecture.md` for how that list is fetched and cached) using fuzzy matching, handling common variants (e.g. "UK" / "United Kingdom", "USA" / "United States"). When nothing matches, return actionable guidance: the caller should pass `region.id` + `region.dataset` directly.

## When you're not sure whether something belongs in a tool file or in `reference-data/`/`gfw-client`

- **Tool file**: orchestration and this-tool-specific summarization/formatting.
- **`gfw-client`**: anything about *how* to talk to GFW (auth, error typing, retries at the HTTP level) — no domain knowledge about fishing effort, vessels, etc.
- **`reference-data`**: static, build-time enums (gear types, vessel types) sourced from live GFW dataset metadata — no logic beyond simple lookup.
- **`cache`**: the generic `Cache<K,V>` and `ReportQueue` — no GFW-specific or tool-specific logic; they operate on opaque keys and values.

If logic would be useful to two or more tools (e.g. region-name fuzzy matching, vessel-identity collapse), it doesn't live in either tool's file — it moves to a shared module, imported by both, per Single Responsibility / avoid-duplication in `conventions.md`.