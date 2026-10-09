/**
 * EVM token-pool contract layer for CCT: cached {@link Interface}s + on-chain type/version
 * resolution ({@link resolveTokenPool}, {@link getTokenPoolInterface}, floor-matched via
 * {@link resolveEncoder}) for read/write ops, plus the deployable pools' creation artifacts
 * ({@link getTokenPoolArtifact}), the narrow role reads every owner-gated write pre-flights
 * `sender` against ({@link readTokenPoolOwner}, {@link readTokenPoolRateLimitAdmin}), the allowlist
 * resolution and read ({@link resolveAllowlistHolder}, {@link readTokenPoolAllowlist}) plus the
 * owner-only guard built on the first of them ({@link assertPoolOwner}), and the LockRelease
 * liquidity layer: the rebalancer and liquidity reads plus the guards the liquidity ops pre-flight
 * with ({@link assertLockReleasePool}, {@link assertPoolRebalancer},
 * {@link assertLiquidityFunding}, {@link assertPoolLiquidity}), and the siloed pool's per-lane
 * layer on top of it: the v1.6.x silo reads and guards ({@link assertSiloedLockReleasePool},
 * {@link assertSiloedChain}, {@link assertSiloRebalancer}, {@link assertSiloLiquidity}) and the
 * v2.0.0 lane → lockbox reads ({@link readTokenPoolLockboxConfigs},
 * {@link readTokenPoolSiloedLockbox}), with {@link isTokenPoolRevert} to tell a named pool revert
 * from any other failure. The write-side rate-limit shape lane-config ops share lives in
 * `rate-limit.ts`. Mirrors `token/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface, ZeroAddress, getAddress, isError } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { TokenTransferFeeConfig } from '../../../chain.ts'
import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../errors.ts'
import BURN_MINT_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/burn-mint-token-pool-and-proxy.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/lock-release-token-pool-and-proxy.ts'
import BURN_MINT_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/burn-mint-token-pool.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/lock-release-token-pool.ts'
import SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI from '../artifacts/abi/V1_6_0/siloed-lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/lock-release-token-pool.ts'
import SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/siloed-lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/lock-release-token-pool.ts'
import SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/siloed-lock-release-token-pool.ts'
import BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-from-mint-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-with-from-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'
import SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/siloed-lock-release-token-pool.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract } from '../query.ts'

/**
 * ABI families for pool resolution. The burn-* variants are interface-compatible for CCT
 * ops (identical constructor + `transferOwnership`, shared TokenPool surface), so they share
 * the `BurnMint` ABI. `LockRelease` (with its liquidity functions) is distinct, and
 * `SiloedLockRelease` is distinct again because it escrows per remote chain: at 1.6.x it adds the
 * silo functions and lacks `transferLiquidity`; at 2.0.0 it binds a lockbox per lane
 * (`getLockBox(uint64)`, `configureLockBoxes`) instead of taking one `lockBox` in its constructor.
 *
 * @remarks Both lock/release families satisfy {@link isLockReleaseTokenPoolType}; test that, not
 * `family === 'LockRelease'`, to ask whether a pool escrows liquidity.
 */
export const TOKEN_POOL_FAMILIES = ['BurnMint', 'LockRelease', 'SiloedLockRelease'] as const

/** An ABI family for pool resolution. */
export type TokenPoolFamily = (typeof TOKEN_POOL_FAMILIES)[number]

/**
 * Supported on-chain `typeAndVersion` pool types. The burn-* variants are interface-compatible
 * for CCT ops and share the `BurnMint` ABI; `LockReleaseTokenPool` and
 * `SiloedLockReleaseTokenPool` each have their own (see {@link getTokenPoolFamily}). Unsupported
 * values fail in {@link parseTokenPoolVersion}, which also normalizes v1.5.0's `*AndProxy` shims
 * onto these base names.
 */
export const TOKEN_POOL_TYPES = [
  'BurnMintTokenPool',
  'BurnFromMintTokenPool',
  'BurnWithFromMintTokenPool',
  'BurnToAddressTokenPool',
  'BurnMintWithLockReleaseFlagTokenPool',
  'LockReleaseTokenPool',
  'SiloedLockReleaseTokenPool',
] as const

/** A supported EVM token-pool contract type. */
export type TokenPoolType = (typeof TOKEN_POOL_TYPES)[number]

/** The burn-* mint pool types, which share the `BurnMint` ABI. */
export type BurnMintTokenPoolType = Extract<TokenPoolType, `Burn${string}`>

/** The lock/release pool types: the `LockRelease` and `SiloedLockRelease` families. */
export type LockReleaseTokenPoolType = Exclude<TokenPoolType, BurnMintTokenPoolType>

/** Type guard for {@link TOKEN_POOL_TYPES}. */
export function isTokenPoolType(v: string): v is TokenPoolType {
  return (TOKEN_POOL_TYPES as readonly string[]).includes(v)
}

/**
 * Classifies a supported pool type into its ABI {@link TokenPoolFamily} by name: every burn-* pool
 * shares the `BurnMint` ABI (hence the anchored `^Burn`, which also covers
 * `BurnMintWithLockReleaseFlagTokenPool`), `SiloedLockReleaseTokenPool` is `SiloedLockRelease`,
 * and `LockReleaseTokenPool` is `LockRelease`. {@link TOKEN_POOL_TYPES} is the gate, so only
 * allowlisted, ABI-compatible names reach here.
 */
export function getTokenPoolFamily(type: TokenPoolType): TokenPoolFamily {
  if (/^Burn/.test(type)) return 'BurnMint'
  return type === 'SiloedLockReleaseTokenPool' ? 'SiloedLockRelease' : 'LockRelease'
}

/**
 * Narrows a pool type to the {@link LockReleaseTokenPoolType}s: every family but `BurnMint`, so
 * both the siloed and non-siloed lock/release pools.
 */
export function isLockReleaseTokenPoolType(type: TokenPoolType): type is LockReleaseTokenPoolType {
  return getTokenPoolFamily(type) !== 'BurnMint'
}

/**
 * Known pool versions, low to high. Value order drives floor-match in {@link resolveEncoder}.
 *
 * @remarks **Exact-match allowlist.** A pool resolves only if it reports one of these versions
 * verbatim; an unlisted version (e.g. `1.6.2`) throws {@link CCTContractVersionUnsupportedError}
 * rather than being treated as its nearest lower neighbour. Pool ABIs have changed across minor
 * versions (1.5.0 → 1.5.1 changed `applyChainUpdates`), so accepting an unseen version could
 * build calldata for a function that does not exist. Floor-match is only how an op picks an
 * *encoder* among these accepted versions.
 * @remarks `V1_6_0` exists only for `SiloedLockReleaseTokenPool`, the one pool the 1.6.0 release
 * stamped `1.6.0`; see {@link parseTokenPoolVersion}.
 */
