/**
 * Pool operations command group.
 * Dispatches to subcommands: deploy.
 */

import type { Argv } from 'yargs'

export const command = 'pool'
export const describe =
  'Pool operations (deploy, apply-chain-updates, append-remote-pool-addresses, remove-remote-pool-addresses, delete-chain-config, get-config, set-rate-limiter-config, set-rate-limit-admin, transfer-ownership, accept-ownership, execute-ownership-transfer)'

/**
 * Yargs builder for the pool command group.
 * Loads subcommands from the `pool/` directory.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with subcommands.
 */
export const builder = (yargs: Argv) =>
  yargs
    .commandDir('pool', {
      extensions: [new URL(import.meta.url).pathname.split('.').pop()!],
      exclude: /\.test\.[tj]s$/,
    })
    .demandCommand(1)
