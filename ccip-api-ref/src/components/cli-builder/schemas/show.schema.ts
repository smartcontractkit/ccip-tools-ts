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
      type: 'number',
      name: 'log-index',
      label: 'Log Index',
      description:
        'Pre-select a message request by log index (when multiple CCIP messages exist in one transaction)',
      group: 'output',
      placeholder: '0',
    },
    {
      type: 'string',
      name: 'id-from-source',
      label: 'Message ID from Source',
      description:
        'Search by messageId instead of txHash. Format: [onRamp@]sourceNetwork (onRamp address may be required for some chains)',
      group: 'output',
      placeholder: '0xOnRamp@ethereum-testnet-sepolia',
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
