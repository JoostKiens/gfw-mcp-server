# cache

Generic in-memory caching primitives, scoped to the life of one process. The
vessel metadata cache is a bare `Cache` instance constructed at module scope in
`../tools/find-vessels.ts` (no `ttlMs` — vessel identity doesn't change within a
process run); EEZ region lookups still need their own instance constructed when
`find_region` is implemented. The 4Wings report cache is already wired up inside
`ReportQueue` below.

- `cache.ts` — `Cache<K, V>`, a `Map`-backed cache class with optional per-instance
  TTL (stateful infrastructure, per `docs/claude/conventions.md`). Expiry is lazy
  (checked on `get`/`has`, no background sweeping) so the process can exit cleanly
  under STDIO. Omitting `ttlMs` means entries never expire. `K` is constrained to
  `string | number` — a `Map` compares object keys by reference, so a structural
  key would silently never hit; normalize an object key to a string first (see
  `normalize-key.ts`).
- `normalize-key.ts` — `normalizeKey`, stable-stringifies a params object with object
  keys sorted recursively (array order preserved) so differently-ordered but
  equivalent param sets produce the same cache key. `Date`, `NaN`/`Infinity`,
  and `undefined` are tagged distinctly so they don't collapse into `{}`/`null`/a
  dropped key and collide with an unrelated param value. Throws on a circular
  params object rather than overflowing the stack.
- `report-queue.ts` — `ReportQueue`, the single-concurrency lock, 15-min report
  cache, and 524/`last-report` recovery for GFW's `4wings/report` endpoint
  (stateful infrastructure, per `docs/claude/conventions.md`). One instance should
  be shared across every tool that hits the endpoint (`get_fishing_activity`,
  `get_dark_vessel_detections`, `get_vessel_presence`) — GFW's one-concurrent-report
  limit is per token, not per tool. Never call `4wings/report` directly; go through
  `ReportQueue.run()`.
