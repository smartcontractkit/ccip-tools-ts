/**
 * Error codes for programmatic error handling.
 */
export const ErrorCodes = {
  DEPLOYMENT_NOT_FOUND: 'CCIP_DEPLOYMENT_NOT_FOUND',
  ROUTER_NOT_FOUND: 'CCIP_ROUTER_NOT_FOUND',
  VALIDATION_ERROR: 'CCIP_VALIDATION_ERROR',
} as const

/** Error code type for programmatic handling. */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Base error for ccip-config errors.
 */
export class CCIPConfigError extends Error {
  readonly code: ErrorCode
  readonly recovery?: string

  /**
   * Create a new CCIPConfigError.
   * @param code - Error code for programmatic handling
   * @param message - Error message
   * @param recovery - Recovery suggestion
   */
  constructor(code: ErrorCode, message: string, recovery?: string) {
    super(message)
    this.name = 'CCIPConfigError'
    this.code = code
    this.recovery = recovery
  }
}

/**
 * Thrown when deployment data is not found for a chain selector.
 */
export class CCIPDeploymentNotFoundError extends CCIPConfigError {
  readonly chainSelector: bigint

  /**
   * Create a new CCIPDeploymentNotFoundError.
   * @param chainSelector - The chain selector that was not found
   */
  constructor(chainSelector: bigint) {
    super(
      ErrorCodes.DEPLOYMENT_NOT_FOUND,
      `No deployment found for chain selector ${chainSelector}`,
      'Check if chain data is imported. Use: import "@chainlink/ccip-config/chains/evm/mainnet"',
    )
    this.name = 'CCIPDeploymentNotFoundError'
    this.chainSelector = chainSelector
  }
}

/**
 * Thrown when deployment data is not found for a display name.
 */
export class CCIPDeploymentNotFoundByNameError extends CCIPConfigError {
  readonly displayName: string

  /**
   * Create a new CCIPDeploymentNotFoundByNameError.
   * @param displayName - The display name that was not found
   */
  constructor(displayName: string) {
    super(
      ErrorCodes.DEPLOYMENT_NOT_FOUND,
      `No deployment found for chain name "${displayName}"`,
      'Check if chain data is imported. Use: import "@chainlink/ccip-config/chains/evm/mainnet"',
    )
    this.name = 'CCIPDeploymentNotFoundByNameError'
    this.displayName = displayName
  }
}

/**
 * Thrown when a chain exists but has no CCIP router deployed.
 */
export class CCIPRouterNotFoundError extends CCIPConfigError {
  readonly chainSelector: bigint
  readonly displayName: string

  /**
   * Create a new CCIPRouterNotFoundError.
   * @param chainSelector - The chain selector
   * @param displayName - The chain's display name
   */
  constructor(chainSelector: bigint, displayName: string) {
    super(
      ErrorCodes.ROUTER_NOT_FOUND,
      `No router configured for ${displayName} (${chainSelector})`,
      'This chain may not have CCIP deployed yet, or use a custom router address.',
    )
    this.name = 'CCIPRouterNotFoundError'
    this.chainSelector = chainSelector
    this.displayName = displayName
  }
}

/**
 * Thrown when deployment data fails validation.
 */
export class CCIPValidationError extends CCIPConfigError {
  /**
   * Create a new CCIPValidationError.
   * @param message - Error message describing the validation failure
   */
  constructor(message: string) {
    super(ErrorCodes.VALIDATION_ERROR, message)
    this.name = 'CCIPValidationError'
  }
}