export const TokenPoolVersion = {
  V1_5_0: '1.5.0',
  V1_5_1: '1.5.1',
  V1_6_0: '1.6.0',
  V1_6_1: '1.6.1',
  V2_0_0: '2.0.0',
} as const

/** A known EVM token-pool version. */
export type TokenPoolVersion = (typeof TokenPoolVersion)[keyof typeof TokenPoolVersion]

/** Type guard for {@link TokenPoolVersion}. */
export function isTokenPoolVersion(v: string): v is TokenPoolVersion {
  return Object.values(TokenPoolVersion).some((known) => known === v)
}

/**
 * Narrows raw `typeAndVersion` strings to a known {@link TokenPoolType} and
 * {@link TokenPoolVersion}. A v1.5.0 `*AndProxy` type normalizes to its base pool type.
 * @throws {@link CCTContractTypeInvalidError} if `contractType` is not a supported pool type
 * @throws {@link CCTContractVersionUnsupportedError} if `version` is not a known pool version, or
 * not one the type's family shipped at (see {@link TOKEN_POOL_INTERFACES})
 */
export function parseTokenPoolVersion({
  address,
  contractType,
  version,
}: {
  address: string
  contractType: string
  version: string
}): { type: TokenPoolType; version: TokenPoolVersion } {
  // v1.5.0's `*AndProxy` shims override only lockOrBurn/releaseOrMint, so every function a CCT op
  // encodes is the base pool's — and the vendored v1.5.0 ABIs are the `*_and_proxy` ones already.
  const type =
    version === TokenPoolVersion.V1_5_0 ? contractType.replace(/AndProxy$/, '') : contractType
  if (!isTokenPoolType(type))
    throw new CCTContractTypeInvalidError(address, TOKEN_POOL_TYPES.join(', '), contractType)
  if (!isTokenPoolVersion(version))
    throw new CCTContractVersionUnsupportedError(contractType, version, {
      context: { address },
    })
  // a version the type's family never shipped at (1.6.0 shipped only the siloed pool, which first
  // shipped at 1.6.0) is not a contract we know
  if (!TOKEN_POOL_INTERFACE_LOOKUP[getTokenPoolFamily(type)][version])
    throw new CCTContractVersionUnsupportedError(contractType, version, {
      context: { address },
    })

  return { type, version }
}

/**
 * Resolves an on-chain pool's type + version from its `typeAndVersion`, narrowed to a known
 * {@link TokenPoolType} and {@link TokenPoolVersion}.
 * @throws {@link CCTContractTypeInvalidError} if the reported type is not a supported pool type
 * @throws {@link CCTContractVersionUnsupportedError} if the reported version is not a known pool version
 * @remarks Exact match only; see {@link TokenPoolVersion}.
 */
export async function resolveTokenPool(
  chain: EVMChain,
  address: string,
): Promise<{ type: TokenPoolType; version: TokenPoolVersion }> {
  const [contractType, version] = await chain.typeAndVersion(address)
  return parseTokenPoolVersion({ address, contractType, version })
}

/** `Ownable2Step.owner()`, identical across all supported pool types and versions. */
type PoolOwnerGetter = Pick<TypedContract<typeof BURN_MINT_TOKEN_POOL_V1_5_0_ABI>, 'owner'>

/**
 * Pre-flights `sender` against the pool's on-chain `owner()` for an owner-gated write, so an
 * unauthorized caller fails as a {@link CCTParamsInvalidError} here instead of as an opaque
 * `OwnableUnauthorizedAccount` revert after a multisig has already reviewed and signed.
 *
 * @remarks A single `owner()` call, not the full `getTokenPoolState` query: `owner` is the only
 * field this needs and the only one whose getter never changed spelling, so reading it directly
 * costs one `eth_call` instead of a second `typeAndVersion` resolution plus every admin field.
 * @remarks For an owner-*only* gate. Not for a gate that accepts more than the owner —
 * `setChainRateLimiterConfigs` takes `owner` **or** `rateLimitAdmin`, and collapsing that
 * disjunction to this helper would lock out a delegated rate-limit admin.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the owner from.
 * @param poolAddress - Token pool being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the pool owner
 */
export async function assertPoolOwner(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  sender: string,
): Promise<void> {
  const owner = await readTokenPoolOwner(chain, poolAddress)
  if (getAddress(sender) === owner) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    `must be the current token pool owner (${owner})`,
  )
}

/**
 * Bounds a two-step ownership transfer against the pool's `owner()`, in one `eth_call`: `sender`,
 * when known, must be it, and `newOwner` must not already be (`CannotTransferToSelf`). Bounding
 * `newOwner` against the chain is what makes it hold with no `sender`.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the owner from.
 * @param poolAddress - Pool being written to.
 * @param newOwner - The address being proposed as the next owner.
 * @param sender - The address the tx will be sent from, when known.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the owner, or `newOwner` already is
 */
export async function assertPoolOwnershipTransfer(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  newOwner: string,
  sender?: string,
): Promise<void> {
  const owner = await readTokenPoolOwner(chain, poolAddress)
  if (sender !== undefined && getAddress(sender) !== owner)
    throw new CCTParamsInvalidError(
      operation,
      'sender',
      `must be the current token pool owner (${owner})`,
    )
  if (getAddress(newOwner) === owner)
    throw new CCTParamsInvalidError(
      operation,
      'newOwner',
      `must differ from the current token pool owner (${owner}) — the pool would revert CannotTransferToSelf`,
    )
}

/**
 * Guards a LockRelease-only op: the liquidity and rebalancer functions are absent from the
 * `BurnMint` ABI, so without this the op would hand that {@link Interface} an unknown function
 * name and fail as an opaque ethers error instead of naming the real problem.
 * @param operation - Operation name, for the error's context.
 * @param poolAddress - Token pool being acted on.
 * @param type - Pool type, as resolved by {@link resolveTokenPool}.
 * @throws {@link CCTContractTypeInvalidError} if `type` is not a {@link LockReleaseTokenPoolType}
 */
export function assertLockReleasePool(
  operation: string,
  poolAddress: string,
  type: TokenPoolType,
): void {
  if (isLockReleaseTokenPoolType(type)) return
  throw new CCTContractTypeInvalidError(
    poolAddress,
    'LockRelease token pool',
    type,
    `${operation} is a lock/release liquidity function, which the BurnMint pools do not declare`,
    { context: { operation } },
  )
}

/**
 * Guards an op that needs the *one* lockbox a LockRelease pool escrows through: a LockRelease
 * pool, and not the siloed variant.
 *
 * @remarks Stricter than {@link assertLockReleasePool}, which both variants satisfy. A
 * `SiloedLockReleaseTokenPool` escrows per remote chain and declares `getLockBox(uint64)` with no
 * no-arg overload, so there is no single lockbox to name; rejecting it on its *type* (rather than
 * letting the call revert) is what makes {@link readTokenPoolLockbox} safe to call.
 * @param operation - Operation name, for the error's context.
 * @param poolAddress - Token pool being read.
 * @param type - Pool type, as resolved by {@link resolveTokenPool}.
 * @throws {@link CCTContractTypeInvalidError} if `type` is a BurnMint pool, or is siloed
 */
