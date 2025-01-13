import type { TypedContract } from 'ethers-abitype'
import type { CCIPContractTypeTokenPool, CCIPTokenPoolsVersion, CCIP_ABIs } from '../lib/types.js'

export enum Format {
  log = 'log',
  pretty = 'pretty',
  json = 'json',
}

// Extended token info with pool details for CCIP
export interface CCIPSupportedToken {
  name: string
  symbol: string
  decimals: number
  address: string
  pool: string
  poolDetails?: TokenPoolDetails
}

export interface TokenDetailsError {
  token: string
  error: Error
}

// First, let's add the necessary types
export interface TokenBucket {
  tokens: bigint
  lastUpdated: number
  isEnabled: boolean
  capacity: bigint
  rate: bigint
}

export interface TokenPoolDetails {
  remoteToken: string
  remotePools: string[]
  outboundRateLimiter: TokenBucket
  inboundRateLimiter: TokenBucket
  isCustomPool?: boolean
  type: CCIPContractTypeTokenPool
  version: CCIPTokenPoolsVersion
}

// Token processing types
export type TokenChunk = readonly string[]

export type TokenDetailsResult =
  | { success: CCIPSupportedToken; error: null }
  | { success: null; error: TokenDetailsError }

/**
 * Version-aware token pool contract wrapper
 */
export interface VersionedTokenPool {
  type: CCIPContractTypeTokenPool
  version: CCIPTokenPoolsVersion
  contract: TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeTokenPool][CCIPTokenPoolsVersion]>
  isCustomPool?: boolean
}
