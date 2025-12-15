/**
 * GetSupportedTokens Command Schema
 *
 * Defines the schema for the `ccip-cli getSupportedTokens` command.
 */

import { outputOptions, rpcOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const supportedTokensSchema: CommandSchema<'getSupportedTokens'> = {
  name: 'getSupportedTokens',
  description: 'List tokens supported for CCIP transfers',
  synopsis: 'ccip-cli getSupportedTokens -n <network> -a <address> [options]',

  arguments: [],

  options: [
    // Required Options
    {
      type: 'string',
      name: 'network',
      alias: 'n',
      label: 'Source Network',
      required: true,
      placeholder: 'ethereum-mainnet',
      description: 'Source network (chain ID or name)',
      group: 'required',
    },
    {
      type: 'string',
      name: 'address',
      alias: 'a',
      label: 'Contract Address',
      required: true,
      placeholder: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
      pattern: /^0x[a-fA-F0-9]{40}$/,
      description: 'Router, OnRamp, TokenAdminRegistry, or TokenPool address',
      group: 'required',
    },

    // Optional Options
    {
      type: 'string',
      name: 'token',
      alias: 't',
      label: 'Token Address',
      placeholder: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      pattern: /^0x[a-fA-F0-9]{40}$/,
      description: 'Token address to query (pre-selects from list if address is a registry)',
      group: 'query',
    },
    {
      type: 'boolean',
      name: 'fee-tokens',
      label: 'Fee Tokens Only',
      description: 'List fee tokens instead of transferable tokens',
      group: 'query',
      defaultValue: false,
    },

    // RPC and Output Options
    ...rpcOptions,
    ...outputOptions,
  ],

  examples: [
    {
      title: 'List tokens on Ethereum',
      command:
        'ccip-cli getSupportedTokens -n ethereum-mainnet -a 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
    },
    {
      title: 'Query specific token',
      command:
        'ccip-cli getSupportedTokens -n ethereum-mainnet -a 0x80226fc0... -t 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    {
      title: 'List fee tokens',
      command: 'ccip-cli getSupportedTokens -n ethereum-mainnet -a 0x80226fc0... --fee-tokens',
    },
    {
      title: 'JSON output',
      command: 'ccip-cli getSupportedTokens -n ethereum-mainnet -a 0x80226fc0... --format json',
    },
  ],
}
