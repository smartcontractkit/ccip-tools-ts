/**
 * ManualExec Command Schema
 *
 * Defines the schema for the `ccip-cli manualExec` command.
 */

import { outputOptions, rpcOptions, walletOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const manualExecSchema: CommandSchema<'manualExec'> = {
  name: 'manualExec',
  description: 'Manually execute pending or failed CCIP messages',
  synopsis: 'ccip-cli manualExec <tx-hash> [options]',

  arguments: [
    {
      name: 'tx-hash',
      label: 'Transaction Hash',
      type: 'string',
      required: true,
      placeholder: '0x1234567890abcdef...',
      pattern: /^0x[a-fA-F0-9]{64}$/,
      description: 'Transaction hash of the original CCIP request',
    },
  ],

  options: [
    // Message Selection
    {
      type: 'number',
      name: 'log-index',
      label: 'Log Index',
      description: 'Select specific message by log index',
      group: 'message',
      placeholder: '0',
    },
    // Gas Options
    {
      type: 'number',
      name: 'gas-limit',
      alias: 'L',
      label: 'Gas Limit',
      description:
        'Override gas limit for receiver callback (0 = original). Alias: --compute-units',
      group: 'gas',
      placeholder: '500000',
    },
    {
      type: 'number',
      name: 'tokens-gas-limit',
      label: 'Tokens Gas Limit',
      description: 'Override gas limit for token pool releaseOrMint calls',
      group: 'gas',
      placeholder: '200000',
    },
    {
      type: 'number',
      name: 'estimate-gas-limit',
      label: 'Estimate Gas Limit',
      description: 'Estimate gas with margin % (e.g., 10 for +10%). Conflicts with --gas-limit.',
      group: 'gas',
      placeholder: '10',
    },
    // Solana Options
    {
      type: 'boolean',
      name: 'force-buffer',
      label: 'Force Buffer',
      description: 'Use buffer for large messages on Solana',
      group: 'solana',
    },
    {
      type: 'boolean',
      name: 'force-lookup-table',
      label: 'Force Lookup Table',
      description: 'Create lookup table for accounts on Solana',
      group: 'solana',
    },
    {
      type: 'boolean',
      name: 'clear-leftover-accounts',
      label: 'Clear Leftover Accounts',
      description: 'Clear buffers/tables from previous attempts',
      group: 'solana',
    },
    // Sui Options
    {
      type: 'array',
      name: 'receiver-object-ids',
      label: 'Receiver Object IDs',
      description: 'Receiver object IDs for Sui execution',
      group: 'sui',
      placeholder: '0xabc...',
      itemType: 'string',
    },
    // Queue Options
    {
      type: 'boolean',
      name: 'sender-queue',
      label: 'Sender Queue',
      description: 'Execute all pending messages from the same sender',
      group: 'queue',
      defaultValue: false,
    },
    {
      type: 'boolean',
      name: 'exec-failed',
      label: 'Include Failed',
      description: 'Include failed messages in queue execution. Requires --sender-queue.',
      group: 'queue',
    },
    ...walletOptions,
    ...rpcOptions,
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Execute pending message',
      command: 'ccip-cli manualExec 0x1234... --wallet ledger',
    },
    {
      title: 'Override gas limit',
      command: 'ccip-cli manualExec 0x1234... --gas-limit 500000',
    },
    {
      title: 'Solana with buffer',
      command: 'ccip-cli manualExec 0x1234... --force-buffer --clear-leftover-accounts',
    },
    {
      title: 'Sui with receiver objects',
      command: 'ccip-cli manualExec 0x1234... --receiver-object-ids 0xabc... 0xdef...',
    },
  ],
}
