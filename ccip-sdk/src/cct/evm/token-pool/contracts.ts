/**
 * EVM token-pool contract metadata for CCT, and the reads that resolve it. Families, types and
 * versions; the cached {@link Interface}s built from the vendored ABIs; on-chain type/version
 * resolution ({@link resolveTokenPool}, {@link parseTokenPoolVersion},
 * {@link getTokenPoolInterface}); the deployable pools' creation artifacts
 * ({@link getTokenPoolArtifact}); the version dispatch the write ops encode through
 * ({@link resolveEncoder}); and the owner pre-flight they share ({@link assertPoolOwner}).
 * Mirrors `token/contracts.ts`.
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
 * is distinct. Unsupported values fail in {@link parseTokenPoolVersion}.
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
 * {@link TokenPoolVersion}.
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
  if (!isTokenPoolType(contractType))
    throw new CCTContractTypeInvalidError(address, TOKEN_POOL_TYPES.join(', '), contractType)
  if (!isTokenPoolVersion(version))
    throw new CCTContractVersionUnsupportedError(contractType, version, { context: { address } })

  return { type: contractType, version }
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

/**
 * `Ownable2Step.owner()`, declared identically by every supported pool type and version — so one
 * vendored ABI reads the owner of any of them, with no per-generation dispatch.
 */
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
  const pool: PoolOwnerGetter = getTypedContract(
    chain,
    poolAddress,
    BURN_MINT_TOKEN_POOL_V1_5_0_ABI,
  )
  const owner = getAddress(resultToObject(await pool.owner()))
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
 * - **explicit `null`** — the function is gone from this version up. The walk stops instead of
 *   inheriting downwards, and the op is reported unsupported. Floor-match alone is only sound for
 *   functions that survive; without a ceiling, a removed function's older encoder would emit
 *   calldata for a selector the pool does not implement.
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