export function assertNonSiloedLockReleasePool(
  operation: string,
  poolAddress: string,
  type: TokenPoolType,
): void {
  assertLockReleasePool(operation, poolAddress, type)
  if (type !== 'SiloedLockReleaseTokenPool') return
  throw new CCTContractTypeInvalidError(
    poolAddress,
    'LockReleaseTokenPool',
    type,
    "a siloed pool escrows per remote chain and declares getLockBox(uint64) instead, so it has no single lockbox; read a lane's lockbox with getSiloedLockbox, or all of them with getAllSiloedLockboxConfigs",
    { context: { operation } },
  )
}

/**
 * Guards a per-lane siloed op: the silo functions (v1.6.x) and the lane → lockbox functions
 * (v2.0.0) are declared only by `SiloedLockReleaseTokenPool`, so without this the op would hand
 * another family's {@link Interface} an unknown function name and fail as an opaque ethers error.
 *
 * @remarks The siloed counterpart of {@link assertNonSiloedLockReleasePool}. A non-siloed
 * `LockReleaseTokenPool` gets a pointer to its single-bucket equivalents, since that is the
 * likeliest mix-up.
 * @param operation - Operation name, for the error's context.
 * @param poolAddress - Token pool being acted on.
 * @param type - Pool type, as resolved by {@link resolveTokenPool}.
 * @throws {@link CCTContractTypeInvalidError} if `type` is not `SiloedLockReleaseTokenPool`
 */
export function assertSiloedLockReleasePool(
  operation: string,
  poolAddress: string,
  type: TokenPoolType,
): void {
  if (type === 'SiloedLockReleaseTokenPool') return
  throw new CCTContractTypeInvalidError(
    poolAddress,
    'SiloedLockReleaseTokenPool',
    type,
    `${operation} is a per-lane siloed function, which only SiloedLockReleaseTokenPool declares` +
      (type === 'LockReleaseTokenPool'
        ? '; a LockReleaseTokenPool has one bucket for every lane: use getLockbox (v2.0.0) or provideLiquidity / withdrawLiquidity / getRebalancer (v1.5.0–v1.6.1)'
        : ''),
    { context: { operation } },
  )
}

/**
 * Cached pool {@link Interface}s per {@link TokenPoolFamily}, for exactly the
 * {@link TokenPoolVersion}s that family shipped at, built once from the vendored `artifacts/` ABIs
 * (no per-call `new Interface`). `V1_5_0` uses the `*_and_proxy` variants — the only form
 * `@chainlink/contracts-ccip` ships at 1.5.0.
 *
 * @remarks The table is the allowlist of pool versions: 1.6.0 shipped only the siloed pool, and the
 * siloed pool first shipped at 1.6.0, so `BurnMint` and `LockRelease` have no 1.6.0 entry and
 * `SiloedLockRelease` no 1.5.x one. {@link parseTokenPoolVersion} rejects a pool claiming a missing
 * pair, so every resolved pool has an entry.
 */
export const TOKEN_POOL_INTERFACES = {
  BurnMint: {
    [TokenPoolVersion.V1_5_0]: new Interface(BURN_MINT_TOKEN_POOL_V1_5_0_ABI),
    [TokenPoolVersion.V1_5_1]: new Interface(BURN_MINT_TOKEN_POOL_V1_5_1_ABI),
    [TokenPoolVersion.V1_6_1]: new Interface(BURN_MINT_TOKEN_POOL_V1_6_1_ABI),
    [TokenPoolVersion.V2_0_0]: new Interface(BURN_MINT_TOKEN_POOL_V2_0_0_ABI),
  },
  LockRelease: {
    [TokenPoolVersion.V1_5_0]: new Interface(LOCK_RELEASE_TOKEN_POOL_V1_5_0_ABI),
    [TokenPoolVersion.V1_5_1]: new Interface(LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI),
    [TokenPoolVersion.V1_6_1]: new Interface(LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI),
    [TokenPoolVersion.V2_0_0]: new Interface(LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI),
  },
  SiloedLockRelease: {
    [TokenPoolVersion.V1_6_0]: new Interface(SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI),
    [TokenPoolVersion.V1_6_1]: new Interface(SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI),
    [TokenPoolVersion.V2_0_0]: new Interface(SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI),
  },
} satisfies Record<TokenPoolFamily, Partial<Record<TokenPoolVersion, Interface>>>

/** {@link TOKEN_POOL_INTERFACES} widened for lookup by any family and version. */
const TOKEN_POOL_INTERFACE_LOOKUP: Record<
  TokenPoolFamily,
  Partial<Record<TokenPoolVersion, Interface>>
> = TOKEN_POOL_INTERFACES

/**
 * Returns the cached pool {@link Interface} for `type` and `version`, selected by the type's
 * {@link TokenPoolFamily}. Never throws when both came from {@link parseTokenPoolVersion}.
 * @throws {@link CCTContractVersionUnsupportedError} if the type's family never shipped at
 * `version`
 */
export function getTokenPoolInterface(type: TokenPoolType, version: TokenPoolVersion): Interface {
  const iface = TOKEN_POOL_INTERFACE_LOOKUP[getTokenPoolFamily(type)][version]
  if (!iface) throw new CCTContractVersionUnsupportedError(type, version)
  return iface
}

/**
 * Reads a token pool's Ownable2Step `owner()` in a single `eth_call`. The one owner read every
 * owner-gated pool write op pre-flights `sender` against.
 *
 * @remarks No `version` parameter and no family dispatch: `owner()` is declared identically —
 * same selector, same `address` return — by every {@link TOKEN_POOL_FAMILIES} entry at every
 * supported version, so the v1.5.0 `BurnMint` interface types the call for every pool.
 * @remarks **Deliberately not routed through the `getTokenPoolState` query op, and must not be
 * "simplified" back to it.** That query costs 6–8 `eth_call`s (token, router, RMN proxy,
 * rate-limit admin, supported chains, dynamic config, finality config, lockbox) plus a
 * `getTokenInfo` round trip, and re-resolves `typeAndVersion`, all to obtain one address that
 * this one call returns — on every owner-gated write op, at every version.
 *
 * This mirrors `token-admin-registry/operations/transfer-admin.ts`, which likewise does its own
 * narrow pre-tx read rather than going through a read op.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool contract to read `owner()` from.
 * @returns The current owner, checksummed.
 */
