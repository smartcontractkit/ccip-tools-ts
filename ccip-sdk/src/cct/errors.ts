/**
 * CCT-specific error classes for write operations (validate → encode → submit).
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
 * Thrown when a CCT write fails before broadcast or the transaction reverts after mining.
 * Pre-broadcast failures (signing/RPC) may set `isTransient: true` for network errors;
 * on-chain reverts are permanent. Reverts include `context.txHash`.
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
