/**
 * setChainRateLimiterConfigs — sets the inbound/outbound rate limits of one or more configured
 * lanes on a token pool, in a single transaction.
 *
 * @remarks Every supported version is served by its own entry point, keeping the
 * one-op-one-transaction invariant every CCT write holds: v1.5.1/v1.6.1 encode the batch
 * `setChainRateLimiterConfigs(uint64[], Config[], Config[])`, v2.0.0 the reshaped
 * `setRateLimitConfig(RateLimitConfigArgs[])`, and v1.5.0 — which ships only the singular
 * `setChainRateLimiterConfig(uint64, Config, Config)` — that call. Because v1.5.0 sets one lane
 * per transaction, a v1.5.0 pool accepts only a single-element `updates`; a multi-lane batch is
 * rejected with {@link CCTParamsInvalidError} rather than fanned out into N transactions.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateArray, validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  getTokenPoolInterface,
  readTokenPoolOwner,
  readTokenPoolRateLimitAdmin,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'
import {
  type ParsedRateLimitConfig,
  type RateLimitConfig,
  parseRateLimitConfig,
} from '../rate-limit.ts'

/**
 * New rate limits for one already-configured lane.
 *
 * @remarks The two config fields are deliberately spelled `inboundRateLimiterConfig` /
 * `outboundRateLimiterConfig`, matching the Solana `ChainUpdate` in
 * `cct/solana/token-pool/operations/apply-chain-updates.ts`, so the very same config objects can be
 * passed to `applyChainUpdates` and to this op.
 *
 * This op only *updates* limits — it does not add a lane. A selector the pool has no chain config
 * for reverts on-chain (`NonExistentChain`); add it first with the pool's chain-update op.
 */
export type ChainRateLimitUpdate = {
  /** CCIP selector of the already-configured remote chain (`uint64`). */
  remoteChainSelector: bigint
  /** Limit on tokens received from the remote chain. */
  inboundRateLimiterConfig: RateLimitConfig
  /** Limit on tokens sent to the remote chain. */
  outboundRateLimiterConfig: RateLimitConfig
  /**
   * Whether this entry configures the lane's *fast-finality* (FTF) buckets rather than its
   * finalized ones. **v2.0.0 only** — the field does not exist in the pre-2.0.0 ABIs, so setting it
   * (to either value) on a v1.5.1/v1.6.1 pool is rejected instead of silently dropped. Defaults to
   * `false` on v2.0.0.
   */
  fastFinality?: boolean
}

/** Parameters for {@link SetChainRateLimiterConfigs}. */
export type SetChainRateLimiterConfigsParams = {
  /** Token pool contract whose lane limits are being set. */
  poolAddress: string
  /** Lanes to re-limit; at least one, with no repeated `remoteChainSelector`. */
  updates: ChainRateLimitUpdate[]
  /**
   * Pool `owner` or `rateLimitAdmin` — the two roles the pools accept for rate-limit writes. Sets
   * `tx.from` for offline / multisig signing; {@link SetChainRateLimiterConfigs.execute}
   * additionally checks it on-chain.
   */
  sender?: string
}

/** A {@link ChainRateLimitUpdate} with both directions parsed and its `fastFinality` resolved. */
type ParsedChainRateLimitUpdate = {
  remoteChainSelector: bigint
  inbound: ParsedRateLimitConfig
  outbound: ParsedRateLimitConfig
  fastFinality: boolean
}

/**
 * Validates `updates` and resolves every entry: non-empty, selectors distinct `uint64`s, both
 * directions through {@link parseRateLimitConfig}.
 * @param operation - Operation name, for the error context.
 * @param updates - The caller-supplied value, unvalidated.
 * @param allowFastFinality - Whether the resolved pool version has the per-entry `fastFinality`
 * flag (v2.0.0 and up). When `false`, an entry that sets it at all is rejected.
 * @param version - Resolved pool version, or `null` pre-RPC, which skips the stricter
 * v1.5.0/v1.5.1 rate bound.
 * @throws {@link CCTParamsInvalidError} if `updates` is not a non-empty array, an entry is not an
 * object, a selector repeats or is not a `uint64`, `fastFinality` is not a boolean (or is set on a
 * version without it), or either direction's config is invalid for `version`
 */
