/**
 * Centralized chain deployment loader.
 * Import this file to register all chain deployments with ccip-config.
 *
 * Usage:
 *   import './config-loader.ts'
 *
 * This enables features like:
 *   - Auto-detecting router addresses from chain selector
 *   - Looking up display names for chains
 */

// EVM chains
import '@chainlink/ccip-config/src/chains/evm/mainnet.ts'
import '@chainlink/ccip-config/src/chains/evm/testnet.ts'

// Non-EVM chains
import '@chainlink/ccip-config/src/chains/solana/index.ts'
import '@chainlink/ccip-config/src/chains/aptos/index.ts'
import '@chainlink/ccip-config/src/chains/sui/index.ts'
import '@chainlink/ccip-config/src/chains/ton/index.ts'

export {}
