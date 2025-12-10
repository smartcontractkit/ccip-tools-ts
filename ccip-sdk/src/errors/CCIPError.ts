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

  /** Creates CCIPError with code, message, and options. */
  constructor(code: CCIPErrorCode, message: string, options?: CCIPErrorOptions) {
    super(message, { cause: options?.cause })
    Object.setPrototypeOf(this, new.target.prototype)

    this.code = code
    this.context = options?.context ?? {}
    this.isTransient = options?.isTransient ?? false
    this.retryAfterMs = options?.retryAfterMs
    this.recovery = options?.recovery ?? getDefaultRecovery(code)

    Error.captureStackTrace?.(this, this.constructor)
  }

  /** Type guard. Prefer over instanceof (handles dual package hazard). */
  static isCCIPError(error: unknown): error is CCIPError {
    return error instanceof CCIPError || !!(error as { _isCCIPError?: boolean })?._isCCIPError
  }

  /** Wrap unknown catch value in CCIPError. */
  static from(error: unknown, code?: CCIPErrorCode): CCIPError {
    if (error instanceof CCIPError) return error
    if (error instanceof Error) {
      return new CCIPError(code ?? 'UNKNOWN', error.message, { cause: error })
    }
    return new CCIPError(code ?? 'UNKNOWN', String(error))
  }

  /** Serialize for logging (JSON.stringify loses non-enumerable props). */
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
