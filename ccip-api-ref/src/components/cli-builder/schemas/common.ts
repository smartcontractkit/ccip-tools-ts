/**
 * Common CLI options shared across commands
 */

import type { OptionDefinition } from '../types/index.ts'

/** Wallet options - shared across commands that need signing */
export const walletOptions: OptionDefinition[] = [
  {
    type: 'string',
    name: 'wallet',
    alias: 'w',
    label: 'Wallet',
    description:
      'Wallet source: ledger[:index], trezor[:index], or private key in USER_KEY env var',
    group: 'wallet',
    placeholder: 'ledger or ledger:0',
  },
]

/** Output options - shared across all commands */
export const outputOptions: OptionDefinition[] = [
  {
    type: 'select',
    name: 'format',
    alias: 'f',
    label: 'Output Format',
    description: 'Format for command output',
    group: 'output',
    options: [
      { value: 'pretty', label: 'Pretty (human-readable tables)' },
      { value: 'json', label: 'JSON (machine-readable)' },
      { value: 'log', label: 'Log (console.log style)' },
    ],
    defaultValue: 'pretty',
  },
  {
    type: 'boolean',
    name: 'verbose',
    alias: 'v',
    label: 'Verbose',
    description: 'Enable debug logging',
    group: 'output',
    defaultValue: false,
  },
]

/** RPC configuration options */
export const rpcOptions: OptionDefinition[] = [
  {
    type: 'array',
    name: 'rpcs',
    alias: 'rpc',
    label: 'RPC URLs',
    description: 'List of RPC endpoint URLs (ws[s] or http[s])',
    group: 'config',
    itemType: 'string',
    placeholder: 'https://eth-mainnet.g.alchemy.com/...',
  },
  {
    type: 'string',
    name: 'rpcs-file',
    label: 'RPC File',
    description: 'File containing RPC endpoints (reads RPC_* environment variables)',
    group: 'config',
    defaultValue: './.env',
    placeholder: './.env',
  },
]
