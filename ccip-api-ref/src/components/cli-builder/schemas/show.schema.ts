/**
 * Show Command Schema
 *
 * Defines the schema for the `ccip-cli show` command.
 */

import { outputOptions, rpcOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const showSchema: CommandSchema<'show'> = {
  name: 'show',
  description: 'Display details of a CCIP request',
  synopsis: 'ccip-cli show <tx-hash-or-id> [options]',

  arguments: [
    {
      name: 'tx-hash-or-id',
      label: 'Transaction Hash or Message ID',
      type: 'string',
      required: true,
      placeholder: '0x1234567890abcdef...',
      description: 'Transaction hash (EVM hex or Solana Base58) or CCIP message ID (32-byte hex)',
    },
  ],

  options: [
    {
      type: 'number',
      name: 'log-index',
      label: 'Log Index',
      description:
        'Pre-select a message request by log index (when multiple CCIP messages exist in one transaction)',
      group: 'output',
      placeholder: '0',
    },
    {
      type: 'boolean',
      name: 'wait',
      label: 'Wait for Execution',
      description: 'Wait for finality, commit, and first execution before returning',
      group: 'output',
    },
    ...rpcOptions,
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Show message details',
      command: 'ccip-cli show 0x1234567890abcdef...',
    },
    {
      title: 'Wait for execution',
      command: 'ccip-cli show 0x1234... --wait',
    },
    {
      title: 'Select specific message by log index',
      command: 'ccip-cli show 0x1234... --log-index 2',
    },
    {
      title: 'JSON output for scripting',
      command: 'ccip-cli show 0x1234... --format json',
    },
  ],
}
