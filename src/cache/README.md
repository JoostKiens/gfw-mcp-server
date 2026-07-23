# cache

Generic in-memory caching primitives, scoped to the life of one process. No consumer
instantiates a cache yet — tools that need one (vessel metadata, 4Wings report
responses, EEZ region lookups) construct their own typed `Cache` instance when
those tools are implemented.

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
