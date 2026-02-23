/**
 * Chain types and configurations for CCIP
 * Aligned with SDK's ChainFamily for consistency
 */

export const ChainType = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
} as const

/** Chain type values derived from ChainType const object */
export type ChainType = (typeof ChainType)[keyof typeof ChainType]

/**
 * Chain display configuration
 * Single source of truth for chain styling
 */
export interface ChainConfig {
  readonly label: string
  readonly icon: string // Path to SVG in assets/chains/
}

/**
 * Chain configurations using copied SVG icons from main docs
 */
export const CHAIN_CONFIGS: Readonly<Record<ChainType, ChainConfig>> = {
  evm: { label: 'EVM', icon: '/assets/chains/ethereum.svg' },
  solana: { label: 'Solana', icon: '/assets/chains/solana.svg' },
  aptos: { label: 'Aptos', icon: '/assets/chains/aptos.svg' },
  sui: { label: 'Sui', icon: '/assets/chains/sui.svg' },
} as const

/**
 * Chain families currently supported by CCIP Tools
 * Single source of truth - update here when adding new chain support
 */
export const SUPPORTED_CHAIN_FAMILIES: readonly ChainType[] = [
  ChainType.EVM,
  ChainType.Solana,
  ChainType.Aptos,
] as const
