/**
 * Entry point for importing all supported chain implementations; also registers every family in
 * `supportedChains` for a side-effect-only `import '\@chainlink/ccip-sdk/all'`.
 *
 * @packageDocumentation
 */

import { AptosChain } from './aptos/index.ts'
import { CantonChain } from './canton/index.ts'
import type { ChainStatic } from './chain.ts'
import { EVMChain } from './evm/index.ts'
import { ChainFamily } from './networks.ts'
import { SolanaChain } from './solana/index.ts'
import { SuiChain } from './sui/index.ts'
import { supportedChains } from './supported-chains.ts'
import { TONChain } from './ton/index.ts'

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
  [ChainFamily.Canton]: CantonChain,
}

// a top-level statement, so bundlers keep every class even for a side-effect-only import; `??=`
// keeps classes registered before
const registry: Partial<Record<ChainFamily, ChainStatic>> = supportedChains
for (const C of Object.values(allSupportedChains)) registry[C.family] ??= C

export { supportedChains } from './supported-chains.ts'
