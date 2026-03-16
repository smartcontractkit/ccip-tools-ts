/**
 * CCIP CLI Search Command
 *
 * Parent command for searching CCIP entities via the API.
 * Subcommands: messages, (intents - future)
 *
 * @example
 * ```bash
 * ccip-cli search messages --sender 0x...
 * ccip-cli search messages -s ethereum-mainnet -d arbitrum-mainnet
 * ccip-cli search messages --manual-exec-only -n 10
 * ```
 *
 * @packageDocumentation
 */

import type { Argv } from 'yargs'

export const command = 'search'
export const describe = 'Search CCIP entities via API'

/** Yargs builder for the search parent command. */
export const builder = (yargs: Argv) =>
  yargs
    .commandDir('search', {
      extensions: [new URL(import.meta.url).pathname.split('.').pop()!],
      exclude: /\.test\.[tj]s$/,
    })
    .demandCommand(1, 'Please specify a subcommand: messages')

/** No-op handler; subcommands handle execution. */
export const handler = () => {}
