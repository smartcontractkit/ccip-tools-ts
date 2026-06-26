/**
 * Token operations command group.
 * Dispatches to subcommands: balance (default), deploy.
 */

import type { Argv } from 'yargs'

export const command = 'token'
export const describe =
  'Token operations (balance, deploy, create-multisig, transfer-mint-authority, grant-mint-burn-access, revoke-mint-burn-access, get-mint-burn-info)'

/**
 * Yargs builder for the token command group.
 * Loads subcommands from the `token/` directory.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with subcommands.
 */
export const builder = (yargs: Argv) =>
  yargs
    .commandDir('token', {
      extensions: [new URL(import.meta.url).pathname.split('.').pop()!],
      exclude: /\.test\.[tj]s$/,
    })
    .demandCommand(0)
