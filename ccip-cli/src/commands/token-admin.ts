/**
 * Token admin operations command group.
 * Dispatches to subcommands: propose-admin, accept-admin, get-config.
 */

import type { Argv } from 'yargs'

export const command = 'token-admin'
export const describe =
  'Token admin operations (propose-admin, accept-admin, transfer-admin, get-config, create-token-alt, set-pool)'

/**
 * Yargs builder for the token-admin command group.
 * Loads subcommands from the `token-admin/` directory.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with subcommands.
 */
export const builder = (yargs: Argv) =>
  yargs
    .commandDir('token-admin', {
      extensions: [new URL(import.meta.url).pathname.split('.').pop()!],
      exclude: /\.test\.[tj]s$/,
    })
    .demandCommand(1)
