/**
 * applyChainUpdates — configures, enables and disables a token pool's remote lanes: the remote
 * token, the remote pool(s) allowed to bridge into it, and both directional rate limits.
 *
 * The one CCT pool write whose *calldata* changed shape mid-life: v1.5.0 takes a single `chains`
 * array with a per-lane `allowed` bit, v1.5.1+ a `remoteChainSelectorsToRemove` /
 * `chainsToAdd` pair. Callers only ever see the v1.5.1+ shape, {@link ApplyChainUpdatesParams};
 * {@link ApplyChainUpdates.buildUnsigned} resolves the pool's version from its own `typeAndVersion`
 * and, for a v1.5.0 pool, adapts the params to the legacy signature. The file is sectioned by
 * version so each signature's encoder sits with what it needs.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { encodeAddressToAny } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseRemoteAddress, parseUniqueRemoteAddresses } from '../../../remote-address.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import {
  parseRecord,
  validateArray,
  validateNonZeroAddress,
  validateUint64,
} from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'
import {
  type ParsedRateLimitConfig,
  type RateLimitConfig,
  parseRateLimitConfig,
} from '../rate-limit.ts'

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/**
 * One lane to add or reconfigure.
 * @remarks Field-for-field the Solana `ChainUpdate` in
 * `cct/solana/token-pool/operations/apply-chain-updates.ts`, minus its Solana-only
 * `remoteTokenDecimals`.
 */
export type ChainUpdate = {
  /** CCIP selector of the remote chain (`uint64`). */
  remoteChainSelector: bigint
  /**
   * Remote token address in the remote chain's own format (`0x…` for EVM, base58 for Solana, …),
   * the family taken from `remoteChainSelector`. Encoded to the 32-byte padded `bytes` the pool
   * stores; an unpadded EVM remote would configure fine, then revert every inbound transfer.
   */
  remoteTokenAddress: string
  /**
   * Remote pool addresses in the remote chain's own format, like `remoteTokenAddress` — plural,
   * because a lane may accept several remote pools, e.g. while migrating one. Non-empty, and unique
   * within the lane (compared by canonical spelling, so two spellings of one address collide). A
   * **v1.5.0** pool holds a single remote pool per lane, so there it must have exactly one entry.
   */
  remotePoolAddresses: string[]
  /** Rate limit for tokens received from the remote chain. */
  inboundRateLimiterConfig: RateLimitConfig
  /** Rate limit for tokens sent to the remote chain. */
  outboundRateLimiterConfig: RateLimitConfig
}

/**
 * Parameters for {@link ApplyChainUpdates}: additions and removals as two arrays, the shape of every
 * pool from v1.5.1 up. A **v1.5.0** pool is written with the same params — its legacy `chains`
 * signature is derived from them once the pool's version is resolved, at no extra RPC.
 */
export type ApplyChainUpdatesParams = {
  /** Token pool whose lanes are being configured. */
  poolAddress: string
  /**
   * Pool owner; sets `tx.from` for offline / multisig signing. When supplied it is also
   * pre-flighted against the pool's on-chain `owner()`, so an unauthorized caller fails here
   * rather than as an opaque revert.
   */
  sender?: string
  /**
   * Lanes to add or reconfigure. To replace a lane's remote pools wholesale, list its selector
   * here *and* in `remoteChainSelectorsToRemove` — the contract applies removals first, so that
   * cross-array pairing stays legal. Within this array a selector may appear only once, and may
   * not be `0n`; holes are rejected too.
   */
  chainsToAdd: ChainUpdate[]
  /**
   * Lanes to remove, applied before `chainsToAdd`. No duplicates and no holes; `0n` *is* accepted
   * here, so a pool already holding a junk lane can be cleaned up.
   */
  remoteChainSelectorsToRemove: bigint[]
}

/** {@link ChainUpdate} with its rate limits resolved — derived, so the two cannot drift. */
type ParsedChainUpdate = Omit<
  ChainUpdate,
  'inboundRateLimiterConfig' | 'outboundRateLimiterConfig'
> & {
  inboundRateLimiterConfig: ParsedRateLimitConfig
  outboundRateLimiterConfig: ParsedRateLimitConfig
}

/**
 * {@link ApplyChainUpdatesParams} as {@link ApplyChainUpdates.prepare} leaves it. The v1.5.1+
 * encoder adds no validation of its own — a parsed lane is already a `ChainUpdate` struct.
 */
type ParsedApplyChainUpdatesParams = Omit<
  ApplyChainUpdatesParams,
  'chainsToAdd' | 'remoteChainSelectorsToRemove'
> & {
  chainsToAdd: ParsedChainUpdate[]
  remoteChainSelectorsToRemove: bigint[]
}

/**
 * Parses a lane's `remoteChainSelector`: a `uint64`, unique within its own array, and — for a lane
 * being *added* — non-zero. `seen` is mutated as each selector is accepted, and is per-array: the
 * same selector in both arrays is the replace idiom.
 *
 * @remarks `requireNonZero` holds only for an addition, which `TokenPool.applyChainUpdates` does
 * not guard: `s_remoteChainSelectors.add(0)` succeeds, so the tx **mines as a success** and leaves
 * `getSupportedChains()` holding a lane nothing can route. A removal is how such a pool is
 * repaired, so `0n` stays legal there. Not a *known*-selector check here; an addition gets one
 * anyway, since its remote addresses are parsed in the remote chain's format, which the selector
 * names. A removal skips that parse, so an unrecognised selector can still be removed.
 */