export async function readTokenPoolOwner(chain: EVMChain, poolAddress: string): Promise<string> {
  const pool: PoolOwnerGetter = getTypedContract(
    chain,
    poolAddress,
    BURN_MINT_TOKEN_POOL_V1_5_0_ABI,
  )
  return getAddress(resultToObject(await pool.owner()))
}

/**
 * Reads a v2.0.0 pool's packed `allowedFinality` config in one `eth_call`.
 * @remarks Callers must resolve and require v2.0.0 first: earlier pool ABIs do not declare this
 * getter. The raw `bytes4` stays here so its consumer chooses the SDK-level decoded shape.
 * @param chain - Chain to read from.
 * @param poolAddress - v2.0.0 token pool to read.
 * @returns The packed `bytes4` finality config.
 */
export async function readTokenPoolAllowedFinality(
  chain: EVMChain,
  poolAddress: string,
): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
  return resultToObject(await pool.getAllowedFinalityConfig())
}

/**
 * Reads the `AdvancedPoolHooks` contract bound to a v2.0.0 pool in one `eth_call`.
 *
 * @remarks Callers must resolve and require v2.0.0 first: the hooks binding was introduced with
 * that pool interface. The getter is declared on the v2.0.0 `TokenPool` base and inherited
 * unchanged by every pool family, so the BurnMint ABI resolves it for a LockRelease pool too.
 * @param chain - Chain to read from.
 * @param poolAddress - v2.0.0 token pool to read.
 * @returns The bound hooks contract, checksummed; the zero address when none is bound, which
 * means the pool enforces no allowlist and no CCV requirements.
 */
export async function readTokenPoolAdvancedPoolHooks(
  chain: EVMChain,
  poolAddress: string,
): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
  return getAddress(resultToObject(await pool.getAdvancedPoolHooks()))
}

/**
 * Fee parameters a v2.0.0 pool resolves for one destination chain and requested finality mode.
 *
 * @remarks This is the selected standard- or fast-finality tier, not the raw stored pair of tiers.
 * When `isEnabled` is `false`, every numeric field is zero. See {@link TokenTransferFeeConfig} for
 * the raw configuration returned by `getTokenTransferFeeConfig`.
 */
export type TokenPoolFee = {
  /** USD surcharge, in cents, added to the CCIP fee for the selected finality tier. */
  feeUSDCents: bigint
  /** Gas overhead added to the destination-chain execution-cost estimate. */
  destGasOverhead: number
  /** Byte overhead added to the destination-chain data-availability-cost estimate. */
  destBytesOverhead: number
  /** Transfer amount deducted as a fee, in basis points (`0..9999`; one BPS is 0.01%). */
  tokenFeeBps: number
  /** Whether the destination chain has an enabled token-transfer fee configuration. */
  isEnabled: boolean
}

/**
 * Reads a v2.0.0 pool's fee parameters in one `eth_call`.
 *
 * @remarks Standard pools use only `destChainSelector` and `requestedFinalityConfig`; the other
 * `getFee` ABI inputs are reserved for pool-specific implementations, so this supplies their
 * neutral values.
 */
export async function readTokenPoolFee(
  chain: EVMChain,
  poolAddress: string,
  destChainSelector: bigint,
  requestedFinalityConfig: string,
): Promise<TokenPoolFee> {
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
  const fee = await pool.getFee(
    ZeroAddress,
    destChainSelector,
    0n,
    ZeroAddress,
    requestedFinalityConfig,
    '0x',
  )
  return {
    feeUSDCents: fee[0] as bigint,
    destGasOverhead: Number(fee[1]),
    destBytesOverhead: Number(fee[2]),
    tokenFeeBps: Number(fee[3]),
    isEnabled: fee[4] as boolean,
  }
}

/** Reads a v2.0.0 pool's token and its token-transfer fee config in two `eth_call`s. */
export async function readTokenPoolTokenTransferFeeConfig(
  chain: EVMChain,
  poolAddress: string,
  destChainSelector: bigint,
  finality: string,
  tokenArgs: string,
): Promise<TokenTransferFeeConfig> {
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
  const tokenAddress = await pool.getToken()
  const config = await pool.getTokenTransferFeeConfig(
    tokenAddress,
    destChainSelector,
    finality,
    tokenArgs,
  )
  return {
    destGasOverhead: Number(config.destGasOverhead),
    destBytesOverhead: Number(config.destBytesOverhead),
    finalityFeeUSDCents: Number(config.finalityFeeUSDCents),
    fastFinalityFeeUSDCents: Number(config.fastFinalityFeeUSDCents),
    finalityTransferFeeBps: Number(config.finalityTransferFeeBps),
    fastFinalityTransferFeeBps: Number(config.fastFinalityTransferFeeBps),
    isEnabled: config.isEnabled,
  }
}

/**
 * Resolves the contract holding a pool's sender allowlist: the pool itself on v1.5.0–v1.6.1. A
 * v2.0.0 pool has no allowlist of its own and enforces the one on its bound `AdvancedPoolHooks`,
 * which may back several pools at once.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool to resolve.
 * @returns The pool's type + version, and `holder` checksummed: the zero address for a v2.0.0 pool
 * with no hooks bound, which enforces no allowlist.
 * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
 * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
 */
export async function resolveAllowlistHolder(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ type: TokenPoolType; version: TokenPoolVersion; holder: string }> {
  const pool = await resolveTokenPool(chain, poolAddress)
  const holder =
    pool.version === TokenPoolVersion.V2_0_0
      ? await readTokenPoolAdvancedPoolHooks(chain, poolAddress)
      : getAddress(poolAddress)
  return { ...pool, holder }
}

/**
 * The allowlist getters, identical across v1.5.0–v1.6.1, every ABI family, and v2.0.0's
 * `AdvancedPoolHooks`. Absent from the v2.0.0 pool itself — resolve the holder first.
 */
type PoolAllowlistGetter = Pick<
  TypedContract<typeof BURN_MINT_TOKEN_POOL_V1_5_0_ABI>,
  'getAllowListEnabled' | 'getAllowList'
>

/**
 * Reads a sender allowlist and whether the feature is enabled at all, in two parallel
 * `eth_call`s.
 *
 * @remarks Same rationale as {@link readTokenPoolOwner} for not routing through
 * `getTokenPoolState`, which does not expose the allowlist.
 * @remarks `enabled` is fixed for the holder's lifetime: both set `i_allowlistEnabled`
 * *immutable* in their constructor, to `allowlist.length > 0`. A holder deployed without an
 * allowlist can therefore never gain one, and every `applyAllowListUpdates` against it reverts
 * `AllowListNotEnabled`.
 * @param chain - Chain to read from.
 * @param poolAddress - Allowlist holder to read from, as returned by
 * {@link resolveAllowlistHolder}: a v1.5.0–v1.6.1 pool or an `AdvancedPoolHooks`.
 * @returns `enabled`, and the current entries checksummed (empty when disabled).
 */
