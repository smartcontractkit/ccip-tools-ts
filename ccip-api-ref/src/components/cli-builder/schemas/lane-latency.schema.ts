/**
 * LaneLatency Command Schema
 *
 * Defines the schema for the `ccip-cli laneLatency` command.
 */

import { outputOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const laneLatencySchema: CommandSchema<'laneLatency'> = {
  name: 'laneLatency',
  description: 'Query real-time lane latency between source and destination chains',
  synopsis: 'ccip-cli laneLatency <source> <dest> [options]',

  arguments: [
    {
      name: 'source',
      label: 'Source Network',
      type: 'chain',
      required: true,
      placeholder: 'ethereum-mainnet',
      description: 'Source network (chain ID, selector, or name)',
    },
    {
      name: 'dest',
      label: 'Destination Network',
      type: 'chain',
      required: true,
      placeholder: 'arbitrum-mainnet',
      description: 'Destination network (chain ID, selector, or name)',
    },
  ],

  options: [
    {
      type: 'string',
      name: 'api-url',
      label: 'API URL',
      description: 'Custom CCIP API URL',
      group: 'api',
      placeholder: 'https://api.ccip.chain.link',
    },
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Check lane latency',
      command: 'ccip-cli laneLatency ethereum-mainnet arbitrum-mainnet',
    },
    {
      title: 'Using chain IDs',
      command: 'ccip-cli laneLatency 1 42161',
    },
    {
      title: 'JSON output',
      command: 'ccip-cli laneLatency ethereum-mainnet arbitrum-mainnet --format json',
    },
  ],
}
