import { networkInfo } from '@chainlink/ccip-sdk/src/index.ts'

import { CCIPValidationError } from './errors.ts'
import type { CCIPEnabledDeployment, ChainDeployment, ChainDeploymentInput } from './types.ts'

/**
 * Logger interface for logging messages (compatible with console).
 * Matches the Logger interface from ccip-sdk for consistency.
 */
export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Default logger that uses console.
 * Can be replaced via setLogger() for custom logging behavior.
 */
const defaultLogger: Logger = console

let logger: Logger = defaultLogger

/**
 * Set a custom logger for the registry.
 * Use this to integrate with your application's logging system or to suppress warnings.
 *
 * @param customLogger - Logger implementation (compatible with console)
 *
 * @example
 * ```typescript
 * import { setLogger } from '@chainlink/ccip-config'
 *
 * // Use custom logger
 * setLogger(myLogger)
 *
 * // Suppress all logging (silent mode)
 * setLogger({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} })
 * ```
 */
export function setLogger(customLogger: Logger): void {
  logger = customLogger
}

/**
 * Reset logger to default (console).
 * Useful for testing cleanup.
 *
 * @internal
 */
export function resetLogger(): void {
  logger = defaultLogger
}

/**
 * Registry interface for chain deployments.
 * Provides methods to register, retrieve, and query chain deployment data.
 */
export interface Registry {
  /** Register a chain deployment (name is auto-populated from SDK) */
  register(input: ChainDeploymentInput): void
  /** Get deployment by chain selector */
  get(chainSelector: bigint): ChainDeployment | undefined
  /** Get deployment by SDK canonical name (case-sensitive, O(1) lookup) */
  getByName(name: string): ChainDeployment | undefined
  /** Get router address by chain selector */
  getRouter(chainSelector: bigint): string | undefined
  /** Get all registered deployments (returns frozen array) */
  getAll(): readonly ChainDeployment[]
  /** Get only CCIP-enabled deployments (with router addresses, returns frozen array) */
  getCCIPEnabled(): readonly CCIPEnabledDeployment[]
  /** Get count of CCIP-enabled chains (O(1)) */
  getCCIPEnabledCount(): number
  /** Clear all deployments */
  clear(): void
}

/**
 * Validate input data and resolve SDK canonical name.
 * @returns ChainDeployment with name populated from SDK
 * @throws CCIPValidationError if validation fails or chain not in SDK
 */
function validateAndResolve(input: ChainDeploymentInput): ChainDeployment {
  if (input.chainSelector <= 0n) {
    throw new CCIPValidationError(`Invalid chainSelector: ${input.chainSelector}`)
  }
  if (!input.displayName || input.displayName.trim() === '') {
    throw new CCIPValidationError(`Invalid displayName for chain selector ${input.chainSelector}`)
  }
  if (input.router !== undefined) {
    if (typeof input.router !== 'string' || input.router.length === 0) {
      throw new CCIPValidationError(`Invalid router for ${input.displayName}`)
    }
  }

  try {
    const sdkInfo = networkInfo(input.chainSelector)
    return {
      chainSelector: input.chainSelector,
      name: sdkInfo.name, // Auto-populated from SDK
      displayName: input.displayName,
      router: input.router,
    }
  } catch {
    throw new CCIPValidationError(
      `Chain selector ${input.chainSelector} not found in SDK. ` +
        `Ensure the chain is registered in ccip-sdk first.`,
    )
  }
}

/**
 * Options for creating a registry instance.
 */
export interface RegistryOptions {
  /**
   * Custom logger for this registry instance.
   * If not provided, uses the global logger set via setLogger().
   */
  logger?: Logger
  /**
   * Skip SDK validation (for testing only).
   * @internal
   */
  skipValidation?: boolean
}

/**
 * Create an isolated registry instance.
 *
 * Use for testing or when multiple independent registries are needed.
 * Each registry maintains its own state and doesn't affect others.
 *
 * The `name` field is automatically populated from the SDK's `networkInfo()`.
 *
 * @param options - Optional configuration including per-registry logger
 *
 * @example
 * ```typescript
 * const registry = createRegistry()
 * registry.register({
 *   chainSelector: 5009297550715157269n,
 *   displayName: 'Ethereum',
 *   router: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
 * })
 * // Name is auto-populated from SDK: 'ethereum-mainnet'
 * const deployment = registry.getByName('ethereum-mainnet')
 * ```
 */
