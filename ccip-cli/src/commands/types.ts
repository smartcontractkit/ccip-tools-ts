import type { Logger } from '@chainlink/ccip-sdk/src/types.js'

/** Output format options for CLI commands. */
export const Format = {
  log: 'log',
  pretty: 'pretty',
  json: 'json',
} as const
/** Type for output format selection. */
export type Format = (typeof Format)[keyof typeof Format]

/**
 * Command context
 */
export type Ctx = {
  destroy$: AbortSignal
  logger: Logger & {
    table: (tabularData: unknown, properties?: readonly string[]) => void
    log: (...args: unknown[]) => void
  }
  verbose?: boolean
}
