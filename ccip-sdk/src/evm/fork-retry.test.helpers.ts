/**
 * Retry helpers for the fork tests. An anvil fork relays each uncached read to a
 * public testnet RPC, and that RPC can throttle or drop a request at any time.
 */
import { CCIPError, CCIPErrorCode, shouldRetry } from '../errors/index.ts'

/**
 * Upstream trouble seen through a fork: SDK transient errors, 429s, the empty
 * revert an anvil fork reports when its upstream rate-limits it, and the
 * `Fork Error: Transport(...)` it reports when its upstream RPC drops a connection.
 */
export const isTransientForkError = (err: unknown): boolean =>
  shouldRetry(err) ||
  /\b429\b|missing revert data|fork error|connection reset|econnreset|socket hang up/i.test(
    (err as Error | null)?.message ?? '',
  )

/** Delay before the first retry; each later retry waits this much longer. */
const RETRY_DELAY_MS = 2_000

/**
 * Runs `fn`. On a transient fork error, waits (2 s, then 4 s, ...) and runs it again,
 * up to `retries` times. Any other error, an assertion failure included, throws at once.
 */
export async function withForkRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await fn()
    } catch (err) {
      if (retry >= retries || !isTransientForkError(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (retry + 1)))
    }
  }
}

/**
 * Settles `promise` to the error it rejects with, so a test can assert on that error.
 * A transient fork error rethrows (for `withForkRetry`); a resolve fails the test.
 */
export const rejectionOf = (promise: Promise<unknown>, message: string): Promise<unknown> =>
  promise.then(
    () => {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, message)
    },
    (err: unknown) => {
      if (isTransientForkError(err)) throw err
      return err
    },
  )
