import { Buffer } from 'buffer'

import { type Transaction, Address, Cell, beginCell, fromNano, toNano } from '@ton/core'
import { TonClient } from '@ton/ton'
import { type BytesLike, hexlify, isBytesLike, isHexString, toBeArray, toBeHex } from 'ethers'
import { memoize } from 'micro-memoize'

import {
  decodeLegacyEVMTONExtraArgs,
  decodeTONExtraArgsCell,
  encodeExtraArgsCell,
} from './extra-args.ts'
import {
  type TonV3Event,
  fetchV3IndexedTip,
  openV3EventStream,
  streamTransactionsForAddress,
  streamV3TxMeta,
  tonV3BaseUrl,
} from './logs.ts'
import { generateUnsignedCcipSend, getFee as getFeeImpl } from './send.ts'
import { boundTonClientCaches } from './ton-cache.ts'
import {
  type BlockInfo,
  type ChainContext,
  type ChainStatic,
  type GetBalanceOpts,
  type LogFilter,
  type TokenTransferFeeOpts,
  Chain,
  withSinceStart,
} from '../chain.ts'
import { type UnsignedTONTx, isTONWallet } from './types.ts'
import {
  CCIPArgumentInvalidError,
  CCIPError,
  CCIPErrorCode,
  CCIPExecutionReportChainMismatchError,
  CCIPHttpError,
  CCIPLogsAddressRequiredError,
  CCIPLogsRequiresStartError,
  CCIPLogsStreamInconsistentError,
  CCIPNotImplementedError,
  CCIPReceiptNotFoundError,
  CCIPSourceChainUnsupportedError,
  CCIPTopicsInvalidError,
  CCIPTransactionNotFoundError,
  CCIPWalletInvalidError,
} from '../errors/index.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import type { EVMExtraArgsV2, ExtraArgs, SVMExtraArgsV1, SuiExtraArgsV1 } from '../extra-args.ts'
import { createAxiosFetchAdapter, createRateLimitedFetch, fetchProfileForUrl } from '../fetch.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import { buildMessageForDest } from '../requests.ts'
import { supportedChains } from '../supported-chains.ts'
import {
  type AnyMessage,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainLog,
  type ChainTransaction,
  type CommitReport,
  type ExecutionInput,
  type ExecutionReceipt,
  type Lane,
  type LeanNumbers,
  type WithLogger,
  CCIPVersion,
  ExecutionState,
} from '../types.ts'
import {
  bytesToBuffer,
  decodeAddress,
  decodeOnRampAddress,
  parseTypeAndVersion,
  passesTypeAndVersion,
} from '../utils.ts'
import { generateUnsignedExecuteReport } from './exec.ts'
import { getTONLeafHasher } from './hasher.ts'
import { crc32, lookupTxByRawHash, parseJettonContent } from './utils.ts'
export type { TONWallet, UnsignedTONTx } from './types.ts'

/**
 * Type guard to check if an error is a TVM error with an exit code.
 * TON VM errors include an exitCode property indicating the error type.
 */
function isTvmError(error: unknown): error is Error & { exitCode: number } {
  return error instanceof Error && 'exitCode' in error && typeof error.exitCode === 'number'
}

/**
 * Whether the shard `shardStr` (a signed-64-bit shard prefix, as returned by
 * getWorkchainShards) contains `acct`. A TON shard is identified by its address
 * prefix with the lowest set bit marking the prefix boundary; the root shard
 * 0x8000000000000000 covers the whole workchain. Used to pick the shard block an
 * account's transactions live in when a workchain is split into multiple shards.
 */
function shardContainsAccount(shardStr: string, acct: Address): boolean {
  const shard = BigInt.asUintN(64, BigInt(shardStr))
  // Account's top 64 address bits — the part a shard prefix discriminates on.
  const accPrefix = BigInt.asUintN(64, BigInt('0x' + acct.hash.subarray(0, 8).toString('hex')))
  const delimiter = shard & (~shard + 1n) // lowest set bit
  const mask = BigInt.asUintN(64, ~((delimiter << 1n) - 1n)) // bits strictly above the delimiter
  return (accPrefix & mask) === (shard & mask)
}

/**
 * TON-specific {@link ChainContext} extras. Optional and local to this module on
 * purpose: the shared ChainContext stays family-agnostic, while TON's secondary index
 * API (TonCenter v3, used by the getLogs fast path) accepts its own fetch override.
 * `v3Fetch` defaults to `fetch` verbatim when one is provided; otherwise the chain
 * builds a host-paced, fail-fast instance itself.
 */
export type TONChainContext = ChainContext & {
  /** Fetch override for the TonCenter v3 index API (see TONChain.v3FetchFor). */
  v3Fetch?: typeof fetch
}

/**
 * TON chain implementation supporting TON networks.
 *
 * TON uses two different ordering concepts:
 * - `seqno` (sequence number): The actual block number in the masterchain
 * - `lt` (logical time): A per-account transaction ordering timestamp
 *
 * This implementation uses the masterchain `seqno` for the `blockNumber` field and
 * the message's `lt` for the `logIndex` field. The `startBlock`/`endBlock` filter
 * parameters accept masterchain seqnos and are converted to lt ranges internally.
 */
export class TONChain extends Chain<typeof ChainFamily.TON> {
  static {
    supportedChains[ChainFamily.TON] = TONChain
  }

  // Minimum estimated floor age for the index-driven bounded walk to engage (see
  // windowAgeSeconds). Shallower windows stay on the plain v2 pagination.
  private static readonly WALK_META_MIN_AGE_S = 4 * 3600 // ~4h
  static readonly family = ChainFamily.TON
  static readonly decimals = 9 // GRAM uses 9 decimals (nanograms)
  static readonly extraArgGasLimitMin = toNano('0.025') // 0.025 GRAM
  readonly rateLimitedFetch: typeof fetch
  readonly provider: TonClient

  /**
   * Creates a new TONChain instance.
   * @param client - TonClient instance.
   * @param network - Network information for this chain.
   * @param ctx - Context containing logger.
   */
  constructor(client: TonClient, network: NetworkInfo, ctx?: TONChainContext) {
    super(network, ctx)
    this.provider = client

    // Use caller-supplied fetch verbatim; fall back to a rate-limited default.
    this.rateLimitedFetch =
      ctx?.fetch ??
      createRateLimitedFetch({ seed: { limit: 1, windowMs: 1500 }, maxRetries: 6 }, ctx)

    // v3 index fetch: an explicit `v3Fetch` (TON-local ctx extra) wins; a
    // caller-provided `fetch` is reused verbatim (tests, tuned callers); otherwise the
    // first v3 call lazily installs a host-paced, fail-fast instance (see v3FetchFor).
    this.v3Fetch_ = ctx?.v3Fetch ?? ctx?.fetch

    this.getTransaction = memoize(this.getTransaction.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 5e3,
    })