export async function readTokenPoolAllowlist(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ enabled: boolean; entries: string[] }> {
  const pool: PoolAllowlistGetter = getTypedContract(
    chain,
    poolAddress,
    BURN_MINT_TOKEN_POOL_V1_5_0_ABI,
  )
  const [enabled, entries] = await Promise.all([pool.getAllowListEnabled(), pool.getAllowList()])
  return {
    enabled: resultToObject(enabled),
    entries: resultToObject(entries).map((entry) => getAddress(entry)),
  }
}

/**
 * Reads a token pool's `rateLimitAdmin` — the delegated role the pools accept for rate-limit
 * writes alongside the owner — in a single `eth_call`.
 *
 * @remarks Same rationale as {@link readTokenPoolOwner} for not routing through
 * `getTokenPoolState`.
 * @remarks Version-dispatched, unlike `owner()`: v1.5.0–v1.6.1 expose a standalone
 * `getRateLimitAdmin()`, while v2.0.0 folded the role into `getDynamicConfig()`'s
 * `(router, rateLimitAdmin, feeAdmin)` triple.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool contract to read from.
 * @param version - Pool version, as resolved by {@link resolveTokenPool}; selects the getter.
 * @returns The current rate-limit admin, checksummed. The zero address when the role is unset —
 * callers must treat that as "matches nobody" rather than comparing it directly.
 */
export async function readTokenPoolRateLimitAdmin(
  chain: EVMChain,
  poolAddress: string,
  version: TokenPoolVersion,
): Promise<string> {
  if (version === TokenPoolVersion.V2_0_0)
    return (await readTokenPoolDynamicConfig(chain, poolAddress)).rateLimitAdmin
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V1_5_1_ABI)
  return getAddress(resultToObject(await pool.getRateLimitAdmin()))
}

/** The v2.0.0 pool's mutable router and delegated admin roles. */
export type TokenPoolDynamicConfig = {
  router: string
  rateLimitAdmin: string
  feeAdmin: string
}

/** Reads a v2.0.0 pool's dynamic config in one `eth_call`. */
export async function readTokenPoolDynamicConfig(
  chain: EVMChain,
  poolAddress: string,
): Promise<TokenPoolDynamicConfig> {
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
  // Index the raw Result: resultToObject would turn this named tuple into an object.
  const dynamicConfig = await pool.getDynamicConfig()
  return {
    router: getAddress(dynamicConfig[0] as string),
    rateLimitAdmin: getAddress(dynamicConfig[1] as string),
    feeAdmin: getAddress(dynamicConfig[2] as string),
  }
}

/** Reads the v2.0.0 pool's delegated token-transfer-fee admin in one `eth_call`. */
export async function readTokenPoolFeeAdmin(chain: EVMChain, poolAddress: string): Promise<string> {
  return (await readTokenPoolDynamicConfig(chain, poolAddress)).feeAdmin
}

/** Pre-flights `sender` against the pool owner or its delegated v2.0.0 `feeAdmin`. */
export async function assertPoolOwnerOrFeeAdmin(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  sender: string,
): Promise<void> {
  const [owner, feeAdmin] = await Promise.all([
    readTokenPoolOwner(chain, poolAddress),
    readTokenPoolFeeAdmin(chain, poolAddress),
  ])
  const signer = getAddress(sender)
  if (signer === owner || (feeAdmin !== ZeroAddress && signer === feeAdmin)) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    `must be the pool owner (${owner})${
      feeAdmin === ZeroAddress
        ? ' — this pool has no feeAdmin set'
        : ` or its feeAdmin (${feeAdmin})`
    }`,
  )
}

/**
 * Reads a LockRelease pool's `rebalancer` — the single account the pool accepts
 * `provideLiquidity` / `withdrawLiquidity` from — in one `eth_call`.
 *
 * @remarks No dispatch, but callers must resolve the pool first
 * ({@link assertLockReleasePool}, plus a v2.0.0 check): `getRebalancer()` is declared identically
 * at v1.5.0–v1.6.1 by both LockRelease types, and is absent from a `BurnMint` pool and from
 * v2.0.0, so those cases should report the type or version rather than a bare call failure.
 * @remarks On a `SiloedLockReleaseTokenPool` this is the *unsiloed* rebalancer, which is what its
 * plain liquidity entry points gate on; the per-lane `getChainRebalancer(uint64)` governs the
 * siloed ones (see {@link readTokenPoolChainRebalancer} and the `getChainRebalancer` op).
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool to read `getRebalancer()` from.
 * @returns The current rebalancer, checksummed; the zero address when none is configured, which
 * means the pool accepts liquidity calls from nobody.
 */
export async function readTokenPoolRebalancer(
  chain: EVMChain,
  poolAddress: string,
): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI)
  return getAddress(resultToObject(await pool.getRebalancer()))
}

/**
 * Pre-flights `sender` against the pool's on-chain `getRebalancer()` for a liquidity write, the
 * rebalancer-gated counterpart of {@link assertPoolOwner}.
 *
 * @remarks Deliberately *not* the owner: `provideLiquidity` and `withdrawLiquidity` compare
 * `msg.sender` to `s_rebalancer` and revert `Unauthorized` for everyone else, the owner included.
 * The owner's role is to appoint the rebalancer, not to move liquidity itself.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the rebalancer from.
 * @param poolAddress - Token pool being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the pool's rebalancer, or no
 * rebalancer is configured
 */
export async function assertPoolRebalancer(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  sender: string,
): Promise<void> {
  const rebalancer = await readTokenPoolRebalancer(chain, poolAddress)
  if (rebalancer !== ZeroAddress && getAddress(sender) === rebalancer) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    rebalancer === ZeroAddress
      ? `no rebalancer is configured on ${poolAddress}, so it accepts liquidity calls from nobody; the pool owner must appoint one with setRebalancer`
      : `must be the current pool rebalancer (${rebalancer})`,
  )
}

/**
 * Reads a non-siloed v2.0.0 LockRelease pool's `getLockBox()` — the `ERC20LockBox` it escrows
 * through — in one `eth_call`.
 *
 * @remarks No dispatch, but callers must resolve the pool first and gate on both halves of the
 * result: `getLockBox()` exists only at v2.0.0 (pre-2.0.0 pools hold liquidity themselves) and
 * only on the non-siloed LockRelease type — {@link assertNonSiloedLockReleasePool} for the type,
 * an explicit v2.0.0 check for the version. Otherwise this reads as a bare revert instead of
 * naming which of the two is wrong. Same reasoning as {@link readTokenPoolRebalancer}.
 * @param chain - Chain to read from.
 * @param poolAddress - Non-siloed v2.0.0 LockRelease pool to read `getLockBox()` from.
 * @returns The pool's lockbox, checksummed. Set in the constructor and immutable thereafter.
 */
