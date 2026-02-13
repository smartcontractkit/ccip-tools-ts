import type { CCIPErrorCode } from './codes.ts'
import { getDefaultRecovery } from './recovery.ts'

/** Options for CCIPError constructor. */
export interface CCIPErrorOptions {
  /** Original error (ES2022 cause). */
  cause?: Error
  /** Structured context (IDs, addresses). */
  context?: Record<string, unknown>
  /** True if retry may succeed. */
  isTransient?: boolean
  /** Retry delay in ms. */
  retryAfterMs?: number
  /** Recovery suggestion. */
  recovery?: string
}

/**
 * Base error class for CCIP SDK.
 *
 * @example
 * ```typescript
 * if (CCIPError.isCCIPError(error) && error.isTransient) {
 *   await sleep(error.retryAfterMs ?? 5000)
 * }
 * ```
 */
export class CCIPError extends Error {
  /** Brand for cross-module identification (dual package hazard). */
  readonly _isCCIPError = true as const
  /** Machine-readable error code. */
  readonly code: CCIPErrorCode
  /** Structured context (IDs, addresses). */
  readonly context: Record<string, unknown>
  /** True if retry may succeed. */
  readonly isTransient: boolean
  /** Retry delay in ms. */
  readonly retryAfterMs?: number
  /** Recovery suggestion. */
  readonly recovery?: string

  override readonly name: string = 'CCIPError'

  /**
   * Creates a CCIPError with code, message, and options.
   *
   * @param code - Machine-readable error code
   * @param message - Human-readable error message
   * @param options - Additional error options (cause, context, isTransient, etc.)
   */
  constructor(code: CCIPErrorCode, message: string, options?: CCIPErrorOptions) {
    super(message, { cause: options?.cause })
    Object.setPrototypeOf(this, new.target.prototype)

    this.code = code
    this.context = options?.context ?? {}
    this.isTransient = options?.isTransient ?? false
    this.retryAfterMs = options?.retryAfterMs
    this.recovery = options?.recovery ?? getDefaultRecovery(code)

    Error.captureStackTrace(this, this.constructor)
  }

  /**
   * Type guard for CCIPError.
   *
   * Prefer this over `instanceof` to handle the dual package hazard
   * when multiple versions of the SDK may be present.
   *
   * @param error - The error to check
   * @returns True if the error is a CCIPError instance
   */
  static isCCIPError(error: unknown): error is CCIPError {
    return (
      error instanceof CCIPError ||
      !!(error as { _isCCIPError?: boolean } | undefined)?._isCCIPError
    )
  }

  /**
   * Wraps an unknown caught value in a CCIPError.
   *
   * Useful for normalizing errors in catch blocks.
   *
   * @param error - The error to wrap
   * @param code - Optional error code (defaults to 'UNKNOWN')
   * @returns A CCIPError wrapping the original error
   */
  static from(error: unknown, code?: CCIPErrorCode): CCIPError {
    if (error instanceof CCIPError) return error
    if (error instanceof Error) {
      return new CCIPError(code ?? 'UNKNOWN', error.message, { cause: error })
    }
    return new CCIPError(code ?? 'UNKNOWN', String(error))
  }

  /**
   * Serializes the error for logging.
   *
   * Use this instead of `JSON.stringify(error)` directly, as Error properties
   * are non-enumerable and would be lost.
   *
   * @returns An object containing all error properties
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      isTransient: this.isTransient,
      retryAfterMs: this.retryAfterMs,
      recovery: this.recovery,
      stack: this.stack,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    }
  }
}
