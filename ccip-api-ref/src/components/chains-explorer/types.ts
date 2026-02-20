/**
 * Chains Explorer Types
 */

import type { ChainFamily } from '@chainlink/ccip-sdk'

export type { ChainFamily }

/** Network environment type. */
export type Environment = 'mainnet' | 'testnet'

/** Chain information from API. */
export interface ChainInfo {
  name: string
  chainId: number | string
  chainSelector: string
  family: ChainFamily
  displayName: string
  environment: Environment
  supported: boolean
}

/** Filter state for chains explorer. */
export interface ChainFilters {
  family: ChainFamily | 'all'
  environment: Environment | 'all'
  search: string
}

export const DEFAULT_FILTERS: ChainFilters = {
  family: 'all',
  environment: 'all',
  search: '',
}

/** Props for ChainsExplorer component. */
export interface ChainsExplorerProps {
  /** Initial search query from URL */
  initialSearch?: string
  /** Initial family filter from URL */
  initialFamily?: ChainFamily | 'all'
  /** Initial environment filter from URL */
  initialEnvironment?: Environment | 'all'
  /** Additional CSS class */
  className?: string
}
