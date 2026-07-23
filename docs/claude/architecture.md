# Architecture

## System shape

A single-process Node.js MCP server. No database, no message queue, no external cache service — everything is in-memory, scoped to the life of one running process. It's started either via `npx` over STDIO (typical: one process per Claude Desktop/Claude Code session) or as a long-lived Streamable HTTP server (one process serving requests, still single-user — the bearer token identifies one GFW account).

This matters for every design decision below: we are not building a multi-tenant distributed service, and we should not import patterns that assume one.

## Directory structure

```
src/
  index.ts             # STDIO entrypoint
  http-server.ts        # Streamable HTTP entrypoint
  tools/                 # one file per MCP tool — thin: schema + orchestration only
  gfw-client/             # HTTP client for the GFW v3 API (auth, error typing, rate-limit awareness)
  cache/                   # generic TTL cache + the 4Wings report queue
  reference-data/           # bundled gear types, vessel types
```

Each `tools/*.ts` file should be readable top-to-bottom: validate input → resolve any names (region, gear type) → fetch (via `gfw-client`, through `cache`/queue where relevant) → summarize → attach caveats → return. The summarization and validation logic itself should live in small pure functions, ideally in the same file or a co-located `*.logic.ts`, so it's unit-testable without mocking the MCP transport.

## Data flow: a typical tool call

Using `get_fishing_activity` as the representative case (the most complex path — the read-only tools like `list_reference_data` skip most of this):

```
MCP tool call
  → Zod schema validation (reject malformed input immediately, no GFW call made)
  → region name resolution (find_region — cached GFW context-layers lookup, or pass-through if region.id/region.dataset given directly)
  → date-range validation (≤ 366 days — reject client-side, see CLAUDE.md)
  → report cache lookup (15-min TTL, keyed on normalized params)
      hit  → return cached summary
      miss → enter report queue
               → single-concurrency lock (wait if another report is in flight)
               → call GFW 4wings/report
                    success → summarize in code, cache, return
                    524     → poll last-report until resolved or 30-min window elapses
                    other error → typed MCPError, no raw GFW JSON leaked
  → attach dataCaveats
  → return structured response
```

Tools that hit the Vessels/Events/Insights APIs (`find_vessels`, `get_vessel_events`, `get_vessel_insights`) skip the queue/cache-for-reports step — those endpoints don't share GFW's single-concurrent-report constraint — but still validate, summarize, and attach caveats the same way.

## The report queue (why it exists)

GFW's `4wings/report` endpoint enforces **one concurrent report per API token**, can time out (524) past 100 seconds, and offers a `last-report` endpoint that holds results for 30 minutes. Three of our eight tools (`get_fishing_activity`, `get_dark_vessel_detections`, `get_vessel_presence`) hit this same endpoint with different dataset parameters — so the concurrency limit is shared *across tools*, not per-tool.

The queue in `src/cache/report-queue.ts` is the single choke point all three go through. It:
1. Serializes requests — a second overlapping call waits rather than firing and getting a 429.
2. On 524, automatically polls `last-report` instead of surfacing the timeout to the caller.
3. Checks the report cache before queueing anything (see below) — a cache hit never touches the queue at all.

Do not call `4wings/report` from anywhere except through this queue.

## Cache layer