function parseUpdates(
  operation: string,
  updates: unknown,
  allowFastFinality: boolean,
  version: TokenPoolVersion | null,
): ParsedChainRateLimitUpdate[] {
  validateArray(operation, 'updates', updates, 1)

  const seen = new Set<bigint>()
  return updates.map((update, i) => {
    const path = `updates[${i}]`
    if (typeof update !== 'object' || update === null)
      throw new CCTParamsInvalidError(operation, path, 'must be a chain rate-limit update')

    const {
      remoteChainSelector,
      inboundRateLimiterConfig,
      outboundRateLimiterConfig,
      fastFinality,
    } = update as Partial<ChainRateLimitUpdate>

    validateUint64(operation, `${path}.remoteChainSelector`, remoteChainSelector)
    if (seen.has(remoteChainSelector))
      throw new CCTParamsInvalidError(
        operation,
        `${path}.remoteChainSelector`,
        `is a duplicate of an earlier update (${remoteChainSelector}); each lane may appear only once`,
      )
    seen.add(remoteChainSelector)

    if (fastFinality !== undefined) {
      if (!allowFastFinality)
        throw new CCTParamsInvalidError(
          operation,
          `${path}.fastFinality`,
          'is only supported from pool version 2.0.0; omit it for older pools',
        )
      if (typeof fastFinality !== 'boolean')
        throw new CCTParamsInvalidError(operation, `${path}.fastFinality`, 'must be a boolean')
    }

    return {
      remoteChainSelector,
      inbound: parseRateLimitConfig(
        operation,
        `${path}.inboundRateLimiterConfig`,
        inboundRateLimiterConfig,
        version,
      ),
      outbound: parseRateLimitConfig(
        operation,
        `${path}.outboundRateLimiterConfig`,
        outboundRateLimiterConfig,
        version,
      ),
      fastFinality: fastFinality ?? false,
    }
  })
}

/**
 * Encodes the batch rate-limit call against the resolved pool {@link Interface}.
 * @remarks `version` is the pool's *actual* resolved version, not the encoder's floor: the v1.5.1
 * encoder serves both v1.5.1 and v1.6.1, whose enabled-bucket rate bounds differ, so it has to be
 * told which one it is encoding for.
 */
type Encoder = (
  iface: Interface,
  params: SetChainRateLimiterConfigsParams,
  version: TokenPoolVersion,
) => UnsignedEVMTx

/** The on-chain `RateLimiter.Config` tuple: `enabled` maps to the ABI's `isEnabled`. */
type RateLimiterConfigTuple = [isEnabled: boolean, capacity: bigint, rate: bigint]

const toTuple = ({ enabled, capacity, rate }: ParsedRateLimitConfig): RateLimiterConfigTuple => [
  enabled,
  capacity,
  rate,
]

/**
 * v1.5.0: `setChainRateLimiterConfig(uint64, Config outbound, Config inbound)` — the singular
 * entry point, one lane per call, so a v1.5.0 pool accepts only a single-element `updates`. A
 * multi-lane batch is rejected here rather than fanned out into N transactions, which would break
 * the one-op-one-transaction invariant. No `fastFinality` at this version.
 */
const encodeSingleConfigV1_5_0: Encoder = (iface, { poolAddress, updates }, version) => {
  const parsed = parseUpdates('setChainRateLimiterConfigs', updates, false, version)
  if (parsed.length !== 1)
    throw new CCTParamsInvalidError(
      'setChainRateLimiterConfigs',
      'updates',
      `must contain exactly one lane on a v1.5.0 pool, which sets rate limits one lane per transaction (got ${parsed.length}); split the batch into one call per lane`,
    )
  const [update] = parsed
  return callTx(
    poolAddress,
    iface.encodeFunctionData('setChainRateLimiterConfig', [
      update!.remoteChainSelector,
      toTuple(update!.outbound),
      toTuple(update!.inbound),
    ]),
  )
}

/**
 * v1.5.1/v1.6.1: `setChainRateLimiterConfigs(uint64[], Config[] outbound, Config[] inbound)` —
 * three parallel arrays, outbound before inbound. No `fastFinality` at these versions.
 */
const encodeBatchConfigs: Encoder = (iface, { poolAddress, updates }, version) => {
  const parsed = parseUpdates('setChainRateLimiterConfigs', updates, false, version)
  return callTx(
    poolAddress,
    iface.encodeFunctionData('setChainRateLimiterConfigs', [
      parsed.map((u) => u.remoteChainSelector),
      parsed.map((u) => toTuple(u.outbound)),
      parsed.map((u) => toTuple(u.inbound)),
    ]),
  )
}

/**
 * v2.0.0: `setRateLimitConfig(RateLimitConfigArgs[])` — one struct per lane, folding the selector
 * and the new `fastFinality` flag in with the two configs (outbound before inbound).
 */
const encodeRateLimitConfigV2_0_0: Encoder = (iface, { poolAddress, updates }, version) => {
  const parsed = parseUpdates('setChainRateLimiterConfigs', updates, true, version)
  return callTx(
    poolAddress,
    iface.encodeFunctionData('setRateLimitConfig', [
      parsed.map((u) => [
        u.remoteChainSelector,
        u.fastFinality,
        toTuple(u.outbound),
        toTuple(u.inbound),
      ]),
    ]),
  )
}

