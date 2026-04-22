import type { Logger } from '@chainlink/ccip-sdk/src/index.ts'

/** Output format options for CLI commands. */
export const Format = {
  log: 'log',
  pretty: 'pretty',
  json: 'json',
} as const
/** Type for output format selection. */
export type Format = (typeof Format)[keyof typeof Format]

/**
 * Command context.
 *
 * Output architecture (inspired by Vercel CLI, Google Workspace CLI, GitHub CLI):
 * - `output` writes to stdout — the ONLY way to write to stdout. Used for data (JSON, tables, log-format).
 * - `logger` writes to stderr — used for status, progress, warnings, errors, debug.
 */
export type Ctx = {
  destroy$: Promise<unknown>
  /** Write data to stdout. */
  output: {
    /** Console.log to stdout — supports multiple args with util.inspect formatting. */
    write: (...args: unknown[]) => void
    /** Console.table to stdout — formatted key-value tables. */
    table: (tabularData: unknown, properties?: string[]) => void
  }
  /** Logger — always writes to stderr. */
  logger: Logger
  verbose?: boolean
}
