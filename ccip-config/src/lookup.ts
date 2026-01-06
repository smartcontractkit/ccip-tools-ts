import {
  CCIPDeploymentNotFoundByNameError,
  CCIPDeploymentNotFoundError,
  CCIPRouterNotFoundError,
} from './errors.ts'
import { getDeployment, getDeploymentByNameFromRegistry } from './registry.ts'
import type { CCIPEnabledDeployment, ChainDeployment } from './types.ts'

/**
 * Get deployment by chain selector, throw if not found.
 *
 * @param chainSelector - CCIP chain selector
 * @returns ChainDeployment
 * @throws CCIPDeploymentNotFoundError if not found
 */
export function requireDeployment(chainSelector: bigint): ChainDeployment {
  const deployment = getDeployment(chainSelector)
  if (!deployment) {
    throw new CCIPDeploymentNotFoundError(chainSelector)
  }
  return deployment
}

/**
 * Get router address for a chain.
 *
 * @param chainSelector - CCIP chain selector
 * @returns Router address if found and configured, undefined otherwise
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { getRouter } from '@chainlink/ccip-config'
 *
 * const router = getRouter(5009297550715157269n)
 * // '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
 * ```
 */
export function getRouter(chainSelector: bigint): string | undefined {
  return getDeployment(chainSelector)?.router
}

/**
 * Get router address, throw if not found or not configured.
 *
 * @param chainSelector - CCIP chain selector
 * @returns Router address
 * @throws CCIPDeploymentNotFoundError if chain doesn't exist
 * @throws CCIPRouterNotFoundError if chain has no router
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { requireRouter } from '@chainlink/ccip-config'
 *
 * const router = requireRouter(5009297550715157269n)
 * // '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
 * ```
 */
export function requireRouter(chainSelector: bigint): string {
  const deployment = requireDeployment(chainSelector)
  if (!deployment.router) {
    throw new CCIPRouterNotFoundError(chainSelector, deployment.displayName)
  }
  return deployment.router
}

/**
 * Get display name for a chain.
 *
 * @param chainSelector - CCIP chain selector
 * @returns Display name if found, undefined otherwise
 */
export function getDisplayName(chainSelector: bigint): string | undefined {
  return getDeployment(chainSelector)?.displayName
}

/**
 * Type guard to check if a deployment has CCIP router configured.
 * Narrows ChainDeployment to CCIPEnabledDeployment.
 *
 * @param deployment - Chain deployment to check
 * @returns true if deployment has router configured
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { getDeployment, isCCIPEnabled } from '@chainlink/ccip-config'
 *
 * const deployment = getDeployment(5009297550715157269n)
 * if (deployment && isCCIPEnabled(deployment)) {
 *   // deployment is narrowed to CCIPEnabledDeployment
 *   console.log(deployment.router) // string, not string | undefined
 * }
 * ```
 */
export function isCCIPEnabled(deployment: ChainDeployment): deployment is CCIPEnabledDeployment {
  return deployment.router !== undefined
}

/**
 * Check if a chain has CCIP router configured by selector.
 *
 * @param chainSelector - CCIP chain selector
 * @returns true if chain exists and has router configured
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { isCCIPEnabledBySelector } from '@chainlink/ccip-config'
 *
 * if (isCCIPEnabledBySelector(5009297550715157269n)) {
 *   // Safe to send CCIP messages
 * }
 * ```
 */
export function isCCIPEnabledBySelector(chainSelector: bigint): boolean {
  const deployment = getDeployment(chainSelector)
  return deployment !== undefined && deployment.router !== undefined
}

/**
 * Find deployment by SDK canonical name (O(1) lookup).
 *
 * @param name - SDK canonical name (e.g., "ethereum-mainnet")
 * @returns Deployment if found, undefined otherwise
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { getDeploymentByName } from '@chainlink/ccip-config'
 *
 * const deployment = getDeploymentByName('ethereum-mainnet')
 * // { chainSelector: 5009297550715157269n, name: 'ethereum-mainnet', displayName: 'Ethereum', router: '0x...' }
 * ```
 */
export function getDeploymentByName(name: string): ChainDeployment | undefined {
  return getDeploymentByNameFromRegistry(name)
}

/**
 * Get router address by SDK canonical name (O(1) lookup).
 *
 * @param name - SDK canonical name (e.g., "ethereum-mainnet")
 * @returns Router address if found and configured, undefined otherwise
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { getRouterByName } from '@chainlink/ccip-config'
 *
 * const router = getRouterByName('ethereum-mainnet')
 * // '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
 * ```
 */
export function getRouterByName(name: string): string | undefined {
  return getDeploymentByNameFromRegistry(name)?.router
}

/**
 * Get deployment by SDK canonical name, throw if not found (O(1) lookup).
 *
 * @param name - SDK canonical name (e.g., "ethereum-mainnet")
 * @returns ChainDeployment
 * @throws CCIPDeploymentNotFoundByNameError if not found
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { requireDeploymentByName } from '@chainlink/ccip-config'
 *
 * const deployment = requireDeploymentByName('ethereum-mainnet')
 * // { chainSelector: 5009297550715157269n, name: 'ethereum-mainnet', displayName: 'Ethereum', router: '0x...' }
 * ```
 */
export function requireDeploymentByName(name: string): ChainDeployment {
  const deployment = getDeploymentByNameFromRegistry(name)
  if (!deployment) {
    throw new CCIPDeploymentNotFoundByNameError(name)
  }
  return deployment
}

/**
 * Get router address by SDK canonical name, throw if not found or not configured.
 *
 * @param name - SDK canonical name (e.g., "ethereum-mainnet")
 * @returns Router address
 * @throws CCIPDeploymentNotFoundByNameError if chain doesn't exist
 * @throws CCIPRouterNotFoundError if chain has no router
 *
 * @example
 * ```typescript
 * import '@chainlink/ccip-config/chains/evm/mainnet'
 * import { requireRouterByName } from '@chainlink/ccip-config'
 *
 * const router = requireRouterByName('ethereum-mainnet')
 * // '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
 * ```
 */
export function requireRouterByName(name: string): string {
  const deployment = requireDeploymentByName(name)
  if (!deployment.router) {
    throw new CCIPRouterNotFoundError(deployment.chainSelector, deployment.displayName)
  }
  return deployment.router
}
