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
import '@chainlink/ccip-config/chains/evm/mainnet'
import '@chainlink/ccip-config/chains/evm/testnet'

// Non-EVM chains
import '@chainlink/ccip-config/chains/solana'
import '@chainlink/ccip-config/chains/aptos'
import '@chainlink/ccip-config/chains/sui'
import '@chainlink/ccip-config/chains/ton'

export {}