export async function readTokenPoolLockbox(chain: EVMChain, poolAddress: string): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI)
  return getAddress(resultToObject(await pool.getLockBox()))
}

/**
 * Reads a v1.5.0 / v1.5.1 LockRelease pool's `canAcceptLiquidity()` in one `eth_call`.
 *
 * @remarks Only declared at v1.5.0 and v1.5.1, where the constructor fixes `i_acceptLiquidity`
 * *immutable*: a pool deployed with it `false` rejects every deposit with `LiquidityNotAccepted`
 * for its whole lifetime, which is why that is worth one call to catch before signing. v1.6.x
 * pools have no flag and always accept, so callers must not reach here for it. Same shape as
 * {@link readTokenPoolAllowlist}'s `enabled`.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool to read from; must be v1.5.0 or v1.5.1.
 * @returns Whether the pool accepts liquidity deposits at all.
 */
export async function readTokenPoolAcceptsLiquidity(
  chain: EVMChain,
  poolAddress: string,
): Promise<boolean> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI)
  return resultToObject(await pool.canAcceptLiquidity())
}

/**
 * The token a pool escrows, plus a handle to it, in one `eth_call`. `getToken()` is declared
 * identically by every pool type and version, so this needs no dispatch.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool to read `getToken()` from.
 * @returns The escrowed token, checksummed, and an ERC-20 contract bound to it.
 */
export async function readTokenPoolToken(
  chain: EVMChain,
  poolAddress: string,
): Promise<{
  token: string
  erc20: TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>
}> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI)
  const token = getAddress(resultToObject(await pool.getToken()))
  return {
    token,
    erc20: getTypedContract(chain, token, FACTORY_BURN_MINT_ERC20_V1_5_1_ABI),
  }
}

/**
 * Pre-flights a `provideLiquidity` deposit against the rebalancer's ERC-20 position: it must hold
 * `amount` of the pool's token *and* have approved the pool to pull it, since the pool deposits
 * with `safeTransferFrom`.
 *
 * @remarks Cross-family parity with Solana, whose `provideLiquidity` likewise refuses to build
 * without the SPL delegation (`validateDelegation`) and the balance behind it. Without this the
 * only signal is an `ERC20InsufficientAllowance` revert at wallet-confirmation time, naming
 * neither the token to approve nor the pool to approve it to. The error names `approveToken`,
 * which grants exactly this allowance.
 * @remarks Advisory: an allowance can be spent or revoked between building and signing. It moves
 * only on an explicit `approve` though, so unlike a pool balance it is stable enough to be worth
 * the round trip.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool being deposited into.
 * @param account - The depositing rebalancer.
 * @param amount - Deposit amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if `account` holds less than `amount`, or has approved the
 * pool for less than `amount`
 */
export async function assertLiquidityFunding(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  account: string,
  amount: bigint,
): Promise<void> {
  const { token, erc20 } = await readTokenPoolToken(chain, poolAddress)
  const [balance, allowance] = await Promise.all([
    erc20.balanceOf(account),
    erc20.allowance(account, poolAddress),
  ])
  if (balance < amount)
    throw new CCTTxFailedError(
      operation,
      `${account} holds ${balance} of ${token}, but ${amount} is required; mint or transfer tokens first`,
    )
  if (allowance < amount)
    throw new CCTTxFailedError(
      operation,
      `${account} has approved ${allowance} of ${token} to pool ${poolAddress}, but ${amount} is required; the deposit is a transferFrom, so grant the allowance first with approveToken({ tokenAddress: '${token}', spender: '${poolAddress}', amount: ${amount}n })`,
    )
}

/**
 * Pre-flights a `withdrawLiquidity` against what the pool can pay out of: its own ERC-20 balance,
 * or on a `SiloedLockReleaseTokenPool` its unsiloed liquidity ({@link readTokenPoolLiquidity}).
 *
 * @remarks Weaker than {@link assertLiquidityFunding}: a pool's balance moves with every CCIP
 * transfer through it, so this catches "withdraw more than was ever provided" rather than proving
 * the amount will still fit when the tx mines.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool being withdrawn from.
 * @param type - Pool type, as resolved by {@link resolveTokenPool}.
 * @param amount - Withdrawal amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if the pool's withdrawable liquidity is below `amount`
 */
export async function assertPoolLiquidity(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  type: TokenPoolType,
  amount: bigint,
): Promise<void> {
  const { token, liquidity } = await readTokenPoolLiquidity(chain, poolAddress, type)
  if (liquidity >= amount) return
  throw new CCTTxFailedError(
    operation,
    `pool ${poolAddress} ${describeLiquidity(
      type,
      liquidity,
      token,
    )}, but ${amount} is required; it would revert InsufficientLiquidity`,
  )
}

/**
 * A pool's withdrawable liquidity and the token it is denominated in.
 *
 * @remarks Returns the token as well so `transferLiquidity`, which checks both pools escrow the
 * same one, needs no second read.
 * @remarks On a `SiloedLockReleaseTokenPool` this is `getUnsiloedLiquidity()`, not the pool's
 * balance: the plain `withdrawLiquidity(uint256)` pays only out of the unsiloed bucket, while the
 * balance also holds every per-lane silo. Read against the v1.6.0 siloed ABI at v1.6.1 too: the
 * function is identical there.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool to read.
 * @param type - Pool type, as resolved by {@link resolveTokenPool}.
 * @returns The escrowed token, checksummed, and the liquidity `withdrawLiquidity` can pay out.
 */
export async function readTokenPoolLiquidity(
  chain: EVMChain,
  poolAddress: string,
  type: TokenPoolType,
): Promise<{ token: string; liquidity: bigint }> {
  if (type === 'SiloedLockReleaseTokenPool') {
    const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI)
    const [{ token }, liquidity] = await Promise.all([
      readTokenPoolToken(chain, poolAddress),
      pool.getUnsiloedLiquidity(),
    ])
    return { token, liquidity }
  }
  const { token, erc20 } = await readTokenPoolToken(chain, poolAddress)
  return { token, liquidity: await erc20.balanceOf(poolAddress) }
}

/**
 * The "holds N of token" clause of an insufficient-liquidity error, naming the unsiloed bucket on
 * a siloed pool so the figure is not mistaken for its balance.
 * @param type - Pool type the liquidity was read for.
 * @param liquidity - As returned by {@link readTokenPoolLiquidity}.
 * @param token - The escrowed token.
 * @returns The clause, with no subject.
 */
export function describeLiquidity(type: TokenPoolType, liquidity: bigint, token: string): string {
  return type === 'SiloedLockReleaseTokenPool'
    ? `has ${liquidity} of ${token} in unsiloed liquidity`
    : `holds ${liquidity} of ${token}`
}

