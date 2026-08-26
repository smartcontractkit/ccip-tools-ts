import type { TonClient } from '@ton/ton'

// `@ton/ton`'s TonClient hardcodes an unbounded InMemoryCache for its internal
// TypedCaches (see HttpApi): `shardCache` grows one entry per seqno forever and
// `shardTransactionsCache` additionally serializes whole block responses.
// On long-lived workers (TON watch activities) that accumulates without limit.
//
// The TypedCache instances read their backing store through a property at call
// time (`this.cache.get(...)`), so re-pointing that property at a bounded LRU
// is sufficient — no subclassing, no forked client, nothing else touched.

/** Structural alias for the internal Cache interface of `@ton/ton` (not exported). */
export interface TonStringCache {
  get(namespace: string, key: string): Promise<string | null>
  set(namespace: string, key: string, value: string | null): Promise<void>
}

/** Budgets applied to a {@link BoundedStringCache}. */
export interface TonStringCacheLimits {
  /** Maximum number of entries (default 10_000). */
  maxEntries?: number
  /** Maximum total payload size in bytes, keys included (default 2 MiB). */
  maxBytes?: number
}

/**
 * Bounded LRU over the JSON-string values that the `TypedCache` of `@ton/ton`
 * stores. Backed by an insertion-ordered Map: `get` refreshes recency, and an
 * overflowing `set` evicts the oldest entries until both budgets hold again.
 * A `null` value deletes the entry, per the `@ton/ton` Cache contract.
 */
export class BoundedStringCache implements TonStringCache {
  /** Maximum number of entries retained. */
  readonly maxEntries: number
  /** Maximum total payload size in bytes, keys included. */
  readonly maxBytes: number

  /** Underlying store; keys are `namespace$$key` (the `@ton/ton` convention). */
  map = new Map<string, { value: string; bytes: number }>()
  /** Current total payload size in bytes, keys included. */
  bytes = 0

  /**
   * Creates an empty cache with the given budgets.
   *
   * @param limits - entry and byte budgets; omitted values fall back to
   *   {@link TON_CLIENT_CACHE_DEFAULTS}-like sane defaults (10k / 2 MiB).
   */
  constructor(limits: TonStringCacheLimits = {}) {
    this.maxEntries = limits.maxEntries ?? 10_000
    this.maxBytes = limits.maxBytes ?? 2 * 1024 * 1024
  }

  /** Number of live entries. */
  get size(): number {
    return this.map.size
  }

  /**
   * Fetches a value, refreshing its recency on a hit.
   *
   * @param namespace - cache namespace (e.g. `ton-shard`).
   * @param key - namespace-scoped key (e.g. a seqno string).
   * @returns the stored value, or `null` when absent.
   */
  async get(namespace: string, key: string): Promise<string | null> {
    const k = `${namespace}$$$${key}`
    const hit = this.map.get(k)
    if (hit === undefined) return null
    // refresh recency: re-inserting appends to the insertion order
    this.map.delete(k)
    this.map.set(k, hit)
    return hit.value
  }

  /**
   * Stores a value, evicting oldest-first until both budgets hold again.
   *
   * @param namespace - cache namespace (e.g. `ton-shard`).
   * @param key - namespace-scoped key (e.g. a seqno string).
   * @param value - value to store; `null` deletes the entry.
   */
  async set(namespace: string, key: string, value: string | null): Promise<void> {
    const k = `${namespace}$$$${key}`
    const prev = this.map.get(k)
    if (prev !== undefined) {
      this.map.delete(k)
      this.bytes -= prev.bytes
    }
    if (value !== null) {
      const entry = { value, bytes: (k.length + value.length) * 2 }
      this.map.set(k, entry)
      this.bytes += entry.bytes
    }
    this.trim()
  }

  /** Evicts oldest-first until both budgets hold again. */
  private trim(): void {
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      const dead = this.map.get(oldest.value)!
      this.map.delete(oldest.value)
      this.bytes -= dead.bytes
    }
  }
}

/** Per-cache budgets for {@link boundTonClientCaches}. */
export interface BoundTonClientCacheLimits {
  /** Entry cap for the shard-list cache (default 10_000). */
  shardMaxEntries?: number
  /** Byte cap for the shard-list cache (default 2 MiB). */
  shardMaxBytes?: number
  /** Entry cap for the shard-transactions cache (default 2_000). */
  shardTxMaxEntries?: number
  /** Byte cap for the shard-transactions cache (default 16 MiB). */
  shardTxMaxBytes?: number
}

/** Default budgets for {@link boundTonClientCaches}. */
export const TON_CLIENT_CACHE_DEFAULTS: Required<BoundTonClientCacheLimits> = {
  shardMaxEntries: 10_000,
  shardMaxBytes: 2 * 1024 * 1024, // blockIdExt heads are ~150 B
  shardTxMaxEntries: 2_000,
  shardTxMaxBytes: 16 * 1024 * 1024, // whole shard transaction lists
}

type TypedCacheBacking = { cache: TonStringCache }
type TonClientInternals = {
  api?: { shardCache?: TypedCacheBacking; shardTransactionsCache?: TypedCacheBacking }
}

/**
 * Re-points the TonClient's internal TypedCaches (shard lists and whole shard
 * transaction blocks) at bounded LRU stores, replacing the unbounded
 * InMemoryCache `@ton/ton` hardcodes in `HttpApi`. Unknown layouts are ignored
 * defensively (the client falls back to its default cache), so a future
 * `@ton/ton` reshuffle degrades instead of breaking chain construction.
 *
 * `.api` is `protected` in the typings and the TypedCache backings are
 * `private`, but all of them are plain runtime properties.
 *
 * @param client - the TonClient whose caches to bound (no network calls made).
 * @param limits - optional per-cache budgets; see {@link TON_CLIENT_CACHE_DEFAULTS}.
 */
export function boundTonClientCaches(
  client: TonClient,
  limits: BoundTonClientCacheLimits = {},
): void {
  const { shardMaxEntries, shardMaxBytes, shardTxMaxEntries, shardTxMaxBytes } = {
    ...TON_CLIENT_CACHE_DEFAULTS,
    ...limits,
  }
  const internals = client as unknown as TonClientInternals
  if (internals.api?.shardCache) {
    internals.api.shardCache.cache = new BoundedStringCache({
      maxEntries: shardMaxEntries,
      maxBytes: shardMaxBytes,
    })
  }
  if (internals.api?.shardTransactionsCache) {
    internals.api.shardTransactionsCache.cache = new BoundedStringCache({
      maxEntries: shardTxMaxEntries,
      maxBytes: shardTxMaxBytes,
    })
  }
}
