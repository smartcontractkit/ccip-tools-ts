/**
 * applyChainUpdates — configures, enables and disables a token pool's remote lanes: the remote
 * token, the remote pool(s) allowed to bridge into it, and both directional rate limits.
 *
 * The one CCT pool write whose *parameters* changed shape mid-life. {@link ApplyChainUpdatesParams}
 * is therefore discriminated on which lane fields are present — the v1.5.0 `chains` array vs the
 * v1.5.1+ `chainsToAdd` / `remoteChainSelectorsToRemove` pair — rather than on an explicit
 * `version`, which is now an optional override: like its ~17 sibling pool write-ops, the shape is
 * auto-resolved from the pool's own `typeAndVersion` (the same on-chain read
 * {@link ApplyChainUpdates.buildUnsigned} already makes). The file is sectioned by version so each
 * shape's type, parser and encoder sit together.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { encodeAddressToAny } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { parseRemoteAddress, parseUniqueRemoteAddresses } from '../../../remote-address.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import {
  parseRecord,
  validateArray,
  validateBoolean,
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
// Shared
// ---------------------------------------------------------------------------

/**
 * The `version` discriminant of {@link ApplyChainUpdatesParams}: the two parameter shapes
 * `applyChainUpdates` has had, each spelled as the version that introduced it — so `1.5.1` is the
 * shape for every pool from v1.5.1 up, v1.6.0, v1.6.1 and v2.0.0 included.
 */
export type ApplyChainUpdatesParamVersion =
  | typeof TokenPoolVersion.V1_5_0
  | typeof TokenPoolVersion.V1_5_1

/** The lane fields both parameter shapes share, and which encode identically. */
type ChainUpdateCommon = {
  /** CCIP selector of the remote chain (`uint64`). */
  remoteChainSelector: bigint
  /**
   * Remote token address in the remote chain's own format (`0x…` for EVM, base58 for Solana, …),
   * the family taken from `remoteChainSelector`. Encoded to the 32-byte padded `bytes` the pool
   * stores; an unpadded EVM remote would configure fine, then revert every inbound transfer.
   */
  remoteTokenAddress: string
  /** Rate limit for tokens received from the remote chain. */
  inboundRateLimiterConfig: RateLimitConfig
  /** Rate limit for tokens sent to the remote chain. */
  outboundRateLimiterConfig: RateLimitConfig
}

/** The top-level parameters both shapes share; each version adds its own lane arrays. */
type ApplyChainUpdatesBaseParams = {
  /** Token pool whose lanes are being configured. */
  poolAddress: string
  /**
   * Pool owner; sets `tx.from` for offline / multisig signing. When supplied it is also
   * pre-flighted against the pool's on-chain `owner()`, so an unauthorized caller fails here
   * rather than as an opaque revert.
   */
  sender?: string
}

/** A lane with its rate limits resolved — derived, so the parsed and public shapes cannot drift. */
type WithParsedRateLimits<T> = Omit<T, 'inboundRateLimiterConfig' | 'outboundRateLimiterConfig'> & {
  inboundRateLimiterConfig: ParsedRateLimitConfig
  outboundRateLimiterConfig: ParsedRateLimitConfig
}

/**
 * Parses a lane's `remoteChainSelector`: a `uint64`, unique within its own array, and — for a lane
 * being *added* — non-zero. `seen` is mutated as each selector is accepted, and is per-array: the
 * same selector in both v1.5.1 arrays is the replace idiom.
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

/**
 * Parses the lane fields both shapes share. `adding` is false only for a v1.5.0 removal, whose
 * remote addresses the contract ignores: they are left unparsed, as `''`, and encoded empty.
 */
