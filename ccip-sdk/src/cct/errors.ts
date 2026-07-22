/**
 * CCT-specific error classes.
 * Shared CCIP errors (`CCIPWalletInvalidError`, etc.) live in `../errors/`.
 *
 * @packageDocumentation
 */

import { type CCIPErrorOptions, CCIPError, CCIPErrorCode } from '../errors/index.ts'

// Parameter validation

/**
 * Thrown before any RPC when operation params fail validation. Permanent.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.setPool({ tokenAddress: 'not-an-address', poolAddress, address, wallet })
 * } catch (error) {
 *   if (error instanceof CCTParamsInvalidError) {
 *     console.log(`Invalid ${error.context.operation} param "${error.context.param}"`)
 *   }
 * }
 * ```
 */
export class CCTParamsInvalidError extends CCIPError {
  override readonly name = 'CCTParamsInvalidError'
  /** Creates a params-invalid error. */
  constructor(operation: string, param: string, reason: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_PARAMS_INVALID,
      `Invalid ${operation} parameter "${param}": ${reason}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, operation, param, reason },
      },
    )
  }
}

// Transaction submission

/**
 * Thrown when a CCT write fails before broadcast, the transaction reverts after mining,
 * or it mines without the expected effect (e.g. a deployment that produced no contract
 * address). Pre-broadcast failures (signing/RPC) may set `isTransient: true` for network
 * errors; reverts and post-mining anomalies are permanent and include `context.txHash`.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.setPool({ ...opts, wallet })
 * } catch (error) {
 *   if (error instanceof CCTTxFailedError) {
 *     console.log(`${error.context.operation} failed: ${error.context.reason}`)
 *   }
 * }
 * ```
 */
export class CCTTxFailedError extends CCIPError {
  override readonly name = 'CCTTxFailedError'
  /** Creates a tx-failed error. */
  constructor(operation: string, reason: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.CCT_TX_FAILED, `${operation} failed: ${reason}`, {
      ...options,
      isTransient: options?.isTransient ?? false,
      context: { ...options?.context, operation, reason },
    })
  }
}

/**
 * Thrown when a transaction was broadcast but not confirmed within the timeout.
 * Transient — it may still mine; check `context.txHash` before resubmitting.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.setPool({ ...opts, wallet })
 * } catch (error) {
 *   if (error instanceof CCTTxNotConfirmedError) {
 *     console.log(`Not confirmed (tx ${error.context.txHash}); retry in ${error.retryAfterMs}ms`)
 *   }
 * }
 * ```
 */
export class CCTTxNotConfirmedError extends CCIPError {
  override readonly name = 'CCTTxNotConfirmedError'
  /** Creates a tx-not-confirmed error. */
  constructor(operation: string, txHash: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_TX_NOT_CONFIRMED,
      `${operation} transaction not confirmed within timeout: ${txHash}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 5000,
        context: { ...options?.context, operation, txHash },
      },
    )
  }
}

// Contract version dispatch

/**
 * Thrown when the contract at an address is not of the expected type.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.transferOwnership({ poolAddress, newOwner, wallet })
 * } catch (error) {
 *   if (error instanceof CCTContractTypeInvalidError) {
 *     console.log(`Expected ${error.context.expected} at ${error.context.address}, got "${error.context.actual}"`)
 *   }
 * }
 * ```
 */
export class CCTContractTypeInvalidError extends CCIPError {
  override readonly name = 'CCTContractTypeInvalidError'
  /** Creates a contract-type-invalid error. */
  constructor(address: string, expected: string, actual: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CONTRACT_TYPE_INVALID,
      `Expected a ${expected} contract at ${address}, got "${actual}"`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, address, expected, actual },
      },
    )
  }
}

/**
 * Thrown when a contract reports a version string the SDK does not recognize. Permanent.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.transferOwnership({ poolAddress, newOwner, wallet })
 * } catch (error) {
 *   if (error instanceof CCTContractVersionUnsupportedError) {
 *     console.log(`Unsupported ${error.context.contractType} version: ${error.context.version}`)
 *   }
 * }
 * ```
 */
export class CCTContractVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCTContractVersionUnsupportedError'
  /** Creates a contract-version-unsupported error. */
  constructor(contractType: string, version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_CONTRACT_VERSION_UNSUPPORTED,
      `Unsupported ${contractType} version: ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, contractType, version },
      },
    )
  }
}

/**
 * Thrown when no implementation is registered for an operation at or below the contract's
 * version (floor-match miss). Permanent for that contract version.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.transferOwnership({ poolAddress, newOwner, wallet })
 * } catch (error) {
 *   if (error instanceof CCTOperationUnsupportedError) {
 *     console.log(`${error.context.operation} unsupported at version ${error.context.version}`)
 *   }
 * }
 * ```
 */
export class CCTOperationUnsupportedError extends CCIPError {
  override readonly name = 'CCTOperationUnsupportedError'
  /** Creates an operation-unsupported error. */
  constructor(operation: string, version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_OPERATION_UNSUPPORTED,
      `${operation} is not supported at contract version ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, operation, version },
      },
    )
  }
}

/** Thrown when a CCT token pool state account cannot be decoded. */
export class CCTTokenPoolStateDecodeError extends CCIPError {
  override readonly name = 'CCTTokenPoolStateDecodeError'
  /** Creates a token pool state decode error. */
  constructor(tokenPool: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_TOKEN_POOL_STATE_DECODE_FAILED,
      `Unable to decode token pool state at ${tokenPool}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, tokenPool },
      },
    )
  }
}
