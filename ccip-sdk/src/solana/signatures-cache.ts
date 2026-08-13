import type {
  ConfirmedSignatureInfo,
  Connection,
  Finality,
  PublicKey,
  SignaturesForAddressOptions,
} from '@solana/web3.js'

/** How long a cached signature segment is kept after its last visit */
const SIGS_CACHE_TTL = 30 * 60e3 // 30min
/** Max page size accepted by getSignaturesForAddress */
const SIGS_PAGE_LIMIT = 1000
/** Max number of address lists kept in cache */
const SIGS_CACHE_MAX_ENTRIES = 100
/**
 * How recent a signature must be to be considered finality-stable, in seconds.
 * Finalized lags `confirmed` by ~32 slots (~15s); anything newer may still "wobble"
 * (be rolled back, or have its slot/blockTime change), so we double the margin.
 */
const SIGS_WOBBLE_WINDOW = 30
/**
 * Max pages fetched in an anchored head refresh before assuming the anchor was rolled
 * back (a wobble zone plus new arrivals can never span this many pages).
 */
const SIGS_MAX_HEAD_PAGES = 5

type SigsSegment = {
  /** exclusive end index (in `sigs`) of this segment; segments are stored newest first */
  end: number
  /** last time this segment was fetched or served to a caller */
  visitedAt: number
}

type SigsCacheEntry = {
  /**
   * Known signatures, newest first. Invariant: contiguous (no holes) — it always
   * represents an unbroken segment of the chain, from the newest signature seen at
   * last head refresh down to the oldest non-expired segment. Signatures are only
   * ever prepended/appended at the edges (never inserted), and expired segments are
   * only ever evicted from the tail inward. The head within {@link SIGS_WOBBLE_WINDOW}
   * is the "wobble zone": not yet finality-stable, it's re-fetched and replaced (not
   * just prepended to) on every head refresh.
   */
  sigs: ConfirmedSignatureInfo[]
  /** set of known signatures, for O(1) dedupe */
  known: Set<string>
  /** recency-tracked segments partitioning `sigs`, aligned to fetched batches */
  segments: SigsSegment[]
  /** true once a short tail batch proves we reached the oldest signature */
  complete: boolean
  /** serializes cache-mutating calls per address */
  pending: Promise<unknown>
}

/**
 * Wraps `connection.getSignaturesForAddress` with a per-address cache of the whole known
 * signature list, to speed up consecutive paginations over the same address.
 *
 * Instead of caching individual RPC responses keyed by their exact arguments, requests are
 * resolved against a single contiguous list of known signatures per address:
 * - requests without `before` refresh the head: everything above the finality-stable
 *   frontier (the wobble zone) is re-fetched and replaced, and only truly new signatures
 *   are prepended (keeping the list hole-free and self-healing from rollbacks);
 * - requests with `before` locate it in the known list and, if there aren't enough entries
 *   below it (bounded by `until`, when known), fetch and append older batches until there
 *   are (or history is exhausted);
 * - unknown `before` anchors (e.g. from other sources) fall back to a direct RPC call.
 *
 * The list is partitioned into segments aligned to fetched batches, each with its own
 * recency: segments are `ttl`-evicted from the tail inward when they haven't been fetched
 * or served in a while, so deep history from old paginations is forgotten while recently
 * visited parts are kept.
 */
