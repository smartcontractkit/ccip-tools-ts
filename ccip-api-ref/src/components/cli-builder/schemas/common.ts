/**
 * Common CLI options shared across commands
 */

import type { OptionDefinition } from '../types/index.ts'

/** Wallet options - shared across commands that need signing */
export const walletOptions: OptionDefinition[] = [
  {
    type: 'select',
    name: 'wallet',
    alias: 'w',
    label: 'Wallet',
    description: 'Wallet source for signing transactions',
    group: 'wallet',
    options: [
      { value: '', label: 'Default (env/keystore)' },
      { value: 'ledger', label: 'Ledger Hardware Wallet' },
    ],
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
      { value: 'log', label: 'Log (console with details)' },
      { value: 'json', label: 'JSON (machine-readable)' },
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
    type: 'string',
    name: 'rpcs',
    alias: 'r',
    label: 'RPC URLs',
    description: 'Comma-separated list of RPC URLs',
    group: 'output',
    placeholder: 'https://eth-mainnet.g.alchemy.com/...',
  },
]
