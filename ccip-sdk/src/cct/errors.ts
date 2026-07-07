/**
 * CCT-specific error classes for write operations (validate → encode → submit).
 * Shared CCIP errors (`CCIPWalletInvalidError`, etc.) live in `../errors/`.
 *
 * @packageDocumentation
 */

import { type CCIPErrorOptions, CCIPError, CCIPErrorCode } from '../errors/index.ts'

// Parameter validation

/** Thrown before any RPC when operation params fail validation. Permanent. */
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
 * Thrown when a CCT write fails before broadcast or the transaction reverts after mining.
 * Pre-broadcast failures (signing/RPC) may set `isTransient: true` for network errors;
 * on-chain reverts are permanent. Reverts include `context.txHash`.
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

// Token-pool version dispatch

/**
 * Thrown when the contract at an address is not a supported token-pool type
 * (BurnMint or LockRelease).
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

/** Thrown when a token pool reports a version string the SDK does not recognize. Permanent. */
export class CCTTokenPoolVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCTTokenPoolVersionUnsupportedError'
  /** Creates a token-pool-version-unsupported error. */
  constructor(version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_TOKEN_POOL_VERSION_UNSUPPORTED,
      `Unsupported token pool version: ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, version },
      },
    )
  }
}

/**
 * Thrown when no implementation is registered for an operation at or below the pool's
 * version (floor-match miss). Permanent for that pool version.
 */
export class CCTOperationUnsupportedError extends CCIPError {
  override readonly name = 'CCTOperationUnsupportedError'
  /** Creates an operation-unsupported error. */
  constructor(operation: string, version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_OPERATION_UNSUPPORTED,
      `${operation} is not supported at token-pool version ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, operation, version },
      },
    )
  }
}
