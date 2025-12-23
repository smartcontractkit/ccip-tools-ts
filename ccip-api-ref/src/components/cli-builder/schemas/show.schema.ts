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
  synopsis: 'ccip-cli show <tx-hash> [options]',

  arguments: [
    {
      name: 'tx-hash',
      label: 'Transaction Hash',
      type: 'string',
      required: true,
      placeholder: '0x1234567890abcdef...',
      pattern: /^0x[a-fA-F0-9]{64}$/,
      description: 'Transaction hash containing the CCIP request',
    },
  ],

  options: [
    {
      type: 'string',
      name: 'log-index',
      label: 'Log Index',
      description: 'Select a specific message by log index when multiple exist in tx',
      group: 'message',
      placeholder: '0',
      pattern: /^\d+$/,
    },
    {
      type: 'string',
      name: 'id-from-source',
      label: 'Search by Message ID',
      description: 'Search by message ID instead of tx hash. Format: [onRamp@]sourceNetwork',
      group: 'message',
      placeholder: 'ethereum-testnet-sepolia',
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
      title: 'Select specific message',
      command: 'ccip-cli show 0x1234... --log-index 2',
    },
    {
      title: 'JSON output for scripting',
      command: 'ccip-cli show 0x1234... --format json',
    },
  ],
}
