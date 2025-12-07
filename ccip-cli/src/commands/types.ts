/** Output format options for CLI commands. */
export const Format = {
  log: 'log',
  pretty: 'pretty',
  json: 'json',
} as const
/** Type for output format selection. */
export type Format = (typeof Format)[keyof typeof Format]