function parseLaneSelector(
  operation: string,
  param: string,
  selector: unknown,
  seen: Set<bigint>,
  requireNonZero: boolean,
): bigint {
  validateUint64(operation, param, selector)
  if (requireNonZero && selector === 0n) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      'must not be zero: 0 is not a CCIP chain selector, and the pool would accept it as a permanently unroutable lane rather than reverting',
    )
  }
  if (seen.has(selector)) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `is a duplicate of an earlier entry in the same array (${selector}); each lane may appear only once`,
    )
  }
  seen.add(selector)
  return selector
}

/** Parses the pair of lane arrays: removals (applied first on-chain), then additions. */
function parseLanes(
  operation: string,
  chainsToAdd: unknown,
  remoteChainSelectorsToRemove: unknown,
) {
  validateArray(operation, 'chainsToAdd', chainsToAdd)
  validateArray(operation, 'remoteChainSelectorsToRemove', remoteChainSelectorsToRemove)
  if (!chainsToAdd.length && !remoteChainSelectorsToRemove.length) {
    throw new CCTParamsInvalidError(
      operation,
      'chainsToAdd',
      'at least one of chainsToAdd or remoteChainSelectorsToRemove must be non-empty',
    )
  }

  const seenRemovals = new Set<bigint>()
  const removals = remoteChainSelectorsToRemove.map((selector, i) =>
    parseLaneSelector(
      operation,
      `remoteChainSelectorsToRemove[${i}]`,
      selector,
      seenRemovals,
      false,
    ),
  )

  const seenAdds = new Set<bigint>()
  const adds = chainsToAdd.map((entry, i): ParsedChainUpdate => {
    const path = `chainsToAdd[${i}]`
    const update = parseRecord(operation, path, entry, 'chain update')
    const remoteChainSelector = parseLaneSelector(
      operation,
      `${path}.remoteChainSelector`,
      update.remoteChainSelector,
      seenAdds,
      true,
    )
    const { remotePoolAddresses } = update
    validateArray(operation, `${path}.remotePoolAddresses`, remotePoolAddresses, 1)
    return {
      remoteChainSelector,
      remoteTokenAddress: parseRemoteAddress(
        operation,
        `${path}.remoteTokenAddress`,
        update.remoteTokenAddress,
        remoteChainSelector,
      ),
      remotePoolAddresses: parseUniqueRemoteAddresses(
        operation,
        `${path}.remotePoolAddresses`,
        remotePoolAddresses,
        remoteChainSelector,
      ),
      inboundRateLimiterConfig: parseRateLimitConfig(
        operation,
        `${path}.inboundRateLimiterConfig`,
        update.inboundRateLimiterConfig,
        null,
      ),
      outboundRateLimiterConfig: parseRateLimitConfig(
        operation,
        `${path}.outboundRateLimiterConfig`,
        update.outboundRateLimiterConfig,
        null,
      ),
    }
  })
  return { chainsToAdd: adds, remoteChainSelectorsToRemove: removals }
}

/** Re-keys the SDK's `enabled` to the ABI's `isEnabled`. */
const toAbiRateLimit = ({ enabled: isEnabled, capacity, rate }: ParsedRateLimitConfig) => ({
  isEnabled,
  capacity,
  rate,
})

/**
 * Encodes parsed params into `applyChainUpdates` calldata. `operation` is for the errors of an
 * encoder that has to adapt the params to its signature, and may fail doing so.
 */
type EncodeFn = (
  iface: Interface,
  params: ParsedApplyChainUpdatesParams,
  operation: string,
) => UnsignedEVMTx

// ---------------------------------------------------------------------------
// v1.5.0
// ---------------------------------------------------------------------------

const DISABLED_RATE_LIMIT = { isEnabled: false, capacity: 0n, rate: 0n }

/**
 * Encodes the v1.5.0 signature, adapting the params to its single `chains` array:
 *
 * - each removal becomes an `allowed: false` lane, with empty addresses (the contract ignores
 *   them) and both rate limits disabled — v1.5.0 validates them with `mustBeDisabled = !allowed`
 *   and reverts `RateLimitMustBeDisabled()` otherwise;
 * - each addition becomes an `allowed: true` lane carrying its one remote pool, v1.5.0's singular
 *   `remotePoolAddress`.
 *
 * Removals go first: v1.5.0 applies `chains` in order, so this keeps v1.5.1+'s removals-first
 * semantics, and with them the replace idiom (one selector in both arrays).
 * @throws {@link CCTParamsInvalidError} if a lane lists more than one remote pool, which a v1.5.0
 * pool cannot hold
 */