    this.getBlockInfo = memoize(this.getBlockInfo.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 600e3,
      forceUpdate: ([k]) => (typeof k !== 'number' && typeof k !== 'bigint') || k <= 0,
    })

    this.typeAndVersion = memoize(this.typeAndVersion.bind(this), {
      maxArgs: 1,
      async: true,
      maxSize: 100,
      expires: 600e3,
    })

    this.getOnRampConfig = memoize(this.getOnRampConfig.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 10,
      expires: 60e3,
    })
    this.getOffRampConfig = memoize(this.getOffRampConfig.bind(this), {
      async: true,
      maxArgs: 2,
      maxSize: 10,
      expires: 60e3,
    })
    this.getMCSeqNoByLt = memoize(this.getMCSeqNoByLt.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 600e3,
    })
    this.getMCSeqNoByUnixtime = memoize(this.getMCSeqNoByUnixtime.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
    })
    this.getMCBlockHeader = memoize(this.getMCBlockHeader.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 600e3,
    })
    this.getWorkchainShards = memoize(this.getWorkchainShards.bind(this), {
      async: true,
      maxArgs: 1,
      maxSize: 100,
      expires: 600e3,
    })
    this.getShardBlockEndLt = memoize(this.getShardBlockEndLt.bind(this), {
      async: true,
      maxArgs: 3,
      maxSize: 200,
      expires: 600e3,
    })
  }

  /**
   * Detect client network and instantiate a TONChain instance.
   * @param client - TonClient instance connected to the TON network.
   * @param ctx - Optional chain context with logger, API client, and fetch function.
   * @returns TONChain instance configured for the detected network (mainnet or testnet).
   */
  static async fromClient(client: TonClient, ctx?: TONChainContext): Promise<TONChain> {
    // Verify connection by getting the latest block
    const isMainnet =
      (
        await client.getContractState(
          Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'), // mainnet USDT
        )
      ).state === 'active'
    return new TONChain(client, networkInfo(isMainnet ? 'ton-mainnet' : 'ton-testnet'), ctx)
  }

  /**
   * Creates a TONChain instance from an RPC URL.
   * Verifies the connection and detects the network.
   *
   * @param url - RPC endpoint URL for TonClient (v2).
   * @param ctx - Context containing logger.
   * @returns A new TONChain instance.
   * @throws {@link CCIPHttpError} if connection to the RPC endpoint fails
   */
  static async fromUrl(url: string, ctx?: TONChainContext): Promise<TONChain> {
    const { logger = console } = ctx ?? {}
    if (!url.endsWith('/jsonRPC')) url += '/jsonRPC'

    // Resolve the fetch function: user-supplied verbatim, then rate-limited default.
    const fetchFn: typeof fetch = ctx?.fetch ?? createRateLimitedFetch(fetchProfileForUrl(url), ctx)
    // Same provenance for the v3 index fetch (a TON-local ctx extra): a
    // caller-supplied fetch is reused verbatim; the default path gets a dedicated
    // paced, fail-fast instance instead of the v2 endpoint's profile (see v3FetchFor).
    const v3Fetch: typeof fetch | undefined =
      ctx?.v3Fetch ??
      ctx?.fetch ??
      createRateLimitedFetch(
        { seed: { limit: 1, windowMs: 1500 }, maxRetries: 2, keyBy: 'origin' },
        ctx,
      )

    // For known public providers, detect network from URL to avoid an API call during init
    // (free-tier endpoints are rate-limited and return transient 5xx errors).
    let isMainnetHint: boolean | undefined

    if (['toncenter.com', 'tonapi.io'].some((d) => url.includes(d))) {
      // testnet.toncenter.com / testnet.tonapi.io → testnet; bare domain → mainnet
      isMainnetHint = !url.includes('testnet.')
    }

    // Always use the fetch adapter so our fetch function is used for all requests.
    // Also merges ctx.abort into every request signal so raceAc.abort() cancels in-flight sockets.
    const httpAdapter = createAxiosFetchAdapter(fetchFn, ctx?.abort)

    const client = new TonClient({ endpoint: url, httpAdapter })
    // @ton/ton hardcodes a per-client unbounded InMemoryCache for its internal
    // shard/block caches; swap it for bounded LRUs so long-lived workers with
    // watch-mode getLogs don't accumulate seqno-keyed entries forever.
    boundTonClientCaches(client)
    try {
      const chain =
        isMainnetHint !== undefined
          ? new TONChain(client, networkInfo(isMainnetHint ? 'ton-mainnet' : 'ton-testnet'), {
              ...ctx,
              fetch: fetchFn,
              v3Fetch,
            })
          : await this.fromClient(client, { ...ctx, fetch: fetchFn, v3Fetch })
      logger.debug(`Connected to TON V2 endpoint: ${url}`)
      return chain
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new CCIPHttpError(0, `Failed to connect to TONv2 endpoint ${url}: ${message}`)
    }
  }

  /**
   * Fetches the block seqno (number) for a given logical time (lt).
   * @internal
   */
  async getMCSeqNoByLt(lt: number | bigint): Promise<number> {
    const res = await this.rateLimitedFetch(this.provider.parameters.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'lookupBlock',
        params: {
          workchain: -1,
          shard: '-9223372036854775808',
          lt: lt.toString(),
        },
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new CCIPHttpError(res.status, `Failed to lookupBlock by lt=${lt}: ${text}`)
    }
    const { result } = (await res.json()) as { result: { seqno: number } }
    return result.seqno
  }

  /**
   * The masterchain block current at a unix time — the last with `gen_utime` at or
   * before it (v2 `lookupBlock` by `unixtime`). Errors when the time is past the
   * node's tip; callers handle that case.
   * @internal
   */
  async getMCSeqNoByUnixtime(utime: number): Promise<number> {
    const res = await this.rateLimitedFetch(this.provider.parameters.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'lookupBlock',
        params: {
          workchain: -1,
          shard: '-9223372036854775808',
          unixtime: utime,
        },
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new CCIPHttpError(res.status, `Failed to lookupBlock by unixtime=${utime}: ${text}`)
    }
    const { result } = (await res.json()) as { result: { seqno: number } }
    return result.seqno
  }

  /**
   * The exclusive account-lt cursor for a `startTime` bound: the shard-lt boundary of
   * the masterchain block current at that time. Whole-block semantics — the boundary
   * block is scanned whole (its txs may slightly predate startTime), matching EVM's
   * startTime handling.
   * @internal
   */
  async floorLtForTime(startTime: number | bigint, acct: Address): Promise<bigint> {
    const utime = Math.max(0, Math.floor(Number(startTime)))
    let b: number
    try {
      b = await this.getMCSeqNoByUnixtime(utime)
    } catch (err) {
      // lookupBlock errors when the time is past the node's tip. Confirm against the
      // tip's own timestamp: a genuinely future startTime means an empty backfill —
      // the floor is the tip's shard end and a watch proceeds from there. Anything
      // else (transient RPC failure) rethrows.
      const tip = await this.getBlockInfo('latest').catch(() => undefined)
      if (!tip || utime <= tip.timestamp) throw err
      return this.accountShardEndLt(tip.number, acct)
    }
    return b > 1 ? this.accountShardEndLt(b - 1, acct) : 0n
  }

  /**
   * Fetches the masterchain block header by seqno.
   * @internal
   */
  async getMCBlockHeader(
    block: number | bigint,
  ): Promise<{ gen_utime: number; start_lt: string; end_lt: string; min_ref_mc_seqno: number }> {
    const res = await this.rateLimitedFetch(this.provider.parameters.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getBlockHeader',
        params: {
          workchain: -1,
          shard: '-9223372036854775808',
          seqno: Number(block),
        },
      }),
    })
    if (!res.ok) {
      throw new CCIPHttpError(
        res.status,
        `Failed to getBlockHeader by seqno=${block}: ${await res.text()}`,
      )
    }
    const { result } = (await res.json()) as {
      result: Awaited<ReturnType<TONChain['getMCBlockHeader']>>
    }
    return result
  }

  /**
   * List the shard blocks referenced by a masterchain block. Thin memoized wrapper
   * over the provider call, used to resolve which shard block committed an account's
   * transactions at a given masterchain seqno.
   * @internal
   */
  async getWorkchainShards(mcSeqno: number) {
    return this.provider.getWorkchainShards(mcSeqno)
  }

  /**
   * The `end_lt` of a shard block — the highest logical time it commits. Fetched via
   * getBlockHeader for an arbitrary (workchain, shard, seqno), unlike getMCBlockHeader
   * which is masterchain-only.
   * @internal
   */
  async getShardBlockEndLt(workchain: number, shard: string, seqno: number): Promise<bigint> {
    const res = await this.rateLimitedFetch(this.provider.parameters.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getBlockHeader',
        params: { workchain, shard, seqno },
      }),
    })
    if (!res.ok) {
      throw new CCIPHttpError(
        res.status,
        `Failed to getBlockHeader by shard=${shard} seqno=${seqno}: ${await res.text()}`,
      )
    }
    const { result } = (await res.json()) as { result: { end_lt: string } }
    return BigInt(result.end_lt)
  }

  /**
   * The highest account logical time committed by masterchain block `mcSeqno` for the
   * shard `acct` lives in — i.e. the `end_lt` of that shard block. This is the exact,
   * authoritative boundary between what masterchain block `mcSeqno` finalizes and what
   * a later block does, unlike the masterchain-lt-range approximation `getMCSeqNoByLt`
   * (which under-assigns). getLogs uses it to page in account-shard-lt space and to cut
   * scans at complete blocks.
   * @internal
   */
  async accountShardEndLt(mcSeqno: number, acct: Address): Promise<bigint> {
    const shards = await this.getWorkchainShards(mcSeqno)
    const inWorkchain = shards.filter((s) => s.workchain === acct.workChain)
    const shard =
      inWorkchain.find((s) => shardContainsAccount(s.shard, acct)) ?? inWorkchain[0] ?? shards[0]
    if (!shard) throw new CCIPHttpError(0, `No shard for workchain=${acct.workChain} @${mcSeqno}`)
    return this.getShardBlockEndLt(shard.workchain, shard.shard, shard.seqno)
  }

  /**
   * The masterchain seqno that actually commits the account transaction at logical time
   * `lt` — the first block whose account-shard `end_lt` covers `lt`. `getMCSeqNoByLt`
   * maps by masterchain lt range and under-assigns (returns a block at/earlier than the
   * committing one); this climbs from that lower bound to the true committing block, so
   * a tx's `blockNumber` is stable and never appears "in" an already-passed block.
   * @internal
   */
  // Dedicated fetch for the v3 index: seeded from the INDEX host's profile (paced —
  // the public keyless quota is ~1 RPS per egress IP) and fail-fast (2 retries) — the
  // v2 walk remains the patient path. Reusing the v2 endpoint's fetch for v3 calls
  // would inherit an unseeded full-speed profile (bursts → 429 storms) and its deep
  // retry budget (minute-plus stalls before the fallback can engage). Pre-set by the
  // constructor when the caller supplies `v3Fetch`/`fetch`; lazily created otherwise.
  private v3Fetch_?: typeof fetch

  /** The dedicated v3-index fetch (see the note above); lazily created when unset. */
  private v3FetchFor(baseUrl: string): typeof fetch {
    // keyBy origin: the index's keyless quota (~1 RPS per egress IP) is shared
    // across /messages, /transactions and /masterchainInfo — per-path limiters
    // would each pace independently and re-burst the host, tripping 429s.
    return (this.v3Fetch_ ??= createRateLimitedFetch(
      { ...fetchProfileForUrl(baseUrl), maxRetries: 2, keyBy: 'origin' },
      { logger: this.logger },
    ))
  }

  // The v3 index's masterchain tip, cached 30s: the lag guard is network-global, so a
  // scan should pay one index call (its messages page), not two.
  private v3Tip_?: { at: number; seqno: number }

  /**
   * Rough age (seconds) of a scan floor in lt space, estimated live from the account's
   * two newest transactions: lt advances ~2.5e6/s sustained on ton-testnet (up to ~2×
   * faster in bursts), clamped to [1e6, 1e7]/s. Zero on any failure — the caller then
   * keeps the plain v2 walk, which is the cheap path for shallow windows anyway.
   */
  private async windowAgeSeconds(acct: Address, sinceLt: bigint): Promise<number> {
    try {
      const [newest, prev] = await this.provider.getTransactions(acct, { limit: 2 })
      if (!newest || newest.lt <= sinceLt) return 0 // nothing above the floor
      let ltPerSec = 2_500_000 // sustained rate measured live (ton-testnet, 2026-08)
      if (prev && prev.lt < newest.lt && newest.now > prev.now)
        ltPerSec = Math.min(
          1e7,
          Math.max(1e6, Number(newest.lt - prev.lt) / (newest.now - prev.now)),
        )
      return Number(newest.lt - sinceLt) / ltPerSec
    } catch {
      return 0
    }
  }

  /** The v3 index's masterchain tip, cached 30s (network-global, not per-scan). */
  private async getV3IndexedTip(baseUrl: string): Promise<number> {
    const cached = this.v3Tip_
    if (cached && Date.now() - cached.at < 30_000) return cached.seqno
    const seqno = await fetchV3IndexedTip({
      rateLimitedFetch: this.v3FetchFor(baseUrl),
      v3BaseUrl: baseUrl,
    })
    this.v3Tip_ = { at: Date.now(), seqno }
    return seqno
  }

  // Last masterchain block resolved by lt lookup, with its [start_lt, end_lt) range.
  // Adjacent account txs overwhelmingly commit within the same (or a nearby) mc block,
  // so a long walk over an account's txs would otherwise pay one rate-limited
  // lookupBlock RPC per tx; reusing the range costs one lookup per NEW block instead.
  // The climb below is unaffected: it still runs (memoized) from the range's seqno.
  private lastMcLookup?: { startLt: bigint; endLt: bigint; seqno: number }

  /**
   * The masterchain seqno that actually commits the account transaction at logical
   * time `lt` — the first block whose account-shard `end_lt` covers `lt`.
   * `getMCSeqNoByLt` maps by masterchain lt range and under-assigns (returns a block
   * at/earlier than the committing one); this climbs from that lower bound to the true
   * committing block, so a tx's `blockNumber` is stable and never appears "in" an
   * already-passed block.
   * @internal
   */
  async committingSeqno(lt: number | bigint, acct: Address): Promise<number> {
    const ltBig = BigInt(lt)
    const known = this.lastMcLookup
    let n: number
    if (known && ltBig > known.startLt && ltBig < known.endLt) {
      n = known.seqno // lt falls strictly inside the block we already resolved — no RPC
      // (strict bounds: a tx exactly on start_lt/end_lt always refetches — off-by-one
      // at a block edge must never answer from the memo)
    } else {
      n = await this.getMCSeqNoByLt(lt)
      try {
        // Learn the resolved block's lt range for the next calls (header is memoized).
        const h = await this.getMCBlockHeader(n)
        this.lastMcLookup = { startLt: BigInt(h.start_lt), endLt: BigInt(h.end_lt), seqno: n }
      } catch {
        // a failing header lookup only loses the memo — the resolved seqno stands
      }
    }
    // Climb while the candidate block's shard end_lt is below lt (under-assignment); the
    // under-assignment is small, so this is a handful of memoized lookups at most. Bounded
    // so inconsistent/stale RPC shard data can never spin forever — overshooting the cap
    // just under-assigns, which at worst makes the poller re-scan (idempotent), never skip.
    for (let i = 0; i < 256 && ltBig > (await this.accountShardEndLt(n, acct)); i++) n++
    return n
  }

  /**
   * Fetch the timestamp for a given masterchain block or the latest finalized block.
   *
   * @param block - Masterchain block seqno, or 'finalized'/'latest' for the latest block
   * @returns Unix timestamp in seconds
   */
  async getBlockInfo(block: number | bigint | 'finalized' | 'latest'): Promise<BlockInfo> {
    if (typeof block !== 'number' && typeof block !== 'bigint') {
      const info = await this.provider.getMasterchainInfo()
      block = info.latestSeqno
    }

    const seqno = Number(block)
    const result = await this.getMCBlockHeader(seqno)
    return { number: seqno, timestamp: result.gen_utime }
  }

  /**
   * Fetches a transaction by its hash.
   *
   * Supports two formats:
   * 1. Composite format: "workchain:address:lt:hash" (e.g., "0:abc123...def:12345:abc123...def")
   * 2. Raw hash format: 64-character hex string resolved via TonCenter V3 API
   *
   * Note: TonClient requires (address, lt, hash) for lookups. Raw hash lookups
   * use TonCenter's V3 index API to resolve the hash to a full identifier first.
   *
   * @param tx - Transaction identifier in either format
   * @returns ChainTransaction with transaction details
   *          `blockNumber` is the masterchain seqno; `logIndex` is the message's lt
   * @throws {@link CCIPArgumentInvalidError} if hash format is invalid
   * @throws {@link CCIPTransactionNotFoundError} if transaction not found
   */
  async getTransaction(tx: string | Transaction): Promise<ChainTransaction> {
    let address
    if (typeof tx === 'string') {
      let parts = tx.split(':')

      // If not composite format (4 parts), check if it's a raw 64-char hex hash
      if (parts.length !== 4) {
        const cleanHash = tx.startsWith('0x') || tx.startsWith('0X') ? tx.slice(2) : tx

        if (!/^[a-fA-F0-9]{64}$/.test(cleanHash))
          throw new CCIPArgumentInvalidError(
            'hash',
            `Invalid TON transaction hash format: "${tx}". Expected "workchain:address:lt:hash" or 64-char hex hash`,
          )
        const txInfo = await lookupTxByRawHash(
          cleanHash,
          this.network.networkType,
          this.rateLimitedFetch,
          this,
        )

        tx = `${txInfo.account}:${txInfo.lt}:${cleanHash}`
        this.logger.debug(`Resolved raw hash to composite: ${tx}`)
        parts = tx.split(':')
      }

      // Parse composite format: workchain:address:lt:hash
      address = Address.parseRaw(`${parts[0]}:${parts[1]}`)
      const [, , lt, txHash] = parts as [string, string, string, string]

      // Fetch transactions and find the one we're looking for
      const tx_ = await this.provider.getTransaction(
        address,
        lt,
        Buffer.from(txHash, 'hex').toString('base64'),
      )
      if (!tx_) throw new CCIPTransactionNotFoundError(tx)
      tx = tx_
    } else {
      address = new Address(0, Buffer.from(toBeArray(tx.address, 32)))
    }

    return this.buildChainTransaction(tx, address)
  }

  /**
   * Build a {@link ChainTransaction} from a raw transaction: stamp the composite hash,
   * resolve the committing masterchain seqno (unless one is supplied — e.g. the v3
   * index's authoritative `mc_block_seqno` on the startTime-only fast path), and
   * decode external-out messages into logs.
   * @internal
   */
  async buildChainTransaction(
    tx: Transaction,
    address: Address,
    seqno?: number,
  ): Promise<ChainTransaction> {
    // Extract logs from outgoing external messages
    // Build composite hash format: workchain:address:lt:hash
    const compositeHash = `${address.toRawString()}:${tx.lt}:${tx.hash().toString('hex')}`
    // Authoritative committing masterchain seqno (not the lt-range approximation), so a
    // tx's blockNumber is the block that actually finalizes it and matches getLogs.
    seqno ??= await this.committingSeqno(tx.lt, address)
    const res = {
      hash: compositeHash,
      logs: [] as ChainLog[],
      blockNumber: seqno,
      timestamp: tx.now,
      from: address.toRawString(),
      // Lean chain-link scalars only — never the raw @ton/ton Transaction (tens of KB
      // and hundreds of parsed Cells each): getLogs verifies chain continuity and the
      // resume floor off these, and anything retaining or serializing a log (activity
      // batches, Temporal payloads) stays small.
      lt: tx.lt.toString(),
      prevTransactionLt: tx.prevTransactionLt.toString(),
    }
    const logs: ChainLog[] = []
    for (const [, msg] of tx.outMessages) {
      if (msg.info.type !== 'external-out') continue
      const topics = []
      // logs are external messages where dest "address" is the uint32 topic (e.g. crc32("ExecutionStateChanged"))
      if (
        msg.info.dest &&
        msg.info.dest.value > 0n &&
        msg.info.dest.value < BigInt(2) ** BigInt(32)
      )
        topics.push(toBeHex(msg.info.dest.value, 4))
      let data = ''
      try {
        data = msg.body.toBoc().toString('base64')
      } catch (_) {
        // ignore
      }
      logs.push({
        address: msg.info.src.toRawString(),
        topics,
        data,
        blockNumber: res.blockNumber, // masterchain seqno
        blockTimestamp: tx.now,
        transactionHash: res.hash,
        index: Number(msg.info.createdLt),
        tx: res,
      })
    }
    res.logs = logs
    return res
  }

  /**
   * Consume the v3 event stream (see {@link openV3EventStream}), emitting complete
   * sealed blocks. Mirrors the v2 consumption loop in getLogs, minus the
   * chain-integrity and lt-floor checks: the index is block-atomic (a block's log
   * messages appear all at once), blocks are non-decreasing along the
   * created_lt-ordered stream, and the time floor is applied index-side. A block
   * rewind or a truncated tail drops the block in progress and stops — the poller
   * resumes from its hint.
   */
  private async *emitSealedV3Events(
    stream: AsyncGenerator<TonV3Event, void, undefined>,
    opts: LeanNumbers<LogFilter>,
    cutoff: number,
    matches: (log: ChainLog) => boolean,
  ): AsyncIterableIterator<ChainLog> {
    let curBlock: number | undefined
    let buf: ChainLog[] = []
    // A `since` hint's per-log index (the hinted message's created_lt): the index
    // floor at index + 1 excludes the hint's own ROW, but hydration decodes the
    // WHOLE hinted tx — drop its messages at/before the hint; same-tx followers
    // (batch execution) still flow.
    const sinceIndexLt = opts.since?.index != null ? BigInt(opts.since.index) : undefined
    // Emit the current block's buffered logs iff it is within the sealed cutoff; reset.
    const drain = async function* (chain: TONChain): AsyncIterableIterator<ChainLog> {
      const out = curBlock !== undefined && curBlock <= cutoff ? buf : []
      buf = []
      for (const log of out) {
        if (sinceIndexLt != null && BigInt(log.index) <= sinceIndexLt) continue
        if (await passesTypeAndVersion(chain, log.address, opts.typeAndVersions)) yield log
      }
    }

    for await (const item of stream) {
      if (!('tx' in item)) {
        // Truncated on index inconsistency: the block in progress may be incomplete.
        buf = []
        curBlock = undefined
        break
      }
      const block = item.tx.blockNumber
      if (curBlock !== undefined && block < curBlock) {
        this.logger.warn(
          `TON getLogs v3: block rewind ${curBlock} -> ${block} mid-stream; stopping scan`,
        )
        buf = []
        curBlock = undefined
        break
      }
      // Crossed a block boundary ⇒ the previous block's events are complete in the index.
      if (curBlock !== undefined && block !== curBlock) yield* drain(this)
      curBlock = block
      if (block > cutoff) {
        // Reached the unsealed region (prior block already drained). Stop.
        curBlock = undefined
        break
      }
      for (const log of item.tx.logs) if (matches(log)) buf.push(log)
    }
    // Exhausted within the sealed cutoff (not truncated): the last block is complete.
    yield* drain(this)
  }

  /**
   * Async generator that yields logs from TON transactions.
   *
   * `startBlock`/`endBlock` are masterchain seqnos (public interface). Internally they
   * are converted to the account's *shard* logical-time range — not the masterchain lt
   * range — before paginating, because account transactions carry shard lt: converting
   * through masterchain lt would skip shard txs whose lt falls below a masterchain
   * block's start_lt.
   *
   * Completeness invariant (non-watch): a masterchain block's account transactions land
   * asynchronously as shards commit, so a block can gain txs after it first appears. The
   * poller advances a per-block watermark and never re-scans below it, so getLogs must
   * only emit a block once it is proven complete — either a later block's tx has been
   * observed with the on-chain tx chain intact across the boundary, or the scan reached
   * a sealed cutoff (`latest - confirmations`). A break in the chain (a `prevTransactionLt`
   * link that does not match) means a committed tx is not yet indexed, so getLogs stops
   * before that block and the poller retries. Watch mode streams live (no buffering).
   *
   * @param opts - Log filter options (startBlock/endBlock are masterchain seqnos)
   * @throws {@link CCIPTopicsInvalidError} if topics format is invalid
   */
  async *getLogs(opts: LeanNumbers<LogFilter>): AsyncIterableIterator<ChainLog> {
    if (opts.watch) {
      opts = {
        ...opts,
        watch:
          opts.watch instanceof AbortSignal
            ? AbortSignal.any([opts.watch, this.abort])
            : this.abort,
      }
    }
    let topics: Set<string> | undefined
    if (opts.topics?.length) {
      if (!opts.topics.every((topic) => typeof topic === 'string'))
        throw new CCIPTopicsInvalidError(opts.topics)
      // append events discriminants (if not 0x-8B already), but keep OG topics
      topics = new Set([
        ...opts.topics,
        ...opts.topics.filter((t) => !isHexString(t, 8)).map((t) => crc32(t)),
      ])
    }
    const matches = (log: ChainLog) => !topics || topics.has(log.topics[0]!)

    if (!opts.address) throw new CCIPLogsAddressRequiredError()
    const acct = Address.parse(opts.address)

    // Resume hint: the composite transactionHash carries the hinted TX's lt
    // ("workchain:address:lt:hash") and the hint's `index` carries its log's own
    // created_lt (unique per account message). The v2 walk's (lt, hash) cursor is
    // transaction-granular, so the composite lt EXCLUDES the whole hinted tx — with
    // the index, the walk instead streams the hinted tx whole and the emit loops
    // drop its logs at/before the hint (same-tx followers flow); the v3 `/messages`
    // fast path floors directly at the message lt (see the gate below). A hint whose
    // address doesn't match the polled account, or that doesn't parse, is ignored
    // and the usual block/time floor applies.
    let sinceLt: bigint | undefined
    let sinceIndexLt: bigint | undefined
    let sinceBlock: number | undefined
    if (opts.since) {
      try {
        // A hint with a mismatching address field is not this stream's: reject it
        // wholesale (like the mismatched composite below) so its block/time floors
        // can't raise this scan's start either.
        if (
          opts.since.address &&
          Address.parse(opts.since.address).toRawString() !== acct.toRawString()
        )
          throw new CCIPError(CCIPErrorCode.UNKNOWN, 'since.address does not match')
        const parts = String(opts.since.transactionHash).split(':')
        const addressMatches =
          !opts.since.address ||
          Address.parse(opts.since.address).toRawString() === acct.toRawString()
        if (parts.length === 4 && /^\d+$/.test(parts[2]!) && addressMatches) {
          // The composite embeds its account: a foreign one is not this stream's
          // cursor — a mismatched lt would silently skip this account's txs, so reject
          // the hint wholesale (its blockNumber must not raise the floors either).
          if (Address.parseRaw(`${parts[0]}:${parts[1]}`).toRawString() !== acct.toRawString())
            throw new CCIPError(CCIPErrorCode.UNKNOWN, 'since hash embeds a foreign account')
          sinceLt = BigInt(parts[2]!)
        }
        if (addressMatches) {
          // A TON log's `index` IS its message's created_lt — unique per log — so it
          // is the per-log resume cursor: the v3 `/messages` fast path floors at it
          // (message-granular: same-tx and same-block logs still flow), and combined
          // with the composite's tx lt it locates the hinted log INSIDE the hinted
          // transaction on the v2 walk (whose `to_lt` cursor is transaction-granular
          // and can't express that).
          if (opts.since.index != null) sinceIndexLt = BigInt(opts.since.index)
          const b = Number(opts.since.blockNumber)
          if (Number.isFinite(b) && b > 0) sinceBlock = b
        }
      } catch (err) {
        // Malformed or provably-foreign hint: no cursor, and no floor contribution
        // either — withSinceStart below must not trust a hint this stream rejected.
        this.logger.warn(
          'TON getLogs: invalid `since` hint:',
          err instanceof Error ? err.message : err,
        )
        sinceLt = undefined
        sinceIndexLt = undefined
        sinceBlock = undefined
        delete opts.since
      }
    }
    // `since.blockNumber`/`blockTimestamp` stand in for (or raise) startBlock/startTime,
    // like every other chain (see withSinceStart): each floor is the LARGER of the
    // explicit bound and the hint's, so a block/time-only hint satisfies the start
    // requirement on its own. Runs after the parsing above, which empties a
    // foreign/malformed hint first so it can contribute nothing. The user's own
    // startBlock is captured BEFORE the merge: a full ChainLog hint always carries a
    // blockNumber, and only an EXPLICIT startBlock is a seqno floor the walk must
    // honor (the v3 fast path can't express one — see the gate below).
    const userStartBlock = opts.startBlock
    opts = withSinceStart(opts)

    // Resume strictly after everything masterchain block (startBlock-1) committed, in
    // account-shard lt space. Every bound resolves into ONE exclusive account-lt cursor
    // (`sinceLtFloor`) — the walk only understands lt space, and its `to_lt` is
    // exclusive server-side (verified against toncenter v2), so floors are passed
    // un-incremented: +1 would skip the boundary tx. startTime-only scans carry no
    // cursor and are bounded by the walk's in-page `now` truncation instead.
    const opts_ = { ...opts }
    delete opts_.since // consumed here
    delete opts_.startBlock // converted to `sinceLtFloor` (public startBlock is a seqno)
    let startSeqno: number | undefined
    // The hint seeds the floor, so the block floor below can only RAISE it (the hint
    // shrinks the scan, never widens it below the requested one): the higher (newer)
    // of the two cursors wins. Both sides are in account-shard lt space, so the
    // comparison is exact.
    // The walk's `to_lt` cursor is transaction-granular, so the floor only ever
    // excludes whole transactions: with the composite tx lt AND the hint's per-log
    // index (the canonical `since = last log` shape — index is the hinted message's
    // created_lt), floor INCLUSIVE of the hinted tx (sinceLt - 1) and let the emit
    // loops below drop its logs at/before the hint's index — same-tx followers
    // (batch execution) still flow. A composite-only hint keeps the tx-exclusive
    // floor; an index-only hint floors exclusively at the message lt (its tx can't
    // be located without the composite) — the hinted log itself is never re-emitted
    // either way. On the v3 `/messages` fast path the index is used directly
    // (message-granular), so no tx-level floor is needed there.
    let sinceLtFloor: bigint | undefined =
      sinceLt != null ? (sinceIndexLt != null ? sinceLt - 1n : sinceLt) : sinceIndexLt
    if (opts.startBlock != null) {
      const b = Number(opts.startBlock)
      startSeqno = b
      if (sinceBlock != null && sinceLt != null && sinceBlock >= b) {
        // The hint's lt already satisfies this floor — the seqno↔lt identity below
        // says C(t) >= b <=> t.lt > E(b-1), and the hinted tx commits at
        // sinceBlock >= b — so the shard-header lookup would only produce a lower
        // floor. Skip it (saves 2 RPCs per scan on the steady-state poll path).
      } else {
        const floor = b > 1 ? await this.accountShardEndLt(b - 1, acct) : 0n
        if (sinceLtFloor == null || floor > sinceLtFloor) sinceLtFloor = floor
      }
      // This boundary is exact, not approximate, because both directions of the
      // seqno↔lt mapping are the SAME function E(M) = accountShardEndLt(M): a tx commits
      // at C(t) = min{ M : E(M) >= t.lt } (what committingSeqno computes and getTransaction
      // stamps as blockNumber), and the resume lt is E(b-1)+1. Hence
      //     t.lt >= resumeLt  <=>  t.lt > E(b-1)  <=>  C(t) >= b
      // so paging from resumeLt yields exactly the txs committing at blocks >= b — never
      // one belonging to b or later, and never one already covered below b.
      //
      // In particular, committingSeqno(resumeLt) landing PAST b is normal and lossless,
      // not a mapping disagreement: E is the shard's end_lt, so it only advances when the
      // masterchain block references a newer shard block for this account's shard. When
      // block b references the same shard block as b-1 (frequent — roughly every other
      // masterchain block on ton-testnet), E(b) == E(b-1) and block b commits no account
      // transaction at all, so there is nothing in b to skip.
    }
    // No cursor and no time bound anywhere: withSinceStart may have raised startBlock
    // from the hint, but when neither `since` nor an explicit bound supplies one, this
    // is a start-less query.
    if (sinceLtFloor == null && opts.startTime == null) throw new CCIPLogsRequiresStartError()

    // Watch mode streams live: emit logs as their txs arrive (the completeness buffering
    // below serves the watermark-driven poller, which does not watch). The v3 fast path
    // is non-watch only, so a startTime-only watch converts its floor here, once.
    if (opts.watch) {
      sinceLtFloor ??= await this.floorLtForTime(opts.startTime!, acct)
      for await (const tx of streamTransactionsForAddress(
        { ...opts_, sinceLt: sinceLtFloor },
        this,
      )) {
        for (const log of tx.logs) {
          if (!matches(log)) continue
          // The inclusive hint floor re-streams the hinted tx: drop its logs
          // at/before the hint's index (the previous run emitted them); its
          // same-tx followers flow on.
          if (sinceIndexLt != null && BigInt(log.index) <= sinceIndexLt) continue
          // startTime is a filter at emission when the scan floor is block-derived
          // (see withSinceStart): never emit logs older than it.
          if (opts.startTime != null && log.blockTimestamp < Number(opts.startTime)) continue
          if (!(await passesTypeAndVersion(this, log.address, opts.typeAndVersions))) continue
          yield log
        }
      }
      return
    }

    // Completeness cutoff: the highest masterchain block we may emit. An explicit
    // positive endBlock bounds it; otherwise it's `latest - confirmations` so the
    // unsealed tip is never emitted. `finality` (a negative depth, as the poller passes)
    // overrides the default confirmation depth.
    const finality = (opts as { finality?: unknown }).finality
    const confirmations = typeof finality === 'number' && finality < 0 ? -finality : 1
    let cutoff = Number.MAX_SAFE_INTEGER
    if (
      (typeof opts.endBlock === 'number' || typeof opts.endBlock === 'bigint') &&
      Number(opts.endBlock) > 0
    ) {
      cutoff = Number(opts.endBlock)
    } else {
      const latest = (await this.provider.getMasterchainInfo()).latestSeqno
      cutoff = Math.max(1, latest - Math.max(1, confirmations))
    }

    // v3 fast path: HINTLESS startTime-only scans (the poller's cold backfill) and
    // scans whose hint carries a per-log `index` enumerate the account's log
    // messages straight from the TonCenter v3 index instead of walking the whole
    // window's tx pages and paying a committingSeqno resolution per tx — see
    // openV3EventStream. For hints the index's message granularity makes the floor
    // EXACT: seeding at the hint's created_lt + 1 (`start_lt` is inclusive) keeps
    // the hinted tx's own later messages and same-block logs, and never re-fetches
    // the hinted log. A composite-only hint (no index) or a startBlock floor stays
    // on the v2 walk, which its lt cursor bounds to an exact, cheap window. Index
    // calls go through a dedicated paced, fail-fast fetch and the lag-guard tip is
    // cached ~30s, so a steady-state scan costs exactly one index call.
    if (
      userStartBlock == null &&
      ((opts.startTime != null && sinceLt == null) || sinceIndexLt != null)
    ) {
      const v3BaseUrl = tonV3BaseUrl(this.provider.parameters.endpoint, this.network.networkType)
      const v3Stream = await openV3EventStream(
        opts_,
        {
          provider: this.provider,
          v3BaseUrl,
          rateLimitedFetch: this.v3FetchFor(v3BaseUrl),
          getIndexedTip: () => this.getV3IndexedTip(v3BaseUrl),
          getTransaction: (tx, seqno) => this.buildChainTransaction(tx, acct, seqno),
          logger: this.logger,
        },
        cutoff,
        sinceIndexLt != null ? sinceIndexLt + 1n : undefined,
      )
      if (v3Stream) {
        yield* this.emitSealedV3Events(v3Stream, opts, cutoff, matches)
        return
      }
    }

    // v2 walk (only path left): a startTime-only scan converts its floor here, once.
    sinceLtFloor ??= await this.floorLtForTime(opts.startTime!, acct)

    // Cap the fetch just past the cutoff so a tx of block (cutoff+1) can confirm the
    // cutoff block complete, without pulling the whole unsealed tip.
    opts_.endBlock = await this.accountShardEndLt(cutoff + 1, acct).catch(() =>
      this.accountShardEndLt(cutoff, acct),
    )

    let curBlock: number | undefined
    let buf: ChainLog[] = []
    let prevLt: string | undefined // lean chain-link scalar carried by ChainTransaction
    // Emit the current block's buffered logs iff it is within the sealed cutoff; reset.
    const drain = (): ChainLog[] => {
      const out = curBlock !== undefined && curBlock <= cutoff ? buf : []
      buf = []
      return out
    }

    // Deep windows engage the index-driven bounded walk: the v3 index's ordered lt
    // list drives v2 hydration pages of ≤100 raw txs (with authoritative mc seqnos), so
    // memory stays O(batch) at any window depth and no per-tx committingSeqno lookups
    // are needed. Shallow windows (< ~WALK_META_MIN_AGE_S old — the steady-state poll)
    // take the plain v2 pagination instead; and if the index is unreachable before the
    // first yield, the walk degrades to the legacy collect-then-drain pagination with
    // per-tx seqno resolution. An index/RPC disagreement mid-stream truncates like a
    // chain gap.
    const v3Base = tonV3BaseUrl(this.provider.parameters.endpoint, this.network.networkType)
    const deep = (await this.windowAgeSeconds(acct, sinceLtFloor)) >= TONChain.WALK_META_MIN_AGE_S
    const walkCtx = {
      provider: this.provider,
      getTransaction: (tx: Transaction, seqno?: number): Promise<ChainTransaction> =>
        seqno != null ? this.buildChainTransaction(tx, acct, seqno) : this.getTransaction(tx),
      ...(deep && {
        v3Meta: (afterLt: bigint) =>
          streamV3TxMeta(
            { rateLimitedFetch: this.v3FetchFor(v3Base), v3BaseUrl: v3Base },
            acct,
            0,
            afterLt,
          ),
      }),
    }
    let streamErr = false
    try {
      for await (const tx of streamTransactionsForAddress(
        { ...opts_, sinceLt: sinceLtFloor },
        walkCtx,
      )) {
        const raw = tx as ChainTransaction & { lt?: string; prevTransactionLt?: string }
        if (
          raw.prevTransactionLt !== undefined &&
          prevLt !== undefined &&
          raw.prevTransactionLt !== prevLt
        ) {
          // Gap: a committed tx between prevLt and this one is not yet indexed — the
          // current block may be incomplete. Drop it and stop; the poller retries.
          buf = []
          curBlock = undefined
          break
        }
        const block = tx.blockNumber
        // Defensive: by the resume-boundary identity above, every tx this fetch returns
        // must sit at or above the floor in lt space and therefore commit at or after
        // startSeqno. A violation can only mean E disagreed with itself between the
        // boundary and the blockNumber stamp (e.g. a stale/other RPC answering mid-scan),
        // and emitting it would rewind the poller's watermark over blocks this scan never
        // covered. Drop the in-progress block and stop, like the gap case; the poller
        // retries. Conservative on purpose: stalling is recoverable, skipping is not.
        if (
          (startSeqno !== undefined && block < startSeqno) ||
          (raw.lt != null && BigInt(raw.lt) <= sinceLtFloor)
        ) {
          this.logger.warn(
            `TON getLogs: tx lt=${raw.lt} commits at block ${block}, below the ` +
              `startBlock=${startSeqno} / lt cursor=${sinceLtFloor} resume boundary; stopping scan`,
          )
          buf = []
          curBlock = undefined
          break
        }
        // Crossed a block boundary with the chain intact ⇒ curBlock is complete.
        if (curBlock !== undefined && block !== curBlock) {
          for (const log of drain()) {
            if (!(await passesTypeAndVersion(this, log.address, opts.typeAndVersions))) continue
            yield log
          }
        }
        curBlock = block
        if (block > cutoff) {
          // Reached the unsealed region (prior block already drained). Stop.
          curBlock = undefined
          break
        }
        for (const log of tx.logs) {
          if (!matches(log)) continue
          // The inclusive hint floor re-streams the hinted tx: drop its logs
          // at/before the hint's index (the previous run emitted them) — its
          // same-tx followers (batch execution) flow on, which the
          // tx-granular `to_lt` cursor would otherwise lose.
          if (sinceIndexLt != null && BigInt(log.index) <= sinceIndexLt) continue
          // startTime is a filter at emission when the scan floor is block-derived
          // (see withSinceStart): never emit logs older than it.
          if (opts.startTime != null && log.blockTimestamp < Number(opts.startTime)) continue
          buf.push(log)
        }
        if (raw.lt != null) prevLt = raw.lt
      }
    } catch (err) {
      if (!(err instanceof CCIPLogsStreamInconsistentError)) throw err
      // Index/RPC disagreement mid-scan: same contract as a chain gap — the block in
      // progress may be incomplete, drop it and stop; the poller resumes from its hint.
      this.logger.warn('TON getLogs: stream inconsistent mid-scan; stopping:', err)
      buf = []
      curBlock = undefined
      streamErr = true
    }
    if (!streamErr) {
      // Exhausted within the sealed cutoff (no gap): the last block is complete.
      for (const log of drain()) {
        if (!(await passesTypeAndVersion(this, log.address, opts.typeAndVersions))) continue
        yield log
      }
    }
  }

  /** {@inheritDoc Chain.typeAndVersion} */
  async typeAndVersion(address: string) {
    const tonAddress = Address.parse(address)

    // Call the typeAndVersion getter method on the contract
    const result = await this.provider.runMethod(tonAddress, 'typeAndVersion')

    // Parse the two string slices returned by the contract
    // TON contracts return strings as cells with snake format encoding
    const typeCell = result.stack.readCell()
    const versionCell = result.stack.readCell()

    // Load strings from cells using snake format
    const contractType = typeCell.beginParse().loadStringTail()
    const version = versionCell.beginParse().loadStringTail()

    // Extract just the last part of the type (e.g., "OffRamp" from "com.chainlink.ton.ccip.OffRamp")
    const typeParts = contractType.split('.')
    const shortType = typeParts[typeParts.length - 1]

    // Format as "Type Version" and use the common parser
    const typeAndVersionStr = `${shortType} ${version}`

    return parseTypeAndVersion(typeAndVersionStr)
  }

  /** {@inheritDoc Chain.getOnRampConfig} */
  async getOnRampConfig(onRamp: string, destChainSelector: bigint) {
    const onRampAddress = Address.parse(onRamp)
    const [
      { stack: staticStack },
      { stack: dynamicStack },
      { stack: destStack },
      [, , typeAndVersion],
    ] = await Promise.all([
      this.provider.runMethod(onRampAddress, 'staticConfig', []),
      this.provider.runMethod(onRampAddress, 'dynamicConfig', []),
      this.provider.runMethod(onRampAddress, 'destChainConfig', [
        { type: 'int', value: destChainSelector },
      ]),
      this.typeAndVersion(onRamp),
    ])

    // staticConfig() -> chainSelector: uint64
    const chainSelector = staticStack.readBigNumber()

    // dynamicConfig() -> feeQuoter, feeAggregator, allowlistAdmin, reserve
    // TON addresses are stored/returned in raw "workchain:hash" form everywhere.
    const feeQuoter = dynamicStack.readAddress().toRawString()
    const feeAggregator = dynamicStack.readAddress().toRawString()
    const allowlistAdmin = dynamicStack.readAddress().toRawString()
    const reserve = dynamicStack.readBigNumber()

    // destChainConfig() -> router, sequenceNumber, allowlistEnabled, allowedSenders (dict cell)
    const router = destStack.readAddress().toRawString()
    const sequenceNumber = BigInt(destStack.readBigNumber().toString())
    const allowlistEnabled = destStack.readBoolean()

    const feeQuoterAddress = Address.parse(feeQuoter)
    const [{ stack: fqStaticStack }, { stack: fqDestStack }] = await Promise.all([
      this.provider.runMethod(feeQuoterAddress, 'staticConfig', []),
      this.provider.runMethod(feeQuoterAddress, 'destChainConfig', [
        { type: 'int', value: destChainSelector },
      ]),
    ])

    // FeeQuoter staticConfig() -> maxFeeJuelsPerMsg: uint96, linkToken: address, tokenPriceStalenessThreshold: uint32
    const maxFeeJuelsPerMsg = fqStaticStack.readBigNumber()
    const linkToken = fqStaticStack.readAddress().toRawString()
    const tokenPriceStalenessThreshold = fqStaticStack.readNumber()

    // FeeQuoter destChainConfig() -> 18 FeeQuoterDestChainConfig scalar fields, then usdPerUnitGas cell
    const destChainConfig = {
      isEnabled: fqDestStack.readBoolean(),
      maxNumberOfTokensPerMsg: fqDestStack.readNumber(),
      maxDataBytes: fqDestStack.readNumber(),
      maxPerMsgGasLimit: fqDestStack.readNumber(),
      destGasOverhead: fqDestStack.readNumber(),
      destGasPerPayloadByteBase: fqDestStack.readNumber(),
      destGasPerPayloadByteHigh: fqDestStack.readNumber(),
      destGasPerPayloadByteThreshold: fqDestStack.readNumber(),
      destDataAvailabilityOverheadGas: fqDestStack.readNumber(),
      destGasPerDataAvailabilityByte: fqDestStack.readNumber(),
      destDataAvailabilityMultiplierBps: fqDestStack.readNumber(),
      chainFamilySelector: fqDestStack.readNumber(),
      defaultTokenFeeUsdCents: fqDestStack.readNumber(),
      defaultTokenDestGasOverhead: fqDestStack.readNumber(),
      defaultTxGasLimit: fqDestStack.readNumber(),
      gasMultiplierWeiPerEth: fqDestStack.readBigNumber(),
      gasPriceStalenessThreshold: fqDestStack.readNumber(),
      networkFeeUsdCents: fqDestStack.readNumber(),
    }

    // usdPerUnitGas is a cell ref following the 18 scalar fields (GasPrice struct)
    const usdPerUnitGasCell = fqDestStack.readCell()
    const gasSlice = usdPerUnitGasCell.beginParse()
    const usdPerUnitGas = {
      executionGasPrice: gasSlice.loadUintBig(112),
      dataAvailabilityGasPrice: gasSlice.loadUintBig(112),
      timestamp: gasSlice.loadUintBig(64),
    }

    return {
      chainSelector,
      destChainSelector,
      feeQuoter,
      feeAggregator,
      allowlistAdmin,
      reserve,
      router,
      sequenceNumber,
      allowlistEnabled,
      typeAndVersion,
      feeQuoterConfig: {
        maxFeeJuelsPerMsg,
        linkToken,
        tokenPriceStalenessThreshold,
        usdPerUnitGas,
        ...destChainConfig,
      },
    }
  }

  /**
   * {@inheritDoc Chain.getNativeTokenForRouter}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  getNativeTokenForRouter(_router: string): Promise<string> {
    // TON native token is represented as address 0:0...01 (workchain 0, hash = 1)
    // This is a convention for representing native GRAM in CCIP
    return Promise.resolve('0:0000000000000000000000000000000000000000000000000000000000000001')
  }

  /** {@inheritDoc Chain.getOffRampsForRouter} */
  async getOffRampsForRouter(router: string, sourceChainSelector: bigint): Promise<string[]> {
    const routerContract = this.provider.provider(Address.parse(router))
    // Get the specific OffRamp for the source chain selector
    const { stack } = await routerContract.get('offRamp', [
      { type: 'int', value: sourceChainSelector },
    ])
    return [stack.readAddress().toRawString()]
  }

  /** {@inheritDoc Chain.getOnRampForRouter} */
  async getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string> {
    const routerContract = this.provider.provider(Address.parse(router))
    // Get the specific OnRamp for the source chain selector
    const { stack } = await routerContract.get('onRamp', [
      { type: 'int', value: destChainSelector },
    ])
    return stack.readAddress().toRawString()
  }

  /** {@inheritDoc Chain.getOffRampConfig} */
  async getOffRampConfig(offRamp: string, sourceChainSelector: bigint) {
    try {
      const { stack } = await this.provider.runMethod(Address.parse(offRamp), 'sourceChainConfig', [
        { type: 'int', value: sourceChainSelector },
      ])
      const router = stack.readAddress().toRawString()
      const isEnabled = stack.readBoolean()
      const minSeqNr = BigInt(stack.readBigNumber().toString())
      const isRMNVerificationDisabled = stack.readBoolean()

      const onRampCell = stack.readCell()
      const onRampSlice = onRampCell.beginParse()
      const cellBits = onRampCell.bits.length
      let onRampBytes: Buffer
      if (cellBits === 160 || cellBits === 256) {
        onRampBytes = onRampSlice.loadBuffer(cellBits / 8)
      } else {
        const onRampLength = onRampSlice.loadUint(8)
        onRampBytes = onRampSlice.loadBuffer(onRampLength)
      }
      const onRamp = decodeOnRampAddress(onRampBytes, networkInfo(sourceChainSelector).family)

      const [{ stack: cfgStack }, [, , typeAndVersion]] = await Promise.all([
        this.provider.runMethod(Address.parse(offRamp), 'config', []),
        this.typeAndVersion(offRamp),
      ])

      // config() -> chainSelector, feeQuoter, permissionlessExecutionThresholdSeconds
      const chainSelector = cfgStack.readBigNumber()
      const feeQuoter = cfgStack.readAddress().toRawString()
      const permissionlessExecutionThresholdSeconds = cfgStack.readNumber()

      return {
        chainSelector,
        sourceChainSelector,
        feeQuoter,
        permissionlessExecutionThresholdSeconds,
        router,
        isEnabled,
        minSeqNr,
        isRMNVerificationDisabled,
        onRamps: [onRamp],
        typeAndVersion,
      }
    } catch (error) {
      if (isTvmError(error) && error.exitCode === 266) {
        throw new CCIPSourceChainUnsupportedError(sourceChainSelector, {
          context: { offRamp },
        })
      }
      throw error
    }
  }

  /** {@inheritDoc Chain.getTokenInfo} */
  async getTokenInfo(token: string): Promise<{ symbol: string; decimals: number }> {
    const tokenAddress = Address.parse(token)
    if (tokenAddress.toRawString().match(/^[0:]+1$/)) {
      return { symbol: 'GRAM', decimals: (this.constructor as typeof TONChain).decimals }
    }

    try {
      const { stack } = await this.provider.runMethod(tokenAddress, 'get_jetton_data')

      // skips
      stack.readBigNumber() // total_supply
      stack.readBigNumber() // mintable
      stack.readAddress() // admin_address

      const contentCell = stack.readCell()
      return parseJettonContent(contentCell, this.rateLimitedFetch, this.logger)
    } catch (error) {
      this.logger.debug(`Failed to get jetton data for ${token}:`, error)
      return { symbol: '', decimals: (this.constructor as typeof TONChain).decimals }
    }
  }

  /** {@inheritDoc Chain.getBalance} */
  async getBalance(opts: GetBalanceOpts): Promise<bigint> {
    const { holder, token } = opts
    const holderAddress = Address.parse(holder)

    if (!token) {
      // Get native GRAM balance
      const state = await this.provider.getContractState(holderAddress)
      return state.balance
    }

    // For jetton balance, we need to:
    // 1. Derive the jetton wallet address for this holder
    // 2. Query the balance from that wallet contract
    const jettonMaster = Address.parse(token)
    const { stack } = await this.provider.runMethod(jettonMaster, 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(holderAddress).endCell() },
    ])
    const jettonWalletAddress = stack.readAddress()

    try {
      const { stack: balanceStack } = await this.provider.runMethod(
        jettonWalletAddress,
        'get_wallet_data',
      )
      return balanceStack.readBigNumber() // First value is balance
    } catch {
      // Wallet doesn't exist yet = 0 balance
      return 0n
    }
  }

  /**
   * {@inheritDoc Chain.getTokenAdminRegistryFor}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  getTokenAdminRegistryFor(_address: string): Promise<string> {
    return Promise.reject(new CCIPNotImplementedError('getTokenAdminRegistryFor'))
  }

  /**
   * Decodes a CCIP message from a TON log event.
   * @param log - Log with data field.
   * @returns Decoded CCIPMessage, or undefined if the data is not a valid CCIP message (parse errors are caught and silently return undefined).
   */
  static decodeMessage({
    data,
    topics,
  }: {
    data: unknown
    topics?: readonly string[]
  }): CCIPMessage<typeof CCIPVersion.V1_6> | undefined {
    if (!data || typeof data !== 'string') return
    if (topics?.length && topics[0] !== crc32('CCIPMessageSent')) return

    try {
      // Parse BOC from base64
      const boc = bytesToBuffer(data)
      const cell = Cell.fromBoc(boc)[0]!
      const slice = cell.beginParse()

      // Load header fields directly (no topic prefix)
      // Structure from TVM2AnyRampMessage:
      // header: RampMessageHeader + sender: address + body: Cell + feeValueJuels: uint96
      const header = {
        messageId: toBeHex(slice.loadUintBig(256), 32),
        sourceChainSelector: slice.loadUintBig(64),
        destChainSelector: slice.loadUintBig(64),
        sequenceNumber: slice.loadUintBig(64),
        nonce: slice.loadUintBig(64),
      }

      // Load sender address
      const sender = slice.loadAddress().toRawString()

      // Load body cell ref
      const bodyCell = slice.loadRef()

      // Load feeValueJuels (96 bits) at message level, after body ref
      const feeValueJuels = slice.loadUintBig(96)

      // Parse body cell: TVM2AnyRampMessageBody
      // Order: receiver (ref) + data (ref) + extraArgs (ref) + tokenAmounts (ref) + feeToken (inline) + feeTokenAmount (256 bits)
      const bodySlice = bodyCell.beginParse()

      // Load receiver from ref 0 (CrossChainAddress: length(8 bits) + bytes)
      const receiverSlice = bodySlice.loadRef().beginParse()
      const receiverLength = receiverSlice.loadUint(8)
      const receiverBytes = receiverSlice.loadBuffer(receiverLength)

      // Decode receiver address using destination chain's format
      let receiver: string
      try {
        const destFamily = networkInfo(header.destChainSelector).family
        receiver = decodeAddress(receiverBytes, destFamily)
      } catch {
        // Fallback to raw hex if chain not registered or decoding fails
        receiver = '0x' + receiverBytes.toString('hex')
      }

      // Load data from ref 1
      const dataSlice = bodySlice.loadRef().beginParse()
      const dataBytes = dataSlice.loadBuffer(dataSlice.remainingBits / 8)

      // Load extraArgs from ref 2
      const extraArgsCell = bodySlice.loadRef()

      // Serialize full cell graph so nested refs are preserved for SVM/Sui extraArgs.
      const extraArgs = hexlify(extraArgsCell.toBoc())
      const parsed = this.decodeExtraArgs(extraArgs)
      if (!parsed) return
      const { _tag, ...extraArgsObj } = parsed

      // Load tokenAmounts from ref 3
      const tokenAmounts: CCIPMessage_V1_6_EVM['tokenAmounts'] = [] // TODO: FIXME: parse when implemented

      // Load feeToken (inline address in body) — canonical raw "workchain:hash" form
      const feeToken = bodySlice.loadMaybeAddress()?.toRawString() ?? ''

      // Load feeTokenAmount (256 bits)
      const feeTokenAmount = bodySlice.loadUintBig(256)

      return {
        ...header,
        sender,
        receiver,
        data: hexlify(dataBytes),
        tokenAmounts,
        feeToken,
        feeTokenAmount,
        feeValueJuels,
        extraArgs,
        ...extraArgsObj,
      }
    } catch {
      return undefined
    }
  }

  /**
   * Encodes TON extra args as a BOC-serialized cell.
   *
   * BOC serialization preserves nested refs, which is required for SVM and Sui
   * extra args that use snaked cells.
   *
   * @param args - Extra arguments containing gas limit and execution flags
   * @returns Hex string of BOC-encoded extra args (0x-prefixed)
   */
  static encodeExtraArgs(args: ExtraArgs): string {
    const cell = encodeExtraArgsCell(args)
    return hexlify(cell.toBoc())
  }

  /**
   * Decodes TON extra arguments.
   * Accepts BOC-serialized cells for all supported variants and legacy raw
   * GenericExtraArgsV2 bits for backward compatibility.
   *
   * @param extraArgs - Extra args as hex string or bytes
   * @returns Decoded TON extra args object or undefined if invalid
   */
  static decodeExtraArgs(
    extraArgs: BytesLike,
  ):
    | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
    | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
    | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
    | undefined {
    try {
      const cell = Cell.fromBoc(bytesToBuffer(extraArgs))[0]!
      return decodeTONExtraArgsCell(cell)
    } catch {
      return decodeLegacyEVMTONExtraArgs(extraArgs)
    }
  }

  /**
   * Decodes commit reports from a TON log event (CommitReportAccepted).
   *
   * @param log - Log with data field (base64-encoded BOC).
   * @param lane - Optional lane info for filtering.
   * @returns Array of CommitReport or undefined if not a valid commit event.
   */
  static decodeCommits(
    { data, topics }: { data: unknown; topics?: readonly string[] },
    lane?: Lane,
  ): CommitReport[] | undefined {
    if (!data || typeof data !== 'string') return
    if (topics?.length && topics[0] !== crc32('CommitReportAccepted')) return
    try {
      const boc = bytesToBuffer(data)
      const cell = Cell.fromBoc(boc)[0]!
      const slice = cell.beginParse()

      // Cell body starts directly with hasMerkleRoot (topic is in message header)
      const hasMerkleRoot = slice.loadBit()

      // No merkle root: could be price-only update, skip for now
      if (!hasMerkleRoot) return

      // Read MerkleRoot fields inline
      const sourceChainSelector = slice.loadUintBig(64)
      const onRampLen = slice.loadUint(8)

      // Invalid onRamp length
      if (onRampLen === 0 || onRampLen > 32) return

      const onRampAddress = decodeAddress(
        slice.loadBuffer(onRampLen),
        networkInfo(sourceChainSelector).family,
      )
      const minSeqNr = slice.loadUintBig(64)
      const maxSeqNr = slice.loadUintBig(64)
      const merkleRoot = hexlify(slice.loadBuffer(32)) as `0x${string}`

      // Read hasPriceUpdates (1 bit): we don't need the data but should consume it
      if (slice.remainingBits >= 1) {
        const hasPriceUpdates = slice.loadBit()
        if (hasPriceUpdates && slice.remainingRefs > 0) {
          slice.loadRef() // Skip price updates ref
        }
      }

      const report: CommitReport = {
        sourceChainSelector,
        onRampAddress,
        minSeqNr,
        maxSeqNr,
        merkleRoot,
      }

      // Filter by lane if provided
      if (lane) {
        if (report.sourceChainSelector !== lane.sourceChainSelector) return
        if (report.onRampAddress !== lane.onRamp) return
      }

      return [report]
    } catch {
      return
    }
  }

  /**
   * Decodes an execution receipt from a TON log event.
   *
   * The ExecutionStateChanged event structure (topic is in message header, not body):
   * - sourceChainSelector: uint64 (8 bytes)
   * - sequenceNumber: uint64 (8 bytes)
   * - messageId: uint256 (32 bytes)
   * - state: uint8 (1 byte) - InProgress=1, Success=2, Failed=3
   *
   * @param log - Log with data field (base64-encoded BOC).
   * @returns ExecutionReceipt or undefined if not valid.
   */
  static decodeReceipt({
    data,
    topics,
  }: {
    data: unknown
    topics?: readonly string[]
  }): ExecutionReceipt | undefined {
    if (!data || typeof data !== 'string') return
    if (topics?.length && topics[0] !== crc32('ExecutionStateChanged')) return

    try {
      const boc = bytesToBuffer(data)
      const cell = Cell.fromBoc(boc)[0]!
      const slice = cell.beginParse()

      // ExecutionStateChanged has no refs
      if (cell.refs.length > 0) return

      // Cell body contains only the struct fields
      // ExecutionStateChanged: sourceChainSelector(64) + sequenceNumber(64) + messageId(256) + state(8)
      const sourceChainSelector = slice.loadUintBig(64)
      const sequenceNumber = slice.loadUintBig(64)
      const messageId = toBeHex(slice.loadUintBig(256), 32)
      const state = slice.loadUint(8)

      // Validate state is a known ExecutionState (1-3)
      if (state < ExecutionState.InProgress || state > ExecutionState.Failed) return

      return {
        messageId,
        sequenceNumber,
        sourceChainSelector,
        state: state as ExecutionState,
      }
    } catch {
      // ignore
    }
  }

  /**
   * Converts bytes to a TON address.
   * Handles:
   * - 36-byte CCIP format: workchain(4 bytes, big-endian) + hash(32 bytes)
   * - 33-byte format: workchain(1 byte) + hash(32 bytes)
   * - 32-byte format: hash only (assumes workchain 0)
   * Also handles user-friendly format strings (e.g., "EQ...", "UQ...", "kQ...", "0Q...",
   * including test-only/bounceable variants) and raw format strings ("workchain:hash").
   * Any friendly string form the SDK sees is canonicalized to raw on the way in.
   * @param bytes - Bytes or string to convert.
   * @returns TON raw address string in format "workchain:hash".
   * @throws {@link CCIPArgumentInvalidError} if bytes length is invalid
   */
  static getAddress(bytes: BytesLike): string {
    // String addresses are canonicalized to the raw "workchain:hash" form — the
    // only representation TON values are stored and compared in across the SDK.
    if (typeof bytes === 'string') {
      // Handle raw format "workchain:hash"
      if (/^-?\d+:[0-9a-fA-F]{64}$/.test(bytes)) {
        return bytes
      }
      // Handle user-friendly formats (EQ..., UQ..., kQ..., 0Q..., including the
      // test-only/bounceable variants) — Address.isFriendly covers all flag combos.
      if (Address.isFriendly(bytes)) {
        return Address.parse(bytes).toRawString()
      }
    }

    const data = bytesToBuffer(bytes)

    if (data.length === 36) {
      // CCIP cross-chain format: workchain(4 bytes, big-endian) + hash(32 bytes)
      const workchain = data.readInt32BE(0)
      const hash = data.subarray(4).toString('hex')
      return `${workchain}:${hash}`
    } else if (data.length === 33) {
      // workchain (1 byte) + hash (32 bytes)
      const workchain = data[0] === 0xff ? -1 : data[0]
      const hash = data.subarray(1).toString('hex')
      return `${workchain}:${hash}`
    } else if (data.length === 32) {
      // hash only, assume workchain 0
      return `0:${data.toString('hex')}`
    } else {
      throw new CCIPArgumentInvalidError(
        'bytes',
        `Invalid TON address bytes length: ${data.length}. Expected 32, 33, or 36 bytes.`,
      )
    }
  }

  /**
   * Formats a TON address for human-friendly display.
   * Converts raw format (workchain:hash) to user-friendly format (EQ..., UQ..., etc.)
   * @param address - Address in any recognized format
   * @returns User-friendly TON address string
   */
  static formatAddress(address: string): string {
    try {
      // Parse the address (handles both raw and friendly formats)
      const parsed = Address.parse(address)
      // Return user-friendly format (bounceable by default)
      return parsed.toString()
    } catch {
      // If parsing fails, return original
      return address
    }
  }

  /**
   * Formats a TON transaction hash for human-friendly display.
   * Extracts the raw 64-char hash from composite format for cleaner display.
   * @param hash - Transaction hash in composite or raw format
   * @returns The raw 64-char hex hash for display
   */
  static formatTxHash(hash: string): string {
    const parts = hash.split(':')
    if (parts.length === 4) {
      // Composite format: workchain:address:lt:hash - return just the hash part
      return parts[3]!
    }
    // Already raw format or unknown - return as-is
    return hash
  }

  /**
   * Validates a transaction hash format for TON.
   * Supports:
   * - Raw 64-char hex hash (with or without 0x prefix)
   * - Composite format: "workchain:address:lt:hash"
   */
  static isTxHash(v: unknown): v is string {
    if (typeof v !== 'string') return false

    // Check for raw 64-char hex hash (with or without 0x prefix)
    const cleanHash = v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v
    if (/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
      return true
    }

    // Check for composite format: workchain:address:lt:hash
    const parts = v.split(':')
    if (parts.length === 4) {
      const [workchain, address, lt, hash] = parts as [string, string, string, string]
      // workchain should be a number (typically 0 or -1)
      if (!/^-?\d+$/.test(workchain)) return false
      // address should be 64-char hex
      if (!/^[a-fA-F0-9]{64}$/.test(address)) return false
      // lt should be a number
      if (!/^\d+$/.test(lt)) return false
      // hash should be 64-char hex
      if (!/^[a-fA-F0-9]{64}$/.test(hash)) return false
      return true
    }

    return false
  }

  /**
   * Returns a copy of a message, populating missing fields like `extraArgs` with defaults.
   * Ensures TON-bound messages satisfy the minimum destination gas requirement.
   *
   * @param message - AnyMessage (from source), containing at least `receiver`
   * @returns A message suitable for `sendMessage` to a TON destination chain
   * @throws {@link CCIPArgumentInvalidError} if extraArgs.gasLimit is below the TON minimum
   */
  static override buildMessageForDest(
    message: Parameters<ChainStatic['buildMessageForDest']>[0],
  ): AnyMessage {
    const built = super.buildMessageForDest(message)
    const gasLimit = 'gasLimit' in built.extraArgs ? built.extraArgs.gasLimit : undefined

    if (!gasLimit || gasLimit < this.extraArgGasLimitMin) {
      throw new CCIPArgumentInvalidError(
        'extraArgs.gasLimit',
        `(val=${gasLimit}) must be at least ${this.extraArgGasLimitMin} (${fromNano(this.extraArgGasLimitMin)} GRAM) for TON destinations`,
      )
    }

    return built
  }

  /**
   * Gets the leaf hasher for TON destination chains.
   * @param lane - Lane configuration.
   * @param _ctx - Context containing logger.
   * @returns Leaf hasher function.
   */
  static getDestLeafHasher(lane: Lane, _ctx?: WithLogger): LeafHasher {
    return getTONLeafHasher(lane)
  }

  /** {@inheritDoc Chain.getFee} */
  async getFee(opts: Parameters<Chain['getFee']>[0]): Promise<bigint> {
    await this.checkSendMessage(opts)
    const { router, destChainSelector, message } = opts
    const populatedMessage = buildMessageForDest(message, networkInfo(destChainSelector).family)
    return getFeeImpl(this, router, destChainSelector, populatedMessage)
  }

  /** {@inheritDoc Chain.generateUnsignedSendMessage} */
  async generateUnsignedSendMessage(
    opts: Parameters<Chain['generateUnsignedSendMessage']>[0] & { txGasLimit?: number },
  ): Promise<UnsignedTONTx> {
    const { router, destChainSelector, message, sender } = opts
    // Convert MessageInput to AnyMessage with defaults
    const populatedMessage = buildMessageForDest(message, networkInfo(destChainSelector).family)

    // Calculate fee if not provided
    const fee =
      message.fee ??
      (await this.getFee({
        router,
        destChainSelector,
        message: populatedMessage,
      }))

    const unsigned = generateUnsignedCcipSend(
      this,
      sender,
      router,
      destChainSelector,
      { ...populatedMessage, fee },
      opts,
    )

    return {
      family: ChainFamily.TON,
      ...unsigned,
    }
  }

  /** {@inheritDoc Chain.sendMessage} */
  async sendMessage(opts: Parameters<Chain['sendMessage']>[0]): Promise<CCIPRequest> {
    if (!isTONWallet(opts.wallet)) {
      throw new CCIPWalletInvalidError(opts.wallet)
    }

    const sender = await opts.wallet.getAddress()

    // Generate unsigned transaction with fee calculation if needed
    const { family: _, ...unsigned } = await this.generateUnsignedSendMessage({
      ...opts,
      sender,
    })

    // Send transaction
    const startTime = Math.floor(Date.now() / 1000)
    const seqno = await opts.wallet.sendTransaction(unsigned)

    this.logger.info('CCIP send transaction submitted, seqno:', seqno)

    // Wait for CCIPMessageSent event and extract the request
    // Query the OnRamp for the CCIPMessageSent event
    const onRamp = await this.getOnRampForRouter(opts.router, opts.destChainSelector)

    // Poll for the message in recent logs
    for await (const log of this.getLogs({
      address: onRamp,
      topics: [crc32('CCIPMessageSent')],
      startTime,
      watch: AbortSignal.timeout(5 * 60e3 /* 5m timeout */),
    })) {
      const msg = TONChain.decodeMessage(log)
      if (!msg) continue

      // Found our message: construct and return the CCIPRequest
      const tx = log.tx ?? (await this.getTransaction(log.transactionHash))

      return {
        lane: {
          sourceChainSelector: this.network.chainSelector,
          destChainSelector: opts.destChainSelector,
          onRamp,
          version: CCIPVersion.V1_6,
        },
        message: msg,
        log,
        tx,
      }
    }

    throw new CCIPTransactionNotFoundError(seqno.toString())
  }

  /**
   * {@inheritDoc Chain.generateUnsignedExecute}
   * @throws {@link CCIPExtraArgsInvalidError} if extra args are not EVMExtraArgsV2 format
   */
  async generateUnsignedExecute(
    opts: Parameters<Chain['generateUnsignedExecute']>[0],
  ): Promise<UnsignedTONTx> {
    const resolved = await this.resolveExecuteOpts(opts)
    const { offRamp, input } = resolved

    const unsigned = generateUnsignedExecuteReport(
      offRamp,
      input as ExecutionInput<CCIPMessage_V1_6_EVM>,
      resolved,
    )

    return Promise.resolve({
      family: ChainFamily.TON,
      ...unsigned,
    })
  }

  /**
   * {@inheritDoc Chain.execute}
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid TON wallet
   * @throws {@link CCIPReceiptNotFoundError} if execution receipt not found within timeout
   */
  async execute(opts: Parameters<Chain['execute']>[0]): Promise<CCIPExecution> {
    const { wallet } = opts
    if (!isTONWallet(wallet)) throw new CCIPWalletInvalidError(wallet)
    const payer = await wallet.getAddress()

    const resolved = await this.resolveExecuteOpts(opts)
    const { offRamp } = resolved
    if (!('message' in resolved.input)) throw new CCIPExecutionReportChainMismatchError('TON')
    const message = resolved.input.message as CCIPMessage_V1_6_EVM

    const { family: _, ...unsigned } = await this.generateUnsignedExecute({
      ...resolved,
      payer,
    })

    const startTime = Math.floor(Date.now() / 1000)
    // Open wallet and send transaction using the unsigned data
    const seqno = await wallet.sendTransaction({
      value: opts.txGasLimit ? BigInt(opts.txGasLimit) : toNano('0.3'),
      ...unsigned,
    })

    for await (const exec of this.getExecutionReceipts({
      offRamp,
      messageId: message.messageId,
      sourceChainSelector: message.sourceChainSelector,
      startTime,
      watch: AbortSignal.timeout(10 * 60e3 /* 10m */),
    })) {
      return exec // break and return on first yield
    }
    throw new CCIPReceiptNotFoundError(seqno.toString())
  }

  /**
   * Parses raw TON data into typed structures.
   * @param data - Raw data to parse.
   * @returns Parsed data or undefined.
   */
  static parse(data: unknown) {
    if (isBytesLike(data)) {
      const parsedExtraArgs = this.decodeExtraArgs(data)
      if (parsedExtraArgs) return parsedExtraArgs
    }
  }

  /**
   * {@inheritDoc Chain.getSupportedTokens}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  async getSupportedTokens(_address: string): Promise<string[]> {
    return Promise.reject(new CCIPNotImplementedError('getSupportedTokens'))
  }

  /**
   * {@inheritDoc Chain.getRegistryTokenConfig}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  async getRegistryTokenConfig(_address: string, _tokenName: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getRegistryTokenConfig'))
  }

  /**
   * {@inheritDoc Chain.getTokenPoolConfig}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  async getTokenPoolConfig(_tokenPool: string, _feeOpts?: TokenTransferFeeOpts): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getTokenPoolConfig'))
  }

  /**
   * {@inheritDoc Chain.getTokenPoolRemotes}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  async getTokenPoolRemotes(_tokenPool: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getTokenPoolRemotes'))
  }

  /**
   * {@inheritDoc Chain.getFeeTokens}
   * @throws {@link CCIPNotImplementedError} always (not implemented for TON)
   */
  async getFeeTokens(_router: string): Promise<never> {
    return Promise.reject(new CCIPNotImplementedError('getFeeTokens'))
  }
}
