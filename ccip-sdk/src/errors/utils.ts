import { CCIPError } from './CCIPError.ts'
import type { CCIPErrorCode } from './codes.ts'

/** Returns retry delay in ms, or null if permanent. */
export function getRetryDelay(error: CCIPError): number | null {
  if (!error.isTransient) return null
  return error.retryAfterMs ?? getDefaultRetryDelay(error.code)
}

function getDefaultRetryDelay(code: CCIPErrorCode): number {
  switch (code) {
    case 'BLOCK_NOT_FOUND':
      return 12000
    case 'MESSAGE_ID_NOT_FOUND':
      return 30000
    case 'COMMIT_NOT_FOUND':
      return 60000
    case 'HTTP_ERROR':
      return 5000
    case 'USDC_ATTESTATION_FAILED':
    case 'LBTC_ATTESTATION_ERROR':
      return 30000
    default:
      return 5000
  }
}

/** Returns true if error is transient and should be retried. */
export function shouldRetry(error: unknown): boolean {
  if (error instanceof CCIPError) {
    return error.isTransient
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('network') ||
      msg.includes('rate limit')
    )
  }
  return false
}

/** Format error for structured logging. */
export function formatErrorForLogging(error: CCIPError): Record<string, unknown> {
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    isTransient: error.isTransient,
    context: error.context,
    recovery: error.recovery,
    stack: error.stack,
    cause:
      error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message }
        : error.cause,
  }
}

/** Assert condition or throw CCIPError. */
export function assert(
  condition: unknown,
  code: CCIPErrorCode,
  message: string,
  context?: Record<string, unknown>,
): asserts condition {
  if (!condition) {
    throw new CCIPError(code, message, { context, isTransient: false })
  }
}
