/**
 * Input for registering a chain deployment.
 * The `name` field is auto-populated from SDK if not provided.
 */
export type ChainDeploymentInput = {
  /** CCIP chain selector (primary lookup key) */
  readonly chainSelector: bigint
  /** Human-readable display name for UI (e.g., "Ethereum", "Arbitrum One") */
  readonly displayName: string
  /** CCIP Router contract address (undefined if CCIP not deployed) */
  readonly router?: string
}

/**
 * Deployment configuration for a chain.
 * Contains deployment artifacts, NOT protocol constants.
 * Protocol data (chainId, family, isTestnet) lives in the SDK.
 */
export type ChainDeployment = {
  /** CCIP chain selector (primary lookup key) */
  readonly chainSelector: bigint
  /** SDK canonical name (e.g., "ethereum-mainnet") - used for name-based lookups */
  readonly name: string
  /** Human-readable display name for UI (e.g., "Ethereum", "Arbitrum One") */
  readonly displayName: string
  /** CCIP Router contract address (undefined if CCIP not deployed) */
  readonly router?: string
}

/**
 * ChainDeployment with guaranteed router address.
 * Use this type when you need to ensure the chain has CCIP support.
 */
export type CCIPEnabledDeployment = ChainDeployment & {
  readonly router: string
}
