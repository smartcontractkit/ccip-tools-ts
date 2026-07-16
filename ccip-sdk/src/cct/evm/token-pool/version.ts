/**
 * EVM token-pool version axis for CCT: resolve on-chain pool metadata and ABI
 * ({@link resolveTokenPool}), and floor-match encoders ({@link resolveEncoder}).
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
} from '../../errors.ts'
import BURN_MINT_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/burn-mint-token-pool-and-proxy.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/lock-release-token-pool-and-proxy.ts'
import BURN_MINT_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V1_5_1_BYTECODE from '../artifacts/bytecode/V1_5_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_1_BYTECODE from '../artifacts/bytecode/V1_5_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V1_6_1_BYTECODE from '../artifacts/bytecode/V1_6_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_6_1_BYTECODE from '../artifacts/bytecode/V1_6_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'

/**
 * ABI families for pool resolution. The burn-* variants are interface-compatible for CCT
 * ops (identical `transferOwnership`, shared TokenPool surface), so they share the
 * `BurnMint` ABI; `LockRelease` (with its liquidity functions) is distinct.
 */
export const TOKEN_POOL_FAMILIES = ['BurnMint', 'LockRelease'] as const

/** An ABI family for pool resolution. */
export type TokenPoolFamily = (typeof TOKEN_POOL_FAMILIES)[number]

/**
 * Supported on-chain `typeAndVersion` pool types. The burn-* variants are interface-compatible
 * for CCT ops and share the `BurnMint` ABI (see {@link tokenPoolFamily}); `LockReleaseTokenPool`
 * is distinct. Unsupported values fail in {@link parseTokenPoolVersion}.
 */
export const TOKEN_POOL_TYPES = [
  'BurnMintTokenPool',
  'BurnFromMintTokenPool',
  'BurnWithFromMintTokenPool',
  'BurnToAddressTokenPool',
  'BurnMintWithLockReleaseFlagTokenPool',
  'LockReleaseTokenPool',
] as const

/** A supported EVM token-pool contract type. */
export type TokenPoolType = (typeof TOKEN_POOL_TYPES)[number]

/** Type guard for {@link TOKEN_POOL_TYPES}. */
export function isTokenPoolType(v: string): v is TokenPoolType {
  return (TOKEN_POOL_TYPES as readonly string[]).includes(v)
}

/**
 * Classifies a supported pool type into its ABI {@link TokenPoolFamily} by name: every burn-*
 * mint pool shares the `BurnMint` ABI (identical surface for CCT ops — including
 * `BurnMintWithLockReleaseFlagTokenPool`, hence the anchored `^Burn`), while `LockReleaseTokenPool`
 * has its own. {@link TOKEN_POOL_TYPES} is the gate, so only allowlisted, ABI-compatible names
 * reach here.
 */
export function tokenPoolFamily(type: TokenPoolType): TokenPoolFamily {
  return /^Burn/.test(type) ? 'BurnMint' : 'LockRelease'
}

/**
 * Known pool versions, low to high. Value order drives floor-match in
 * {@link resolveEncoder}.
 */
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
export function tokenPoolInterface(type: TokenPoolType, version: TokenPoolVersion): Interface {
  return TOKEN_POOL_INTERFACES[tokenPoolFamily(type)][version]
}

/** Pool types with vendored creation bytecode (deployable via `deployPool`); the burn-* variants
 * are resolve-only. */
export const DEPLOYABLE_POOL_TYPES = ['BurnMintTokenPool', 'LockReleaseTokenPool'] as const

/** A pool contract type that can be deployed. */
export type DeployablePoolType = (typeof DEPLOYABLE_POOL_TYPES)[number]

/** Versions with vendored creation bytecode; the `1.5.0` proxy variants are resolve-only. */
export const DEPLOYABLE_POOL_VERSIONS = [
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
  TokenPoolVersion.V2_0_0,
] as const

/** A pool version that can be deployed. */
export type DeployablePoolVersion = (typeof DEPLOYABLE_POOL_VERSIONS)[number]

/** Pool version deployed when a caller omits `version`. */
export const DEFAULT_POOL_VERSION = TokenPoolVersion.V2_0_0

/** Type guard for {@link DEPLOYABLE_POOL_VERSIONS}. */
export function isDeployablePoolVersion(v: string): v is DeployablePoolVersion {
  return (DEPLOYABLE_POOL_VERSIONS as readonly string[]).includes(v)
}

/** Cached creation bytecode per {@link TokenPoolFamily} and deployable version (from `artifacts/`). */
const POOL_BYTECODE: Record<TokenPoolFamily, Record<DeployablePoolVersion, `0x${string}`>> = {
  BurnMint: {
    [TokenPoolVersion.V1_5_1]: BURN_MINT_TOKEN_POOL_V1_5_1_BYTECODE,
    [TokenPoolVersion.V1_6_1]: BURN_MINT_TOKEN_POOL_V1_6_1_BYTECODE,
    [TokenPoolVersion.V2_0_0]: BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  },
  LockRelease: {
    [TokenPoolVersion.V1_5_1]: LOCK_RELEASE_TOKEN_POOL_V1_5_1_BYTECODE,
    [TokenPoolVersion.V1_6_1]: LOCK_RELEASE_TOKEN_POOL_V1_6_1_BYTECODE,
    [TokenPoolVersion.V2_0_0]: LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE,
  },
}

/** A pool deploy artifact: the cached constructor {@link Interface} + creation bytecode. */
export interface PoolArtifact {
  iface: Interface
  bytecode: `0x${string}`
}

/**
 * Returns the deploy artifact (constructor {@link Interface} + creation bytecode) for a
 * deployable pool `type` and `version`, selected by {@link TokenPoolFamily}.
 */
export function poolArtifact(
  type: DeployablePoolType,
  version: DeployablePoolVersion,
): PoolArtifact {
  return {
    iface: tokenPoolInterface(type, version),
    bytecode: POOL_BYTECODE[tokenPoolFamily(type)][version],
  }
}

/**
 * Reads `chain.typeAndVersion(poolAddress)`, narrows the result, and attaches the
 * pool {@link Interface}. Shared RPC boundary before versioned pool encoding.
 * @throws the same errors as {@link parseTokenPoolVersion}
 */
export async function resolveTokenPool(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ type: TokenPoolType; version: TokenPoolVersion; iface: Interface }> {
  const [contractType, version] = await chain.typeAndVersion(poolAddress)
  const pool = parseTokenPoolVersion({ address: poolAddress, contractType, version })
  return { ...pool, iface: tokenPoolInterface(pool.type, pool.version) }
}

/**
 * Returns the encoder registered at the greatest version less than or equal to
 * `version`. One entry per calldata change covers all higher versions via floor-match.
 * @throws {@link CCTOperationUnsupportedError} if nothing is registered at or below `version`
 */
export function resolveEncoder<F>(
  encoders: Partial<Record<TokenPoolVersion, F>>,
  version: TokenPoolVersion,
  op: string,
): F {
  const versions = Object.values(TokenPoolVersion)
  for (let i = versions.indexOf(version); i >= 0; i--) {
    const encoder = encoders[versions[i]!]
    if (encoder !== undefined) return encoder
  }
  throw new CCTOperationUnsupportedError(op, version)
}
