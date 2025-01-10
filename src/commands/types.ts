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
export interface CCIPSupportedToken extends TokenMetadata {
  address: string
  pool: string
}

export interface PoolSupportCheck {
  token: string
  pool: string
  isSupported: boolean
  error: Error | null
}