function parseLaneCommon(
  operation: string,
  path: string,
  update: { [k: string]: unknown },
  seen: Set<bigint>,
  adding: boolean,
): WithParsedRateLimits<ChainUpdateCommon> {
  const remoteChainSelector = parseLaneSelector(
    operation,
    `${path}.remoteChainSelector`,
    update.remoteChainSelector,
    seen,
    adding,
  )
  return {
    remoteChainSelector,
    remoteTokenAddress: adding
      ? parseRemoteAddress(
          operation,
          `${path}.remoteTokenAddress`,
          update.remoteTokenAddress,
          remoteChainSelector,
        )
      : '',
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
}

// ---------------------------------------------------------------------------
// v1.5.0
// ---------------------------------------------------------------------------

/**
 * One lane's configuration on a **v1.5.0** pool.
 * @remarks Field-for-field the Solana `ChainUpdate` in
 * `cct/solana/token-pool/operations/apply-chain-updates.ts`, minus its Solana-only
 * `remoteTokenDecimals`.
 */
export type ChainUpdateV1_5_0 = ChainUpdateCommon & {
  /**
   * Whether the lane is enabled. **v1.5.0 only** — `false` removes the lane, which is how this
   * version spells v1.5.1+'s `remoteChainSelectorsToRemove`. Every other field is still required
   * for a removal, though the contract ignores both remote addresses, so they are not validated
   * and are encoded as empty bytes; a lane of `0n` or of a chain the SDK does not know can still be
   * removed. Both rate limits must be `{ enabled: false }`: v1.5.0
   * validates them with `mustBeDisabled = !update.allowed` and reverts `RateLimitMustBeDisabled()`
   * otherwise, so passing a lane's current (enabled) limits back through is rejected.
   */
  allowed: boolean
  /**
   * Remote pool address in the remote chain's own format, like `remoteTokenAddress`. Singular at
   * v1.5.0 — one pool per lane.
   */
  remotePoolAddress: string
}

/**
 * {@link ApplyChainUpdatesParamsV1_5_0} once parsed. Shares {@link ApplyChainUpdatesBaseParams} so
 * `poolAddress` / `sender` cannot drift, and pins `version` to a *definite* shape discriminant —
 * {@link ApplyChainUpdates.parse} always sets it, whether the caller supplied it or it was inferred
 * — so {@link ApplyChainUpdates.buildUnsigned} can assert it against the resolved pool.
 */
type ParsedApplyChainUpdatesParamsV1_5_0 = ApplyChainUpdatesBaseParams & {
  version: typeof TokenPoolVersion.V1_5_0
  chains: WithParsedRateLimits<ChainUpdateV1_5_0>[]
}

/**
 * Parses the v1.5.0 `chains` array. See {@link ChainUpdateV1_5_0.allowed} for why a removal must
 * also carry both rate limits disabled.
 */
function parseChainsV1_5_0(operation: string, chains: unknown) {
  validateArray(operation, 'chains', chains, 1)
  const seen = new Set<bigint>()
  return chains.map((entry, i) => {
    const path = `chains[${i}]`
    const update = parseRecord(operation, path, entry, 'chain update')
    const { allowed } = update
    validateBoolean(operation, `${path}.allowed`, allowed)
    const common = parseLaneCommon(operation, path, update, seen, allowed)
    const lane = {
      ...common,
      allowed,
      remotePoolAddress: allowed
        ? parseRemoteAddress(
            operation,
            `${path}.remotePoolAddress`,
            update.remotePoolAddress,
            common.remoteChainSelector,
          )
        : '',
    }
    const stillEnabled =
      !allowed &&
      (['inboundRateLimiterConfig', 'outboundRateLimiterConfig'] as const).find(
        (direction) => lane[direction].enabled,
      )
    if (stillEnabled) {
      throw new CCTParamsInvalidError(
        operation,
        `${path}.${stillEnabled}`,
        'must be disabled when allowed is false: v1.5.0 validates both rate limits with mustBeDisabled = !allowed and reverts RateLimitMustBeDisabled — pass { enabled: false } for a removal',
      )
    }
    return lane
  })
}

/** Encodes the v1.5.0 signature. */
const encodeV1_5_0 = (
  iface: Interface,
  params: ParsedApplyChainUpdatesParamsV1_5_0,
): UnsignedEVMTx =>
  callTx(
    params.poolAddress,
    iface.encodeFunctionData('applyChainUpdates', [
      params.chains.map((lane) => ({
        ...lane,
        // a removal's addresses are ignored on-chain, so they go out empty
        remoteTokenAddress: lane.allowed ? encodeAddressToAny(lane.remoteTokenAddress) : '0x',
        remotePoolAddress: lane.allowed ? encodeAddressToAny(lane.remotePoolAddress) : '0x',
        // re-key the shared `enabled` to the ABI's `isEnabled`
        inboundRateLimiterConfig: (({ enabled: isEnabled, capacity, rate }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.inboundRateLimiterConfig),
        outboundRateLimiterConfig: (({ enabled: isEnabled, capacity, rate }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.outboundRateLimiterConfig),
      })),
    ]),
  )

// ---------------------------------------------------------------------------
// v1.5.1+
// ---------------------------------------------------------------------------

/**
 * One lane's configuration on a **v1.5.1+** pool. No `allowed` bit: removals are a separate array
 * on {@link ApplyChainUpdatesParams}.
 */
export type ChainUpdateV1_5_1 = ChainUpdateCommon & {
  /**
   * Remote pool addresses in the remote chain's own format, like `remoteTokenAddress` — plural,
   * because a lane may accept several remote pools, e.g. while migrating one. Non-empty, and unique
   * within the lane (compared by canonical spelling, so two spellings of one address collide).
   */
  remotePoolAddresses: string[]
}

/**
 * {@link ApplyChainUpdatesParamsV1_5_1} once parsed. Shares {@link ApplyChainUpdatesBaseParams} and
 * pins a definite `version` discriminant, for the same reasons as
 * {@link ParsedApplyChainUpdatesParamsV1_5_0}.
 */
type ParsedApplyChainUpdatesParamsV1_5_1 = ApplyChainUpdatesBaseParams & {
  version: typeof TokenPoolVersion.V1_5_1
  chainsToAdd: WithParsedRateLimits<ChainUpdateV1_5_1>[]
  remoteChainSelectorsToRemove: bigint[]
}

/** Parses the v1.5.1+ pair of arrays: removals (applied first on-chain), then additions. */
function parseChainsV1_5_1(
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
  const adds = chainsToAdd.map((entry, i) => {
    const path = `chainsToAdd[${i}]`
    const update = parseRecord(operation, path, entry, 'chain update')
    const common = parseLaneCommon(operation, path, update, seenAdds, true)
    const { remotePoolAddresses } = update
    validateArray(operation, `${path}.remotePoolAddresses`, remotePoolAddresses, 1)
    return {
      ...common,
      remotePoolAddresses: parseUniqueRemoteAddresses(
        operation,
        `${path}.remotePoolAddresses`,
        remotePoolAddresses,
        common.remoteChainSelector,
      ),
    }
  })
  return { chainsToAdd: adds, remoteChainSelectorsToRemove: removals }
}

/** Encodes the v1.5.1+ signature. */
const encodeV1_5_1 = (
  iface: Interface,
  params: ParsedApplyChainUpdatesParamsV1_5_1,
): UnsignedEVMTx =>
  callTx(
    params.poolAddress,
    iface.encodeFunctionData('applyChainUpdates', [
      params.remoteChainSelectorsToRemove,
      params.chainsToAdd.map((lane) => ({
        ...lane,
        remoteTokenAddress: encodeAddressToAny(lane.remoteTokenAddress),
        remotePoolAddresses: lane.remotePoolAddresses.map((pool) => encodeAddressToAny(pool)),
        // re-key the shared `enabled` to the ABI's `isEnabled`
        inboundRateLimiterConfig: (({ enabled: isEnabled, capacity, rate }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.inboundRateLimiterConfig),
        outboundRateLimiterConfig: (({ enabled: isEnabled, capacity, rate }) => ({
          isEnabled,
          capacity,
          rate,
        }))(lane.outboundRateLimiterConfig),
      })),
    ]),
  )

/**
 * Parameters for {@link ApplyChainUpdates}, a mutually-exclusive union discriminated on which lane
 * fields are present — the v1.5.0 `chains` array vs the v1.5.1+ `chainsToAdd` /
 * `remoteChainSelectorsToRemove` pair — not on `version`.
 *
 * `version` is an **optional** override, not a required discriminant. Omit it and the calldata
 * shape is inferred from the fields you pass, then reconciled against the pool's own
 * `typeAndVersion` — the same on-chain read {@link ApplyChainUpdates.buildUnsigned} already makes,
 * so omitting it costs no extra RPC. Supply it and it is honoured *and* asserted: it must match
 * both the fields present and the pool's resolved shape, so an explicit `version` acts as a safety
 * assertion. The two signatures have different selectors (`0xdb6327dc` vs `0xe8a1da17`), so a
 * mismatch surfaces as a {@link CCTParamsInvalidError} rather than a tx that reverts on an unknown
 * function.
 */
export type ApplyChainUpdatesParams = ApplyChainUpdatesParamsV1_5_0 | ApplyChainUpdatesParamsV1_5_1

/** The **v1.5.0** parameter shape: a single `chains` array, each lane carrying its `allowed` bit. */
export type ApplyChainUpdatesParamsV1_5_0 = ApplyChainUpdatesBaseParams & {
  /**
   * Optional shape override; auto-resolved when omitted. If supplied it must be `'1.5.0'` — the
   * shape spelled by the `chains` array — and must match the pool's resolved version.
   */
  version?: typeof TokenPoolVersion.V1_5_0
  /**
   * Lanes to configure; `allowed: false` removes one. At least one entry, no holes, and a given
   * `remoteChainSelector` may appear only once. Its presence selects the v1.5.0 shape.
   */
  chains: ChainUpdateV1_5_0[]
  /** Mutually exclusive with {@link ApplyChainUpdatesParamsV1_5_0.chains}; never both. */
  chainsToAdd?: never
  /** Mutually exclusive with {@link ApplyChainUpdatesParamsV1_5_0.chains}; never both. */
  remoteChainSelectorsToRemove?: never
}

/** The **v1.5.1+** parameter shape: additions and removals as two arrays. */
export type ApplyChainUpdatesParamsV1_5_1 = ApplyChainUpdatesBaseParams & {
  /**
   * Optional shape override; auto-resolved when omitted. If supplied it must be `'1.5.1'` — the
   * shape for every pool from v1.5.1 up (v1.6.0, v1.6.1, v2.0.0 included) — and must match the
   * pool's resolved version.
   */
  version?: typeof TokenPoolVersion.V1_5_1
  /**
   * Lanes to add or reconfigure. To replace a lane's remote pools wholesale, list its selector
   * here *and* in `remoteChainSelectorsToRemove` — the contract applies removals first, so that
   * cross-array pairing stays legal. Within this array a selector may appear only once, and may
   * not be `0n`; holes are rejected too. Presence of this or `remoteChainSelectorsToRemove`
   * selects the v1.5.1+ shape.
   */
  chainsToAdd: ChainUpdateV1_5_1[]
  /**
   * Lanes to remove, applied before `chainsToAdd`. No duplicates and no holes; `0n` *is* accepted
   * here, so a pool already holding a junk lane can be cleaned up.
   */
  remoteChainSelectorsToRemove: bigint[]
  /** Mutually exclusive with the v1.5.1+ arrays; never combined with a v1.5.0 `chains`. */
  chains?: never
}

/**
 * {@link ApplyChainUpdatesParams} as {@link ApplyChainUpdates.parse} leaves it. The encoders add
 * no validation of their own — a parsed lane is already a `ChainUpdate` struct.
 */
type ParsedApplyChainUpdatesParams =
  | ParsedApplyChainUpdatesParamsV1_5_0
  | ParsedApplyChainUpdatesParamsV1_5_1

/** Encodes parsed params into `applyChainUpdates` calldata, widened over the parsed union. */
type EncodeFn = (iface: Interface, params: ParsedApplyChainUpdatesParams) => UnsignedEVMTx

/** One {@link ApplyChainUpdates.encoders} entry: the shape it accepts, and the {@link EncodeFn} for it. */
type Encoder<V extends ApplyChainUpdatesParamVersion> = {
  shape: V
  encode: EncodeFn
}

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
  private readonly encoders = {
    [TokenPoolVersion.V1_5_0]: {
      shape: TokenPoolVersion.V1_5_0,
      encode: encodeV1_5_0,
    },
    [TokenPoolVersion.V1_5_1]: {
      shape: TokenPoolVersion.V1_5_1,
      encode: encodeV1_5_1,
    },
  } as { [V in ApplyChainUpdatesParamVersion]?: Encoder<V> }

  /**
   * Infers the calldata shape from which lane fields are present, rejecting a contradictory
   * combination, and — when `version` was supplied — asserting it agrees with those fields. The
   * pool's own version is not read here (that is {@link buildUnsigned}'s reconciliation); this only
   * fixes which *shape* the params are, so {@link parse} knows which parser to run.
   * @throws {@link CCTParamsInvalidError} if both shapes' fields are present, neither is, or an
   * explicit `version` disagrees with the fields
   */
  private resolveShape(params: ApplyChainUpdatesParams): ApplyChainUpdatesParamVersion {
    // Read presence through a loose lens: the public union is mutually exclusive, so TS would
    // narrow a typed read and treat the second field as provably absent — but contradictory input
    // (e.g. a hand-rolled or `as`-cast caller passing both shapes) is exactly what this rejects.
    const fields = params as {
      chains?: unknown
      chainsToAdd?: unknown
      remoteChainSelectorsToRemove?: unknown
    }
    const hasV1_5_0 = fields.chains !== undefined
    const hasV1_5_1 =
      fields.chainsToAdd !== undefined || fields.remoteChainSelectorsToRemove !== undefined

    if (hasV1_5_0 && hasV1_5_1)
      throw new CCTParamsInvalidError(
        this.name,
        'chains',
        `must not be combined with chainsToAdd/remoteChainSelectorsToRemove: chains is the v${TokenPoolVersion.V1_5_0} shape and chainsToAdd/remoteChainSelectorsToRemove is the v${TokenPoolVersion.V1_5_1}+ shape — pass one shape's fields, not both`,
      )
    if (!hasV1_5_0 && !hasV1_5_1)
      throw new CCTParamsInvalidError(
        this.name,
        'chains',
        `must supply either chains (the v${TokenPoolVersion.V1_5_0} shape) or chainsToAdd/remoteChainSelectorsToRemove (the v${TokenPoolVersion.V1_5_1}+ shape)`,
      )

    const shape = hasV1_5_0 ? TokenPoolVersion.V1_5_0 : TokenPoolVersion.V1_5_1
    const { version } = params
    if (version !== undefined && version !== shape)
      throw new CCTParamsInvalidError(
        this.name,
        'version',
        `is '${version}' but the fields present are the v${shape} shape — omit version to infer it, or pass the fields for the declared shape (chains for ${TokenPoolVersion.V1_5_0}, chainsToAdd/remoteChainSelectorsToRemove for ${TokenPoolVersion.V1_5_1})`,
      )
    return shape
  }

  /**
   * Validates the pool address and every lane entry before any RPC, *keeping* what each check
   * produced so neither {@link buildUnsigned} nor an encoder re-derives it. The calldata shape is
   * inferred from the fields via {@link resolveShape} (an explicit `version` is an optional
   * override, asserted there), and pinned as a definite discriminant on the parsed result. Only the
   * version-conditional rate bound is left to {@link assertRateBounds}.
   * @throws {@link CCTParamsInvalidError} if the shape is ambiguous or contradictory, or any lane
   * field is invalid
   */
  protected override parse(params: ApplyChainUpdatesParams): ParsedApplyChainUpdatesParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    const { poolAddress, sender } = params
    switch (this.resolveShape(params)) {
      case TokenPoolVersion.V1_5_0:
        return {
          poolAddress,
          sender,
          version: TokenPoolVersion.V1_5_0,
          chains: parseChainsV1_5_0(this.name, params.chains),
        }
      case TokenPoolVersion.V1_5_1:
        return {
          poolAddress,
          sender,
          version: TokenPoolVersion.V1_5_1,
          ...parseChainsV1_5_1(this.name, params.chainsToAdd, params.remoteChainSelectorsToRemove),
        }
    }
  }

  /**
   * Applies the version-conditional rate bound, which needs the version `resolveTokenPool` has
   * just reported, via the shared {@link parseRateLimitConfig}.
   */
  private assertRateBounds(params: ParsedApplyChainUpdatesParams, version: TokenPoolVersion): void {
    const lanes =
      params.version === TokenPoolVersion.V1_5_0
        ? params.chains.map((lane, i) => [`chains[${i}]`, lane] as const)
        : params.chainsToAdd.map((lane, i) => [`chainsToAdd[${i}]`, lane] as const)

    for (const [path, lane] of lanes) {
      for (const direction of ['inboundRateLimiterConfig', 'outboundRateLimiterConfig'] as const) {
        // already parsed to the shared `enabled` shape; re-running with the resolved version
        // applies the version-conditional bound
        parseRateLimitConfig(this.name, `${path}.${direction}`, lane[direction], version)
      }
    }
  }

  /**
   * Resolves the pool's type and version, applies the checks that needed it, then encodes. The
   * pool's resolved shape is reconciled against the params' shape — whether that shape was
   * inferred from the fields or asserted from an explicit `version` — so a v1.5.0 `chains` payload
   * against a v1.5.1+ pool (or the reverse) fails here rather than reverting on a selector the pool
   * does not implement.
   * @throws {@link CCTParamsInvalidError} if the params' shape is not this pool's, a rate limit
   * breaks its enabled-bucket bound, or `sender` is not the pool owner
   * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedApplyChainUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)

    // explicit type argument: inference would otherwise fix `F` to the first entry's `shape`
    const { shape, encode } = resolveEncoder<Encoder<ApplyChainUpdatesParamVersion>>(
      this.encoders,
      version,
      this.name,
    )
    if (params.version !== shape)
      throw new CCTParamsInvalidError(
        this.name,
        'version',
        `is the v${shape} shape for this pool, which reports v${version}, but the ${
          params.version === TokenPoolVersion.V1_5_0
            ? 'chains'
            : 'chainsToAdd/remoteChainSelectorsToRemove'
        } fields are the v${params.version} shape — the two signatures have different selectors, so that shape would not exist on-chain. Pass the v${shape} shape's fields (chains for ${TokenPoolVersion.V1_5_0}, chainsToAdd/remoteChainSelectorsToRemove for ${TokenPoolVersion.V1_5_1})`,
      )

    this.assertRateBounds(params, version)

    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)

    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet — the only
   * address the contract's `onlyOwner` check can pass. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ApplyChainUpdatesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