export function createRegistry(options?: RegistryOptions): Registry {
  const getLogger = (): Logger => options?.logger ?? logger
  const deployments = new Map<bigint, ChainDeployment>()
  const ccipEnabledSelectors = new Set<bigint>()
  const nameIndex = new Map<string, bigint>() // SDK canonical name -> chainSelector
  let cache: readonly ChainDeployment[] | null = null
  let ccipEnabledCache: readonly CCIPEnabledDeployment[] | null = null

  return {
    register(input: ChainDeploymentInput): void {
      let deployment: ChainDeployment
      if (options?.skipValidation) {
        deployment = {
          chainSelector: input.chainSelector,
          name: `test-chain-${input.chainSelector}`,
          displayName: input.displayName,
          router: input.router,
        }
      } else {
        deployment = validateAndResolve(input)
      }

      cache = null
      ccipEnabledCache = null

      if (deployments.has(deployment.chainSelector)) {
        const existing = deployments.get(deployment.chainSelector)!
        getLogger().warn(
          `[ccip-config] Duplicate registration for chain selector ${deployment.chainSelector}. ` +
            `Existing: "${existing.name}", New: "${deployment.name}". Using new value.`,
        )
        nameIndex.delete(existing.name)
      }

      if (deployment.router) {
        ccipEnabledSelectors.add(deployment.chainSelector)
      } else {
        ccipEnabledSelectors.delete(deployment.chainSelector)
      }

      const existingSelector = nameIndex.get(deployment.name)
      if (existingSelector !== undefined && existingSelector !== deployment.chainSelector) {
        getLogger().warn(
          `[ccip-config] Name collision: "${deployment.name}" is already registered ` +
            `for chain selector ${existingSelector}. Overwriting with ${deployment.chainSelector}.`,
        )
      }

      nameIndex.set(deployment.name, deployment.chainSelector)
      deployments.set(deployment.chainSelector, Object.freeze({ ...deployment }))
    },

    get(chainSelector: bigint): ChainDeployment | undefined {
      return deployments.get(chainSelector)
    },

    getByName(name: string): ChainDeployment | undefined {
      const selector = nameIndex.get(name)
      return selector !== undefined ? deployments.get(selector) : undefined
    },

    getRouter(chainSelector: bigint): string | undefined {
      return deployments.get(chainSelector)?.router
    },

    getAll(): readonly ChainDeployment[] {
      if (cache === null) {
        cache = Object.freeze(Array.from(deployments.values()))
      }
      return cache
    },

    getCCIPEnabled(): readonly CCIPEnabledDeployment[] {
      if (ccipEnabledCache === null) {
        // Build cache from the ccipEnabledSelectors index for O(n) where n = enabled count
        const enabled: CCIPEnabledDeployment[] = []
        for (const selector of ccipEnabledSelectors) {
          const deployment = deployments.get(selector)
          if (deployment && deployment.router) {
            // Type assertion is safe here because the if-guard above ensures router exists,
            // and ccipEnabledSelectors only contains selectors with routers (maintained by register())
            enabled.push(deployment as CCIPEnabledDeployment)
          }
        }
        ccipEnabledCache = Object.freeze(enabled)
      }
      return ccipEnabledCache
    },

    getCCIPEnabledCount(): number {
      return ccipEnabledSelectors.size
    },

    clear(): void {
      deployments.clear()
      ccipEnabledSelectors.clear()
      nameIndex.clear()
      cache = null
      ccipEnabledCache = null
    },
  }
}

// Global registry (used by side-effect chain imports)
const globalRegistry = createRegistry()

/**
 * Register a chain deployment to the global registry.
 * Called internally by chain modules on import (side-effect).
 *
 * @internal
 */
export const registerDeployment = globalRegistry.register.bind(globalRegistry)

/**
 * Get all registered deployments from the global registry.
 * Returns a frozen array that cannot be mutated.
 *
 * @returns Frozen array of all registered chain deployments
 */
export const getAllDeployments = globalRegistry.getAll.bind(globalRegistry)

/**
 * Get deployment by chain selector from the global registry.
 *
 * @param chainSelector - CCIP chain selector
 * @returns ChainDeployment or undefined if not found
 */
export const getDeployment = globalRegistry.get.bind(globalRegistry)

/**
 * Get deployment by SDK canonical name from the global registry (O(1) lookup).
 *
 * @param name - SDK canonical name (e.g., "ethereum-mainnet")
 * @returns ChainDeployment or undefined if not found
 */
export const getDeploymentByNameFromRegistry = globalRegistry.getByName.bind(globalRegistry)

/**
 * Get CCIP-enabled deployments from the global registry.
 *
 * @returns Array of deployments with router addresses
 */
export const getCCIPEnabledDeployments = globalRegistry.getCCIPEnabled.bind(globalRegistry)

/**
 * Get count of CCIP-enabled chains in the global registry.
 *
 * @returns Number of chains with router addresses
 */
export const getCCIPEnabledCount = globalRegistry.getCCIPEnabledCount.bind(globalRegistry)

/**
 * Clear the global registry. For testing purposes only.
 *
 * @internal
 */
export const clearRegistry = globalRegistry.clear.bind(globalRegistry)
