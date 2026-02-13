/**
 * Token Command Schema
 *
 * Defines the schema for the `ccip-cli token` command.
 */

import { outputOptions, rpcOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const tokenSchema: CommandSchema<'token'> = {
  name: 'token',
  description: 'Query native or token balance for an address',
  synopsis: 'ccip-cli token -n <network> -H <holder> [options]',

  arguments: [],

  options: [
    // Required Options
    {
      type: 'string',
      name: 'network',
      alias: 'n',
      label: 'Network',
      required: true,
      placeholder: 'ethereum-mainnet',
      description: 'Network chain ID or name (e.g., ethereum-mainnet, solana-devnet)',
      group: 'required',
    },
    {
      type: 'string',
      name: 'holder',
      alias: 'H',
      label: 'Holder Address',
      required: true,
      placeholder: '0x1234...abcd',
      description: 'Wallet address to query balance for',
      group: 'required',
    },

    // Optional Options
    {
      type: 'string',
      name: 'token',
      alias: 't',
      label: 'Token Address',
      placeholder: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      description: 'Token address (omit for native token balance)',
      group: 'query',
    },

    // RPC and Output Options
    ...rpcOptions,
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Query native ETH balance',
      command: 'ccip-cli token -n ethereum-mainnet -H 0x1234...abcd',
    },
    {
      title: 'Query ERC20 token balance (USDC)',
      command:
        'ccip-cli token -n ethereum-mainnet -H 0x1234... -t 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    {
      title: 'Query native SOL balance',
      command: 'ccip-cli token -n solana-devnet -H EPUjBP3Xf76K1VKsDSc6GupBWE8uykNksCLJgXZn87CB',
    },
    {
      title: 'JSON output for scripting',
      command: 'ccip-cli token -n ethereum-mainnet -H 0x1234... --format json',
    },
  ],
}
