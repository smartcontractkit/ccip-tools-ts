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
      label: 'Source Chain',
      type: 'chain',
      required: true,
      placeholder: 'ethereum-mainnet',
      description: 'Source network (chain ID, selector, or name)',
    },
    {
      name: 'dest',
      label: 'Destination Chain',
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
      description: 'Custom CCIP API URL (defaults to api.ccip.chain.link)',
      group: 'output',
      placeholder: 'https://api.ccip.chain.link',
    },
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Query latency between Ethereum and Arbitrum',
      command: 'ccip-cli laneLatency ethereum-mainnet arbitrum-mainnet',
    },
    {
      title: 'Query using chain selectors',
      command: 'ccip-cli laneLatency 5009297550715157269 4949039107694359620',
    },
    {
      title: 'JSON output for scripting',
      command: 'ccip-cli laneLatency ethereum-mainnet arbitrum-mainnet --format json',
    },
  ],
}