Three independent caches, one generic `Cache<K, V>` implementation:
- **Vessel metadata cache** — long-lived (vessel identity doesn't change within a process run). Reduces redundant `find_vessels` lookups when a conversation references the same vessel repeatedly.
- **4Wings report cache** — 15-minute TTL. This is the higher-value cache: report calls are slow and serialized, so avoiding a repeat call matters more here than anywhere else in the system.
- **EEZ context-layer cache** — cached for the life of the process, populated once. `find_region`'s first call in a process fetches GFW's full EEZ region list and stores it; every later call in that process is served from the cache.

Cache keys for reports are built from *normalized* query params (sorted, consistent formatting) so that equivalent queries with differently-ordered parameters still hit the same entry.

## Reference data

**Gear types and vessel types (`src/reference-data/gear-types.ts`, `vessel-types.ts`)** are bundled at build time as Zod enums, pulled directly from the relevant dataset's live `filters` metadata (`GET /v3/datasets/public-global-fishing-effort:latest` for gear types, `GET /v3/datasets/public-global-vessel-identity:latest` for vessel types) — so the enum stays in sync with what GFW's API actually accepts.

Bundling is the right depth here specifically because these are small, closed sets (~10-20 values each) needed synchronously at module load, to build the Zod schema tool input validation depends on before any request happens — there's no point fetching them per-process when GFW itself only changes them rarely. EEZ regions are the opposite shape: ~280 entries, needed only for fuzzy-matching a caller's free-text name (not for schema construction), which is exactly what makes a runtime fetch + cache the better fit there instead. Re-run the relevant `GET /v3/datasets/...` request and update the enum by hand if GFW adds a new gear or vessel type.

## Transports

STDIO and Streamable HTTP share all tool logic — the transport layer only handles request/response framing. There is no auth layer of our own on the HTTP transport beyond what MCP itself provides at the transport level; see the security model below for why.

## Security model

The MCP best-practices guide's security section (JWT auth, capability-based ACLs, defense-in-depth layers, circuit breakers) is written for a service protecting shared backend resources from untrusted multi-tenant clients. That's not our situation:

- **The GFW bearer token *is* the authorization boundary.** Every request is scoped to whatever the token's owner can already access via GFW directly. We don't add our own auth layer on top because there's nothing additional to protect — a user with the token can already do everything the token allows, with or without our server in the middle.
- **Zod schema validation is our input sanitization.** There's no separate "validation layer" beyond well-written Zod schemas at the tool boundary.
- **No circuit breaker is needed beyond the report queue (above).** The queue already isolates the one real failure mode we have (GFW's single-concurrency + timeout behavior). A generic circuit breaker on top would be solving a problem we don't have.
- **STDIO is a local trusted pipe** — the client (Claude Desktop, Claude Code) and server run as the same user's processes. Network isolation concerns from the best-practices guide (binding to `127.0.0.1`, VPN access) apply to the Streamable HTTP transport if it's ever exposed beyond localhost, which is a deployment concern for whoever runs it, not something this codebase enforces.

Don't add auth middleware, rate-limiting beyond what GFW itself enforces, or output sanitization beyond "don't leak raw GFW error bodies" (already handled in `gfw-client`) without a specific reason tied to an actual threat, not because the reference guide has a section for it.

## MCP best practices: what we adopt, adapt, or skip

| Best-practices guide section                                           | Status here                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single Responsibility (one server, one purpose)                        | **Adopt as-is.** This server does GFW and nothing else.                                                                                                                                                                     |
| Defense in depth (network/auth/authz/validation/monitoring layers)     | **Adapted** — collapses to "Zod validation + the token's own scope," see Security model above.                                                                                                                              |
| Fail-safe design / graceful degradation                                | **Adopt, scaled down** — the report queue's 524→last-report fallback is our version of this. No circuit breaker library needed for a single external dependency with one well-understood failure mode.                      |
| Structured error handling / error classification                       | **Adopt.** `gfw-client` should produce a small closed set of typed errors (client error / GFW error / rate-limited / timeout), not leak raw exceptions or raw GFW JSON to tool callers.                                     |
| Configuration management (env-specific YAML overlays)                  | **Skip the overlay system** — one env var (`GFW_API_TOKEN`) plus a couple of optional tuning values (cache TTL, HTTP port) doesn't need a config framework. Plain `process.env` reads with validation at startup is enough. |
| Performance (connection pooling, multi-level cache, async task queues) | **Adapted** — no connection pool (one client, standard `fetch`), but the report queue *is* our async task queue, purpose-built for GFW's specific constraint rather than a generic library.                                 |
| Monitoring/observability (Prometheus, structured logging, metrics)     | **Skip** for now — no operator dashboard exists for an npx-run local tool. Revisit if the Streamable HTTP transport gets deployed as a shared service.                                                                      |
| Health checks / service discovery / Kubernetes                         | **Skip entirely** — not a deployment shape this project has.                                                                                                                                                                |
| Multi-layer testing (unit / integration / contract / load)             | **Adopt, scaled down** — unit tests (mocked GFW responses) + a small live-API smoke suite + MCP protocol conformance tests. No load testing; this isn't a high-throughput service.                                          |
| Chaos engineering                                                      | **Skip** — the one real failure mode (GFW single-concurrency + 524) is already handled directly by the report queue; simulating database failures or network partitions doesn't apply.                                      |