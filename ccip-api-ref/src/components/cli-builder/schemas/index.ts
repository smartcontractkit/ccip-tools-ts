/**
 * CLI Command Schemas
 *
 * Registry of all available command schemas.
 */

import { laneLatencySchema } from './lane-latency.schema.ts'
import { manualExecSchema } from './manual-exec.schema.ts'
import { parseSchema } from './parse.schema.ts'
import { sendSchema } from './send.schema.ts'
import { showSchema } from './show.schema.ts'
import { supportedTokensSchema } from './supported-tokens.schema.ts'
import { tokenSchema } from './token.schema.ts'
import type { CommandSchema } from '../types/index.ts'

export { laneLatencySchema } from './lane-latency.schema.ts'
export { manualExecSchema } from './manual-exec.schema.ts'
export { parseSchema } from './parse.schema.ts'
export { sendSchema } from './send.schema.ts'
export { showSchema } from './show.schema.ts'
export { supportedTokensSchema } from './supported-tokens.schema.ts'
export { tokenSchema } from './token.schema.ts'
export { outputOptions, rpcOptions, walletOptions } from './common.ts'

/** Schema registry - all available command schemas */
export const SCHEMA_REGISTRY: Record<string, CommandSchema> = {
  send: sendSchema,
  show: showSchema,
  manualExec: manualExecSchema,
  parse: parseSchema,
  getSupportedTokens: supportedTokensSchema,
  laneLatency: laneLatencySchema,
  token: tokenSchema,
}

/** Command names */
export type CommandName = keyof typeof SCHEMA_REGISTRY

/** Check if a schema exists for the given command name */
export function hasSchema(name: string): boolean {
  return name in SCHEMA_REGISTRY
}

/** Get schema by command name (returns undefined if not found) */
export function getSchema(name: string): CommandSchema | undefined {
  return SCHEMA_REGISTRY[name]
}

/** Get schema by command name with type safety */
export function getCommandSchema<T extends CommandName>(name: T): CommandSchema<T> {
  return SCHEMA_REGISTRY[name] as CommandSchema<T>
}