export function cacheGetSignaturesForAddress(
  connection: Connection,
  ttl: number = SIGS_CACHE_TTL,
): Connection['getSignaturesForAddress'] {
  const original = connection.getSignaturesForAddress.bind(connection)
  const cache = new Map<string, SigsCacheEntry>()

  function getEntry(key: string): SigsCacheEntry {
    let entry = cache.get(key)
    if (!entry) {
      entry = {
        sigs: [],
        known: new Set(),
        segments: [],
        complete: false,
        pending: Promise.resolve(),
      }
      cache.set(key, entry)
      if (cache.size > SIGS_CACHE_MAX_ENTRIES) {
        // evict oldest (Map iteration is insertion-ordered)
        const oldest = cache.keys().next().value!
        if (oldest !== key) cache.delete(oldest)
      }
    }
    return entry
  }

  /** Evict segments which haven't been visited in `ttl`, from the tail inward */
  function sweep(entry: SigsCacheEntry) {
    const now = Date.now()
    while (
      entry.segments.length > 0 &&
      now - entry.segments[entry.segments.length - 1]!.visitedAt > ttl
    ) {
      const removedEnd = entry.segments[entry.segments.length - 1]!.end
      const newEnd = entry.segments.length > 1 ? entry.segments[entry.segments.length - 2]!.end : 0
      for (let i = newEnd; i < removedEnd; i++) entry.known.delete(entry.sigs[i]!.signature)
      entry.sigs.length = newEnd
      entry.segments.pop()
      entry.complete = false // we no longer reach the oldest signature
    }
  }

  /** Mark segments overlapping [from, to) as visited now */
  function touch(entry: SigsCacheEntry, from: number, to: number) {
    const now = Date.now()
    let start = 0
    for (const seg of entry.segments) {
      if (seg.end > from && start < to) seg.visitedAt = now
      start = seg.end
    }
  }

  /** Append a fetched batch at the tail (older than everything known) */
  function append(entry: SigsCacheEntry, batch: ConfirmedSignatureInfo[]) {
    let added = 0
    for (const sig of batch) {
      if (entry.known.has(sig.signature)) continue
      entry.known.add(sig.signature)
      entry.sigs.push(sig)
      added++
    }
    if (added) entry.segments.push({ end: entry.sigs.length, visitedAt: Date.now() })
  }

  /**
   * Fetch what's newer than the finality-stable frontier and repair the wobble zone.
   *
   * Signatures newer than {@link SIGS_WOBBLE_WINDOW} may be rolled back or have their
   * slot/blockTime changed, so instead of blindly prepending we re-fetch everything
   * above the frontier (anchored with `until` at the newest stable sig, when there is
   * one) and replace the whole wobble zone with exactly what the RPC returns now:
   * rolled-back sigs are dropped, changed slots updated, keeping the list contiguous
   * and self-healing. If the anchor itself was rolled back (refresh spans more than
   * {@link SIGS_MAX_HEAD_PAGES} pages), the entry is reset and re-fetched unanchored.
   */
  async function refreshHead(entry: SigsCacheEntry, address: PublicKey, commitment?: Finality) {
    const stableBefore = Date.now() / 1000 - SIGS_WOBBLE_WINDOW
    const frontierIdx = entry.sigs.findIndex((sig) => (sig.blockTime ?? Infinity) < stableBefore)
    // anchor at the newest finality-stable sig (unanchored if the whole cache is wobbly)
    const anchor = frontierIdx >= 0 ? entry.sigs[frontierIdx]!.signature : undefined
    const hadKnown = entry.sigs.length > 0

    const fresh: ConfirmedSignatureInfo[] = []
    let junction: string | undefined // first still-canonical known sig below the fresh region
    let before: string | undefined
    for (let pages = 0; ; pages++) {
      const batch = await original(
        address,
        { limit: SIGS_PAGE_LIMIT, ...(before && { before }), ...(anchor && { until: anchor }) },
        commitment,
      )
      if (!anchor) {
        // unanchored: splice at the first still-canonical known sig
        const overlap = batch.findIndex((sig) => entry.known.has(sig.signature))
        if (overlap >= 0) {
          fresh.push(...batch.slice(0, overlap))
          junction = batch[overlap]!.signature
          break
        }
      }
      fresh.push(...batch)
      if (batch.length < SIGS_PAGE_LIMIT) {
        // anchored: the RPC walked down to our anchor, so `fresh` is the whole wobble zone
        if (anchor) junction = anchor
        else entry.complete = true // unanchored: reached the oldest signature
        break
      }
      // empty cache: fetch only the head batch; older history is fetched lazily below
      if (!hadKnown) break
      if (anchor && pages + 1 >= SIGS_MAX_HEAD_PAGES) {
        // more new sigs than a wobble zone can hold: our anchor was likely rolled back;
        // reset the entry and re-fetch unanchored
        entry.sigs = []
        entry.known.clear()
        entry.segments = []
        entry.complete = false
        return refreshHead(entry, address, commitment)
      }
      before = batch[batch.length - 1]!.signature
    }

    // splice: replace everything above the junction (wobble zone) with `fresh`
    const stableStart = junction
      ? entry.sigs.findIndex((sig) => sig.signature === junction)
      : entry.sigs.length
    if (fresh.length === 0 && stableStart <= 0) return // nothing new, nothing wobbled

    for (let i = 0; i < stableStart; i++) entry.known.delete(entry.sigs[i]!.signature)
    const kept = entry.sigs.slice(stableStart)
    const freshOnes = fresh.filter((sig) => !entry.known.has(sig.signature))
    for (const sig of freshOnes) entry.known.add(sig.signature)
    const shift = freshOnes.length - stableStart
    entry.segments = entry.segments.filter((seg) => seg.end > stableStart)
    for (const seg of entry.segments) seg.end += shift
    if (freshOnes.length) entry.segments.unshift({ end: freshOnes.length, visitedAt: Date.now() })
    entry.sigs = freshOnes.concat(kept)
  }

  async function getSigs(
    entry: SigsCacheEntry,
    address: PublicKey,
    options?: SignaturesForAddressOptions,
    commitment?: Finality,
  ): Promise<ConfirmedSignatureInfo[]> {
    sweep(entry)
    const limit = Math.min(options?.limit ?? SIGS_PAGE_LIMIT, SIGS_PAGE_LIMIT)
    let startIdx = 0
    if (options?.before) {
      startIdx = entry.sigs.findIndex((sig) => sig.signature === options.before)
      if (startIdx < 0) {
        // `before` may be newer than our head (e.g. arrived since last fetch): refresh and retry
        await refreshHead(entry, address, commitment)
        startIdx = entry.sigs.findIndex((sig) => sig.signature === options.before)
        if (startIdx < 0) {
          // unknown anchor: passthrough without caching
          return original(address, options, commitment)
        }
      }
      startIdx += 1
    } else {
      await refreshHead(entry, address, commitment)
    }

    // Resolve `until` against the known list. Because the list is contiguous, a real
    // signature between our head and tail is always known; an unknown `until` is thus
    // either newer than our head or older than our tail, and in both cases (matching
    // RPC semantics) it doesn't truncate a `limit`-sized window. An `until` at or
    // newer than `before` doesn't truncate either (the RPC walks backwards from
    // `before` and never reaches it).
    const untilIdx = options?.until
      ? entry.sigs.findIndex((sig) => sig.signature === options.until)
      : -1
    const end = untilIdx > startIdx ? Math.min(startIdx + limit, untilIdx) : startIdx + limit

    // extend the tail until we have `end` entries to return (or history is exhausted)
    while (entry.sigs.length < end && !entry.complete) {
      const tail = entry.sigs[entry.sigs.length - 1]
      const batch = await original(
        address,
        { limit: SIGS_PAGE_LIMIT, ...(tail && { before: tail.signature }) },
        commitment,
      )
      append(entry, batch)
      if (batch.length < SIGS_PAGE_LIMIT) entry.complete = true
      if (!batch.length) break
    }

    touch(entry, startIdx, Math.min(end, entry.sigs.length))
    return entry.sigs.slice(startIdx, end)
  }

  return function getSignaturesForAddress(
    address: PublicKey,
    options?: SignaturesForAddressOptions,
    commitment?: Finality,
  ): Promise<ConfirmedSignatureInfo[]> {
    // `processed` wobbles too hard to cache; options beyond our cache model: passthrough
    // (`processed` isn't in the `Finality` type, but untyped callers may still pass it)
    if ((commitment as string) === 'processed' || options?.minContextSlot != null) {
      return original(address, options, commitment)
    }
    const entry = getEntry(`${address.toBase58()}:${commitment ?? ''}`)
    // serialize per-address calls so concurrent paginations share fetches
    const result = entry.pending.then(() => getSigs(entry, address, options, commitment))
    entry.pending = result.catch(() => {})
    return result
  }
}
