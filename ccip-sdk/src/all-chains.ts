/**
 * Entry point for importing all supported chain implementations.
 *
 * @packageDocumentation
 */

import { AptosChain } from './aptos/index.ts'
import { EVMChain } from './evm/index.ts'
import { SolanaChain } from './solana/index.ts'
import { SuiChain } from './sui/index.ts'
import { TONChain } from './ton/index.ts'
import { ChainFamily } from './types.ts'

/**
 * Map of all supported chain families to their implementations.
 * Importing this includes all chain dependencies in the bundle.
 */
export const allSupportedChains = {
  [ChainFamily.EVM]: EVMChain,
  [ChainFamily.Solana]: SolanaChain,
  [ChainFamily.Aptos]: AptosChain,
  [ChainFamily.Sui]: SuiChain,
  [ChainFamily.TON]: TONChain,
}

export { supportedChains } from './supported-chains.ts'