/**
 * Reads a v1.6.x siloed pool's `isSiloed(remoteChainSelector)` in one `eth_call`.
 *
 * @remarks Callers must resolve the pool first ({@link assertSiloedLockReleasePool}, plus a
 * v1.6.x check): the getter is absent from every other family and from v2.0.0. Read against the
 * v1.6.0 siloed ABI at v1.6.1 too, as {@link readTokenPoolLiquidity} does: the function is
 * identical there.
 * @param chain - Chain to read from.
 * @param poolAddress - v1.6.x `SiloedLockReleaseTokenPool` to read.
 * @param remoteChainSelector - Lane to ask about.
 * @returns Whether the lane has its own silo; `false` for selector 0 and for unknown lanes.
 */
export async function readTokenPoolIsSiloed(
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
): Promise<boolean> {
  const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI)
  return resultToObject(await pool.isSiloed(remoteChainSelector))
}

/**
 * Reads a pool's `isSupportedChain(remoteChainSelector)` in one `eth_call`.
 * @remarks Declared on the `TokenPool` base, so any family has it; typed here through the v1.6.0
 * siloed ABI because its one caller, `updateSiloDesignations`, needs it there.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool to read.
 * @param remoteChainSelector - Lane to ask about.
 * @returns Whether the lane is in the pool's supported-chain set (added by `applyChainUpdates`).
 */
export async function readTokenPoolIsSupportedChain(
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
): Promise<boolean> {
  const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI)
  return resultToObject(await pool.isSupportedChain(remoteChainSelector))
}

/**
 * Reads a v1.6.x siloed pool's `getChainRebalancer(remoteChainSelector)` in one `eth_call`: the
 * account `provideSiloedLiquidity` / `withdrawSiloedLiquidity` accept for that lane.
 * @remarks Same gating as {@link readTokenPoolIsSiloed}. On an unsiloed lane the pool answers with
 * its unsiloed rebalancer ({@link readTokenPoolRebalancer}).
 * @param chain - Chain to read from.
 * @param poolAddress - v1.6.x `SiloedLockReleaseTokenPool` to read.
 * @param remoteChainSelector - Lane to ask about.
 * @returns The rebalancer, checksummed; the zero address when none is set, which means the lane
 * accepts liquidity calls from nobody.
 */
export async function readTokenPoolChainRebalancer(
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI)
  return getAddress(resultToObject(await pool.getChainRebalancer(remoteChainSelector)))
}

/**
 * Reads a v1.6.x siloed pool's `getAvailableTokens(remoteChainSelector)` in one `eth_call`: the
 * silo's balance on a siloed lane, the shared unsiloed bucket on any other.
 * @remarks Same gating as {@link readTokenPoolIsSiloed}. The raw call: it reverts
 * `InvalidChainSelector` for a lane the pool does not support; test for that with
 * {@link isTokenPoolRevert}.
 * @param chain - Chain to read from.
 * @param poolAddress - v1.6.x `SiloedLockReleaseTokenPool` to read.
 * @param remoteChainSelector - Lane to ask about.
 * @returns The liquidity available to that lane, in the token's smallest unit.
 */
export async function readTokenPoolAvailableTokens(
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
): Promise<bigint> {
  const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V1_6_0_ABI)
  return resultToObject(await pool.getAvailableTokens(remoteChainSelector))
}

/**
 * True when `err` is a pool call that reverted with the custom error `errorName`, as decoded by
 * the typed contract's ABI.
 *
 * @remarks For reads whose revert *is* the answer (`getAvailableTokens` on an unsupported lane,
 * `getLockBox(uint64)` on an unbound one), so the caller can turn that one case into a typed
 * error while a transport failure, rate limit or any other revert propagates untouched. Narrower
 * than `isMissingFunction`, which matches every revert.
 * @param err - The caught error.
 * @param errorName - The custom error's name, e.g. `'LockBoxNotConfigured'`.
 */
export function isTokenPoolRevert(err: unknown, errorName: string): boolean {
  // not `isError(...) && ...`: `isError` answers a nullish `err` with that falsy value, not `false`
  if (!isError(err, 'CALL_EXCEPTION')) return false
  return err.revert?.name === errorName
}

/**
 * Pre-flights that a lane is siloed on a v1.6.x siloed pool, since the per-lane liquidity and
 * rebalancer writes revert `ChainNotSiloed` otherwise.
 *
 * @remarks A property of the pool, not of the caller, so the ops run it with or without a
 * `sender`. The error names both cures: designate the lane, or use the unsiloed-bucket ops.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - v1.6.x `SiloedLockReleaseTokenPool` being written to.
 * @param remoteChainSelector - Lane being acted on.
 * @throws {@link CCTParamsInvalidError} if the lane is not siloed
 */
export async function assertSiloedChain(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
): Promise<void> {
  if (await readTokenPoolIsSiloed(chain, poolAddress, remoteChainSelector)) return
  throw new CCTParamsInvalidError(
    operation,
    'remoteChainSelector',
    `lane ${remoteChainSelector} is not siloed on ${poolAddress}, so it would revert ChainNotSiloed; designate it with updateSiloDesignations, or use provideLiquidity / withdrawLiquidity for the shared unsiloed bucket`,
  )
}

/**
 * Pre-flights `sender` against a lane's `getChainRebalancer(remoteChainSelector)` for a per-lane
 * liquidity write: the per-lane counterpart of {@link assertPoolRebalancer}.
 *
 * @remarks Run after {@link assertSiloedChain}, so the rebalancer read is the silo's own rather
 * than the unsiloed one the pool falls back to. Neither the owner nor the unsiloed rebalancer may
 * move a silo's liquidity; the pool reverts `Unauthorized` for both.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - v1.6.x `SiloedLockReleaseTokenPool` being written to.
 * @param remoteChainSelector - The siloed lane.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the silo's rebalancer, or the silo has
 * none
 */
export async function assertSiloRebalancer(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
  sender: string,
): Promise<void> {
  const rebalancer = await readTokenPoolChainRebalancer(chain, poolAddress, remoteChainSelector)
  if (rebalancer !== ZeroAddress && getAddress(sender) === rebalancer) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    rebalancer === ZeroAddress
      ? `no rebalancer is set for silo ${remoteChainSelector} on ${poolAddress} (revoked via setSiloRebalancer), so it accepts liquidity calls from nobody; the pool owner must appoint one with setSiloRebalancer`
      : `must be the rebalancer of silo ${remoteChainSelector} (${rebalancer})`,
  )
}

