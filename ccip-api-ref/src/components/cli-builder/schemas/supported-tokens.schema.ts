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
  synopsis: 'ccip-cli getSupportedTokens <source> <address> [token] [options]',

  arguments: [
    {
      name: 'source',
      label: 'Source Network',
      type: 'string',
      required: true,
      placeholder: 'ethereum-mainnet',
      description: 'Source network (chain ID or name)',
    },
    {
      name: 'address',
      label: 'Contract Address',
      type: 'string',
      required: true,
      placeholder: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
      pattern: /^0x[a-fA-F0-9]{40}$/,
      description: 'Router, OnRamp, TokenAdminRegistry, or TokenPool address',
    },
    {
      name: 'token',
      label: 'Token Address',
      type: 'string',
      required: false,
      placeholder: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      pattern: /^0x[a-fA-F0-9]{40}$/,
      description: 'Token address to query directly (skips interactive selection)',
    },
  ],

  options: [...rpcOptions, ...outputOptions],

  examples: [
    {
      title: 'List tokens on Ethereum',
      command:
        'ccip-cli getSupportedTokens ethereum-mainnet 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
    },
    {
      title: 'Query specific token',
      command:
        'ccip-cli getSupportedTokens ethereum-mainnet 0x80226fc0... 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    {
      title: 'JSON output',
      command: 'ccip-cli getSupportedTokens ethereum-mainnet 0x80226fc0... --format json',
    },
  ],
}
