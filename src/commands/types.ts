export enum Format {
  log = 'log',
  pretty = 'pretty',
  json = 'json',
}

// Basic token metadata (standard ERC20 metadata)
export interface TokenMetadata {
  name: string
  symbol: string
  decimals: bigint
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

export interface PoolSupportCheck {
  token: string
  pool: string
  isSupported: boolean
  error: Error | null
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
}

export interface RemoteTokenConfig {
  remoteToken: string
  remotePools: string[]
}

// Token processing types
export type TokenChunk = readonly string[]

export type TokenDetailsResult =
  | { success: CCIPSupportedToken; error: null }
  | { success: null; error: TokenDetailsError }
