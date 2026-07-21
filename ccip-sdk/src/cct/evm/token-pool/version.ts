/**
 * EVM token-pool version axis for CCT: resolve on-chain pool metadata and ABI
 * ({@link resolveTokenPool}), and floor-match encoders ({@link resolveEncoder}).
 *
 * @packageDocumentation
 */

import type { InterfaceAbi } from 'ethers'

import LockReleaseTokenPool_1_5 from '../../../evm/abi/LockReleaseTokenPool_1_5.ts'
import LockReleaseTokenPool_1_5_1 from '../../../evm/abi/LockReleaseTokenPool_1_5_1.ts'
import LockReleaseTokenPool_1_6_1 from '../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0 from '../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../evm/index.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
} from '../../errors.ts'

/** Supported pool contract types; unsupported values fail in {@link parseTokenPoolVersion}. */
export const TOKEN_POOL_TYPES = ['BurnMintTokenPool', 'LockReleaseTokenPool'] as const

/** A supported EVM token-pool contract type. */
export type TokenPoolType = (typeof TOKEN_POOL_TYPES)[number]

/** Type guard for {@link TOKEN_POOL_TYPES}. */
export function isTokenPoolType(v: string): v is TokenPoolType {
  return TOKEN_POOL_TYPES.some((known) => known === v)
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
    throw new CCTContractTypeInvalidError(
      address,
      'BurnMintTokenPool or LockReleaseTokenPool',
      contractType,
    )
  if (!isTokenPoolVersion(version))
    throw new CCTContractVersionUnsupportedError(contractType, version, { context: { address } })
  return { type: contractType, version }
}

/** Vendored pool ABIs keyed by {@link TokenPoolVersion}.
 * TODO: split per type once BurnMint ABIs are imported from `@chainlink/contracts-ccip`  */
export const TOKEN_POOL_ABIS: Record<TokenPoolVersion, InterfaceAbi> = {
  [TokenPoolVersion.V1_5_0]: LockReleaseTokenPool_1_5,
  [TokenPoolVersion.V1_5_1]: LockReleaseTokenPool_1_5_1,
  [TokenPoolVersion.V1_6_1]: LockReleaseTokenPool_1_6_1,
  [TokenPoolVersion.V2_0_0]: TokenPool_2_0,
}

/**
 * Returns the pool ABI for `type` and `version`. `type` keeps call sites stable
 * for a future per-type split; today only `version` selects the ABI. Never throws
 * when `version` came from {@link parseTokenPoolVersion}.
 */
export function tokenPoolAbi(_type: TokenPoolType, version: TokenPoolVersion): InterfaceAbi {
  return TOKEN_POOL_ABIS[version]
}

/**
 * Reads `chain.typeAndVersion(poolAddress)`, narrows the result, and attaches the
 * pool ABI. Shared RPC boundary before versioned pool encoding.
 * @throws the same errors as {@link parseTokenPoolVersion}
 */
export async function resolveTokenPool(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ type: TokenPoolType; version: TokenPoolVersion; abi: InterfaceAbi }> {
  const [contractType, version] = await chain.typeAndVersion(poolAddress)
  const pool = parseTokenPoolVersion({ address: poolAddress, contractType, version })
  return { ...pool, abi: tokenPoolAbi(pool.type, pool.version) }
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