/**
 * Pre-flights a `withdrawSiloedLiquidity` against the silo's own balance
 * (`getAvailableTokens(remoteChainSelector)`), which is all it can pay out of.
 *
 * @remarks Advisory, like {@link assertPoolLiquidity}: every CCIP transfer on the lane moves the
 * balance, so this catches "withdraw more than the silo was ever given" rather than proving the
 * amount will still fit when the tx mines.
 * @remarks Skipped, not failed, when the read reverts `InvalidChainSelector`: the siloed pool does
 * not override `applyChainUpdates`, so a lane removed from the supported chains stays siloed. Its
 * balance is then unreadable, yet `withdrawSiloedLiquidity` still pays out of it; draining such a
 * lane is exactly when this op is needed.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - v1.6.x `SiloedLockReleaseTokenPool` being withdrawn from.
 * @param remoteChainSelector - The siloed lane.
 * @param amount - Withdrawal amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if the silo holds less than `amount`
 */
export async function assertSiloLiquidity(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
  amount: bigint,
): Promise<void> {
  let token: string, available: bigint
  try {
    ;[{ token }, available] = await Promise.all([
      readTokenPoolToken(chain, poolAddress),
      readTokenPoolAvailableTokens(chain, poolAddress, remoteChainSelector),
    ])
  } catch (err) {
    if (isTokenPoolRevert(err, 'InvalidChainSelector')) return
    throw err
  }
  if (available >= amount) return
  throw new CCTTxFailedError(
    operation,
    `silo ${remoteChainSelector} on ${poolAddress} holds ${available} of ${token}, but ${amount} is required; it would revert InsufficientLiquidity`,
  )
}

/** EVM deployable pool contract types with vendored 2.0.0 creation bytecode. */
export const DEPLOYABLE_TOKEN_POOL_TYPES = [
  'BurnMintTokenPool',
  'BurnFromMintTokenPool',
  'BurnWithFromMintTokenPool',
  'LockReleaseTokenPool',
  'SiloedLockReleaseTokenPool',
] as const satisfies readonly TokenPoolType[]

/** A pool contract type that can be deployed (has vendored 2.0.0 creation bytecode). */
export type DeployableTokenPoolType = (typeof DEPLOYABLE_TOKEN_POOL_TYPES)[number]

/** Type guard for {@link DeployableTokenPoolType} (has vendored 2.0.0 creation bytecode). */
export function isDeployableTokenPoolType(value: string): value is DeployableTokenPoolType {
  return (DEPLOYABLE_TOKEN_POOL_TYPES as readonly string[]).includes(value)
}

/**
 * One lane → lockbox binding of a v2.0.0 `SiloedLockReleaseTokenPool`: the contract's
 * `LockBoxConfig` struct, with the SDK's `lockbox` casing.
 */
export type LockboxConfig = {
  /** The remote chain whose transfers escrow through {@link lockbox}. */
  remoteChainSelector: bigint
  /** The `ERC20LockBox` for that lane, checksummed when read; lanes may share one. */
  lockbox: string
}

/**
 * Reads a v2.0.0 siloed pool's `getAllLockBoxConfigs()` in one `eth_call`.
 * @remarks Callers must resolve the pool first ({@link assertSiloedLockReleasePool}, plus a
 * v2.0.0 check): the getter exists only there.
 * @param chain - Chain to read from.
 * @param poolAddress - v2.0.0 `SiloedLockReleaseTokenPool` to read.
 * @returns Every bound lane in the contract's enumeration order, lockboxes checksummed; `[]` when
 * none is bound.
 */
export async function readTokenPoolLockboxConfigs(
  chain: EVMChain,
  poolAddress: string,
): Promise<LockboxConfig[]> {
  const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI)
  const configs = resultToObject(await pool.getAllLockBoxConfigs())
  return configs.map((config) => ({
    remoteChainSelector: config.remoteChainSelector,
    lockbox: getAddress(config.lockBox),
  }))
}

/**
 * Reads a v2.0.0 siloed pool's `getLockBox(remoteChainSelector)` in one `eth_call`: the lockbox
 * that lane's transfers escrow through.
 * @remarks Same gating as {@link readTokenPoolLockboxConfigs}. The raw call: it reverts
 * `LockBoxNotConfigured` for an unbound lane; test for that with {@link isTokenPoolRevert}.
 * @param chain - Chain to read from.
 * @param poolAddress - v2.0.0 `SiloedLockReleaseTokenPool` to read.
 * @param remoteChainSelector - Lane to ask about.
 * @returns The lane's lockbox, checksummed.
 */
export async function readTokenPoolSiloedLockbox(
  chain: EVMChain,
  poolAddress: string,
  remoteChainSelector: bigint,
): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI)
  return getAddress(resultToObject(await pool.getLockBox(remoteChainSelector)))
}

/**
 * Creation bytecode per deployable pool type (2.0.0 only — pre-2.0.0 bytecode is not vendored).
 * The keys define the deployable set ({@link DeployableTokenPoolType}). The burn-* variants share
 * the `BurnMint` constructor ABI but are distinct contracts with distinct bytecode.
 */
const TOKEN_POOL_BYTECODE = {
  BurnMintTokenPool: BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  BurnFromMintTokenPool: BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  BurnWithFromMintTokenPool: BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  LockReleaseTokenPool: LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE,
  SiloedLockReleaseTokenPool: SILOED_LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE,
} satisfies Record<DeployableTokenPoolType, `0x${string}`>

/**
 * Deploy artifact for a deployable pool `type` (v2.0.0): contract name (= `type`), the cached
 * constructor {@link Interface}, and the creation bytecode.
 */
export function getTokenPoolArtifact(type: DeployableTokenPoolType): DeployArtifact {
  return {
    contract: type,
    iface: getTokenPoolInterface(type, TokenPoolVersion.V2_0_0),
    bytecode: TOKEN_POOL_BYTECODE[type],
  }
}

/**
 * Returns the encoder registered at the greatest version less than or equal to `version`,
 * walking {@link TokenPoolVersion} downwards from `version`.
 *
 * A table entry says one of two things:
 * - **absent key** — the calldata did not change here, so it *inherits* the closest lower entry.
 *   One entry per calldata change therefore covers every higher version.
 * - **explicit `null`** — the function was removed at this version, so the op is reported
 *   unsupported rather than emitting calldata for a selector the pool does not implement.
 *
 * @param encoders - Sparse table keyed by {@link TokenPoolVersion}; `null` marks a removal ceiling.
 * @param version - The resolved on-chain pool version to encode for.
 * @param op - Operation name, for the error.
 * @throws {@link CCTOperationUnsupportedError} if nothing is registered at or below `version`, or
 * if the walk hits an explicit `null` ceiling first
 */
export function resolveEncoder<F>(
  encoders: Partial<Record<TokenPoolVersion, F | null>>,
  version: TokenPoolVersion,
  op: string,
): F {
  const versions = Object.values(TokenPoolVersion)
  for (let i = versions.indexOf(version); i >= 0; i--) {
    const encoder = encoders[versions[i]!]
    // removed here — do not inherit the lower encoder downward
    if (encoder === null) break
    if (encoder !== undefined) return encoder
  }
  throw new CCTOperationUnsupportedError(op, version)
}
