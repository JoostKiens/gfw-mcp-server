export interface CacheOptions {
  /** Time-to-live in ms for every entry in this cache. Omit for entries that never expire. */
  readonly ttlMs?: number;
  /** Injectable clock, defaults to Date.now. Tests supply a fake to avoid real timers/sleeps. */
  readonly now?: () => number;
}

interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number | undefined;
}

/**
 * K is constrained to string | number (not arbitrary objects) because entries
 * are stored in a Map, which compares object/array keys by reference — a
 * structural key would silently never hit. Build a string key with
 * normalizeKey first if the natural key is an object.
 */
export class Cache<K extends string | number, V> {
  private readonly ttlMs: number | undefined;
  private readonly now: () => number;
  private readonly store = new Map<K, CacheEntry<V>>();

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: K): V | undefined {
    return this.getEntry(key)?.value;
  }

  has(key: K): boolean {
    return this.getEntry(key) !== undefined;
  }

  set(key: K, value: V): void {
    this.store.set(key, {
      value,
      expiresAt: this.ttlMs === undefined ? undefined : this.now() + this.ttlMs,
    });
  }

  private getEntry(key: K): CacheEntry<V> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }
}
