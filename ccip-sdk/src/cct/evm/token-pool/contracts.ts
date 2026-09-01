/**
 * EVM token-pool contract layer for CCT: cached {@link Interface}s + on-chain type/version
 * resolution ({@link resolveTokenPool}, {@link getTokenPoolInterface}, floor-matched via
 * {@link resolveEncoder}) for read/write ops, plus the deployable pools' creation artifacts
 * ({@link getTokenPoolArtifact}), the narrow role reads every owner-gated write pre-flights
 * `sender` against ({@link readTokenPoolOwner}, {@link readTokenPoolRateLimitAdmin}) plus the
 * owner-only guard built on the first of them ({@link assertPoolOwner}). The write-side
 * rate-limit shape lane-config ops share lives in `rate-limit.ts`. Mirrors `token/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface, getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../errors.ts'
import BURN_MINT_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/burn-mint-token-pool-and-proxy.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/lock-release-token-pool-and-proxy.ts'
import BURN_MINT_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/lock-release-token-pool.ts'
import BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-from-mint-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-with-from-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract } from '../query.ts'

/**
 * ABI families for pool resolution. The burn-* variants are interface-compatible for CCT
 * ops (identical constructor + `transferOwnership`, shared TokenPool surface), so they share
 * the `BurnMint` ABI; `LockRelease` (with its liquidity functions) is distinct.
 */
export const TOKEN_POOL_FAMILIES = ['BurnMint', 'LockRelease'] as const

/** An ABI family for pool resolution. */
export type TokenPoolFamily = (typeof TOKEN_POOL_FAMILIES)[number]

/**
 * Supported on-chain `typeAndVersion` pool types. The burn-* variants are interface-compatible
 * for CCT ops and share the `BurnMint` ABI (see {@link getTokenPoolFamily}); `LockReleaseTokenPool`
 * is distinct. Unsupported values fail in {@link parseTokenPoolVersion}, which also normalizes
 * v1.5.0's `*AndProxy` shims onto these base names.
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

/** The lock/release pool types, which share the `LockRelease` ABI. */
export type LockReleaseTokenPoolType = Exclude<TokenPoolType, BurnMintTokenPoolType>

/** Type guard for {@link TOKEN_POOL_TYPES}. */
export function isTokenPoolType(v: string): v is TokenPoolType {
  return (TOKEN_POOL_TYPES as readonly string[]).includes(v)
}

/**
 * Classifies a supported pool type into its ABI {@link TokenPoolFamily} by name: every burn-* pool
 * shares the `BurnMint` ABI (hence the anchored `^Burn`, which also covers
 * `BurnMintWithLockReleaseFlagTokenPool`), and the rest share `LockRelease`.
 * {@link TOKEN_POOL_TYPES} is the gate, so only allowlisted, ABI-compatible names reach here.
 */
export function getTokenPoolFamily(type: TokenPoolType): TokenPoolFamily {
  return /^Burn/.test(type) ? 'BurnMint' : 'LockRelease'
}

/** Narrows a pool type to the {@link LockReleaseTokenPoolType}s, per {@link getTokenPoolFamily}. */
export function isLockReleaseTokenPoolType(type: TokenPoolType): type is LockReleaseTokenPoolType {
  return getTokenPoolFamily(type) === 'LockRelease'
}

/** Known pool versions, low to high. Value order drives floor-match in {@link resolveEncoder}. */
export const TokenPoolVersion = {
  V1_5_0: '1.5.0',
  V1_5_1: '1.5.1',
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
 * @throws {@link CCTContractVersionUnsupportedError} if `version` is not a known pool version
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
    throw new CCTContractVersionUnsupportedError(contractType, version, { context: { address } })

  return { type, version }
}

/**
 * Resolves an on-chain pool's type + version from its `typeAndVersion`, narrowed to a known
 * {@link TokenPoolType} and {@link TokenPoolVersion}.
 * @throws {@link CCTContractTypeInvalidError} if the reported type is not a supported pool type
 * @throws {@link CCTContractVersionUnsupportedError} if the reported version is not a known pool version
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
 * Cached pool {@link Interface}s per {@link TokenPoolFamily} and {@link TokenPoolVersion},
 * built once from the vendored `artifacts/` ABIs (no per-call `new Interface`). `V1_5_0`
 * uses the `*_and_proxy` variants — the only form `@chainlink/contracts-ccip` ships at 1.5.0.
 */
export const TOKEN_POOL_INTERFACES: Record<TokenPoolFamily, Record<TokenPoolVersion, Interface>> = {
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
}

/**
 * Returns the cached pool {@link Interface} for `type` and `version`, selected by the
 * type's {@link TokenPoolFamily}. Never throws when both came from
 * {@link parseTokenPoolVersion}.
 */
export function getTokenPoolInterface(type: TokenPoolType, version: TokenPoolVersion): Interface {
  return TOKEN_POOL_INTERFACES[getTokenPoolFamily(type)][version]
}

/**
 * Reads a token pool's Ownable2Step `owner()` in a single `eth_call`. The one owner read every
 * owner-gated pool write op pre-flights `sender` against.
 *
 * @remarks No `version` parameter and no family dispatch: `owner()` is declared identically —
 * same selector, same `address` return — by both {@link TOKEN_POOL_FAMILIES} at all four
 * supported versions, so the v1.5.0 `BurnMint` interface types the call for every pool.
 * @remarks **Deliberately not routed through the `getTokenPoolState` query op, and must not be
 * "simplified" back to it.** Two reasons, the first of which is a correctness bug and not just a
 * cost concern:
 *
 * 1. `getTokenPoolState` throws {@link CCTContractTypeInvalidError} for a v2.0.0
 *    `SiloedLockReleaseTokenPool`, because that pool escrows per remote chain
 *    (`getLockBox(uint64)`) and so has no single `lockBox` field for the query's result shape to
 *    report. `SiloedLockReleaseTokenPool` is nonetheless a supported {@link TokenPoolType}, and
 *    the write ops' calldata is perfectly valid against it. Gating an owner check through that
 *    query would therefore make every one of those ops permanently unusable on siloed pools —
 *    failing on an unrelated result-shape limitation while `generateUnsigned*` works fine.
 * 2. It costs 6–8 `eth_call`s (token, router, RMN proxy, rate-limit admin, supported chains,
 *    dynamic config, finality config, lockbox) plus a `getTokenInfo` round trip, and re-resolves
 *    `typeAndVersion`, all to obtain one address.
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
  if (version === TokenPoolVersion.V2_0_0) {
    const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
    // getDynamicConfig returns (router, rateLimitAdmin, feeAdmin); index the raw Result rather
    // than resultToObject it, which would turn the named tuple into an object (see
    // get-token-pool-state.ts).
    const dynamicConfig = await pool.getDynamicConfig()
    return getAddress(dynamicConfig[1] as string)
  }
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V1_5_1_ABI)
  return getAddress(resultToObject(await pool.getRateLimitAdmin()))
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
} satisfies Partial<Record<TokenPoolType, `0x${string}`>>

/** A pool contract type that can be deployed (has vendored 2.0.0 creation bytecode). */
export type DeployableTokenPoolType = keyof typeof TOKEN_POOL_BYTECODE

/** Type guard for {@link DeployableTokenPoolType} (has vendored 2.0.0 creation bytecode). */
export function isDeployableTokenPoolType(type: string): type is DeployableTokenPoolType {
  return Object.hasOwn(TOKEN_POOL_BYTECODE, type)
}

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