/**
 * Sets the inbound/outbound rate limits of one or more configured lanes on a token pool, in a
 * single transaction. Gated on the pool's `owner` **or** its `rateLimitAdmin`.
 */
export class SetChainRateLimiterConfigs extends EVMOperation<SetChainRateLimiterConfigsParams> {
  readonly name = 'setChainRateLimiterConfigs'

  /**
   * One entry per calldata shape: v1.5.0 has only the singular call, v1.6.1 inherits the v1.5.1
   * batch encoding, and v2.0.0 renamed and reshaped the call, hence its own entry.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeSingleConfigV1_5_0,
    [TokenPoolVersion.V1_5_1]: encodeBatchConfigs,
    [TokenPoolVersion.V2_0_0]: encodeRateLimitConfigV2_0_0,
  }

  /**
   * Validates the pool address and every update before any RPC. `fastFinality` is *permitted*
   * here, and the version-specific rate bounds are not applied (`null` version) — whether this
   * pool has that field, and which bound its `RateLimiter` enforces, are only known once its
   * version is resolved, so the version-specific encoder is what rejects those (see
   * {@link parseUpdates}).
   */
  protected override validate({ poolAddress, updates }: SetChainRateLimiterConfigsParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    parseUpdates(this.name, updates, true, null)
  }

  /**
   * Reads the pool's type-and-version, floor-matches the encoder and its contract interface, then
   * — when `sender` is known — pre-flights it against the pool's `owner` **or** its
   * `rateLimitAdmin`.
   *
   * @remarks The role check lives here, not only in {@link execute}, so the offline / multisig
   * path gets it too: `generateUnsignedSetChainRateLimiterConfigs` with an unauthorized `sender`
   * would otherwise hand back a fully-formed transaction that reverts `Unauthorized` only after
   * being reviewed and signed. Every sibling pool write gates in `buildUnsigned` for the same
   * reason; this one is gated on a *disjunction* rather than the owner alone, so it reads both
   * roles instead of using `assertPoolOwner`.
   * @remarks Ordered *after* the encoder so a bad parameter fails on the one `typeAndVersion`
   * probe rather than after two more role reads.
   * @throws {@link CCTParamsInvalidError} if `sender` is neither the pool `owner` nor its (set)
   * `rateLimitAdmin`, or a multi-lane `updates` is sent to a v1.5.0 pool
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetChainRateLimiterConfigsParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params, version)
    if (params.sender !== undefined)
      await this.#assertRateLimitRole(chain, params.poolAddress, params.sender, version)
    return unsigned
  }

  /**
   * Rejects a `sender` that is neither the pool's `owner` nor its `rateLimitAdmin`.
   *
   * @remarks `rateLimitAdmin` is unset on most pools, where it reads as the zero address, so it is
   * only compared once known to be *set*: an equality-first check would let a zero-address `sender`
   * match an unset admin and authorize a transaction nobody can send.
   * @remarks `version` selects which getter reports `rateLimitAdmin` (standalone pre-2.0.0, folded
   * into `getDynamicConfig` at 2.0.0). Both roles are read directly, not via the
   * `getTokenPoolState` query op — see {@link readTokenPoolOwner} for why.
   * @throws {@link CCTParamsInvalidError} if `sender` holds neither role
   */
  async #assertRateLimitRole(
    chain: EVMChain,
    poolAddress: string,
    sender: string,
    version: TokenPoolVersion,
  ): Promise<void> {
    const [owner, rateLimitAdmin] = await Promise.all([
      readTokenPoolOwner(chain, poolAddress),
      readTokenPoolRateLimitAdmin(chain, poolAddress, version),
    ])

    const signer = getAddress(sender)
    // an unset rateLimitAdmin is the zero address; exclude it before comparing or a zero-address
    // `sender` would match it
    const isRateLimitAdmin = rateLimitAdmin !== ZeroAddress && rateLimitAdmin === signer
    if (owner !== signer && !isRateLimitAdmin) {
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must be the pool owner (${owner})${
          rateLimitAdmin === ZeroAddress
            ? ' — this pool has no rateLimitAdmin set'
            : ` or its rateLimitAdmin (${rateLimitAdmin})`
        }`,
      )
    }
  }

  /**
   * Signs and submits, binding `sender` to the signing wallet's address — see
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather than
   * signed. The owner-or-`rateLimitAdmin` gate is {@link buildUnsigned}'s.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if any param is invalid, or `sender` is neither the
   * wallet's address, the pool `owner`, nor the pool's (set) `rateLimitAdmin`, or a multi-lane
   * `updates` is sent to a v1.5.0 pool
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetChainRateLimiterConfigsParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
