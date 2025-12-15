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
      type: 'select',
      name: 'status',
      label: 'Status Filter',
      description: 'Filter by message status',
      group: 'output',
      options: [
        { value: '', label: 'All statuses' },
        { value: 'pending', label: 'Pending' },
        { value: 'committed', label: 'Committed' },
        { value: 'executed', label: 'Executed' },
        { value: 'failed', label: 'Failed' },
      ],
    },
    {
      type: 'boolean',
      name: 'wait',
      alias: 'w',
      label: 'Wait for Execution',
      description: 'Wait and poll until message is executed',
      group: 'output',
    },
    {
      type: 'string',
      name: 'poll-interval',
      label: 'Poll Interval',
      description: 'Polling interval in seconds when --wait is used',
      group: 'output',
      placeholder: '10',
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
      command: 'ccip-cli show 0x1234... --wait --poll-interval 5',
    },
    {
      title: 'JSON output for scripting',
      command: 'ccip-cli show 0x1234... --format json',
    },
  ],
}