const encodeV1_5_0: EncodeFn = (iface, params, operation) =>
  callTx(
    params.poolAddress,
    iface.encodeFunctionData('applyChainUpdates', [
      [
        ...params.remoteChainSelectorsToRemove.map((remoteChainSelector) => ({
          remoteChainSelector,
          allowed: false,
          remotePoolAddress: '0x',
          remoteTokenAddress: '0x',
          outboundRateLimiterConfig: DISABLED_RATE_LIMIT,
          inboundRateLimiterConfig: DISABLED_RATE_LIMIT,
        })),
        ...params.chainsToAdd.map((lane, i) => {
          const [remotePoolAddress, ...extra] = lane.remotePoolAddresses
          if (extra.length)
            throw new CCTParamsInvalidError(
              operation,
              `chainsToAdd[${i}].remotePoolAddresses`,
              `must have exactly one entry for a v${TokenPoolVersion.V1_5_0} pool, which holds a single remote pool per lane; got ${lane.remotePoolAddresses.length}`,
            )
          return {
            remoteChainSelector: lane.remoteChainSelector,
            allowed: true,
            remotePoolAddress: encodeAddressToAny(remotePoolAddress!),
            remoteTokenAddress: encodeAddressToAny(lane.remoteTokenAddress),
            outboundRateLimiterConfig: toAbiRateLimit(lane.outboundRateLimiterConfig),
            inboundRateLimiterConfig: toAbiRateLimit(lane.inboundRateLimiterConfig),
          }
        }),
      ],
    ]),
  )

// ---------------------------------------------------------------------------
// v1.5.1+
// ---------------------------------------------------------------------------

/** Encodes the v1.5.1+ signature, which the params mirror one-to-one. */
const encodeV1_5_1: EncodeFn = (iface, params) =>
  callTx(
    params.poolAddress,
    iface.encodeFunctionData('applyChainUpdates', [
      params.remoteChainSelectorsToRemove,
      params.chainsToAdd.map((lane) => ({
        ...lane,
        remoteTokenAddress: encodeAddressToAny(lane.remoteTokenAddress),
        remotePoolAddresses: lane.remotePoolAddresses.map((pool) => encodeAddressToAny(pool)),
        inboundRateLimiterConfig: toAbiRateLimit(lane.inboundRateLimiterConfig),
        outboundRateLimiterConfig: toAbiRateLimit(lane.outboundRateLimiterConfig),
      })),
    ]),
  )

/**
 * Configures, enables and disables a token pool's remote lanes via `applyChainUpdates`.
 *
 * @remarks Owner-gated on-chain (`onlyOwner`). Supply `sender` to have that checked against the
 * pool's `owner()` before a tx is built; {@link ApplyChainUpdates.execute} defaults it to the
 * signing wallet, the only address a broadcast tx can satisfy it with.
 */
export class ApplyChainUpdates extends EVMOperation<
  ApplyChainUpdatesParams,
  ParsedApplyChainUpdatesParams
> {
  readonly name = 'applyChainUpdates'

  /** Encoder per pool version, floor-matched; v1.6.0, v1.6.1 and v2.0.0 inherit v1.5.1's. */
  private readonly encoders: Partial<Record<TokenPoolVersion, EncodeFn>> = {
    [TokenPoolVersion.V1_5_0]: encodeV1_5_0,
    [TokenPoolVersion.V1_5_1]: encodeV1_5_1,
  }

  /**
   * Validates the pool address and every lane entry before any RPC, *keeping* what each check
   * produced so neither {@link buildUnsigned} nor an encoder re-derives it. Only the
   * version-conditional checks are left for once the pool's version is known.
   * @throws {@link CCTParamsInvalidError} if any lane field is invalid
   */
  protected override prepare(params: ApplyChainUpdatesParams): ParsedApplyChainUpdatesParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    return {
      poolAddress: params.poolAddress,
      sender: params.sender,
      ...parseLanes(this.name, params.chainsToAdd, params.remoteChainSelectorsToRemove),
    }
  }

  /**
   * Applies the version-conditional rate bound, which needs the version `resolveTokenPool` has
   * just reported, via the shared {@link parseRateLimitConfig}.
   */
  private assertRateBounds(params: ParsedApplyChainUpdatesParams, version: TokenPoolVersion): void {
    params.chainsToAdd.forEach((lane, i) => {
      for (const direction of ['inboundRateLimiterConfig', 'outboundRateLimiterConfig'] as const) {
        // already parsed to the shared `enabled` shape; re-running with the resolved version
        // applies the version-conditional bound
        parseRateLimitConfig(this.name, `chainsToAdd[${i}].${direction}`, lane[direction], version)
      }
    })
  }

  /**
   * Resolves the pool's type and version, applies the checks that needed it, then encodes for that
   * version's signature — adapting the params to v1.5.0's `chains` array on a legacy pool.
   * @throws {@link CCTParamsInvalidError} if a rate limit breaks its enabled-bucket bound, a lane
   * lists several remote pools for a v1.5.0 pool, or `sender` is not the pool owner
   * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedApplyChainUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)

    this.assertRateBounds(params, version)
    // encoded before the owner probe, so a lane the v1.5.0 adapter cannot express fails first
    const tx = encode(getTokenPoolInterface(type, version), params, this.name)

    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)

    return tx
  }
}
