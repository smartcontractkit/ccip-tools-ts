/**
 * Chain types and configurations for CCIP
 * Aligned with SDK's ChainFamily for consistency
 */

export const ChainType = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
  TON: 'ton',
  Canton: 'canton',
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
  ton: { label: 'TON', icon: '/assets/chains/ton.svg' },
  canton: { label: 'Canton', icon: '/assets/chains/canton.svg' },
} as const

/**
 * Chain families with full SDK/CLI support
 * Single source of truth - update here when adding new chain support
 */
export const SUPPORTED_CHAIN_FAMILIES: readonly ChainType[] = [
  ChainType.EVM,
  ChainType.Solana,
  ChainType.Aptos,
  ChainType.TON,
  ChainType.Canton,
] as const

/**
 * Chain families with partial support (send and/or manual exec only)
 */
export const PARTIAL_CHAIN_FAMILIES: readonly ChainType[] = [ChainType.Sui] as const

/**
 * All documented chain families
 * Excludes Sui for now.
 */
export const ALL_CHAIN_FAMILIES: readonly ChainType[] = [...SUPPORTED_CHAIN_FAMILIES] as const

/**
 * Chain families supported by the send and manual-exec CLI commands
 */
export const SEND_COMMAND_CHAIN_FAMILIES: readonly ChainType[] = [
  ...SUPPORTED_CHAIN_FAMILIES,
  ChainType.Canton,
] as const
