/**
 * Send Command Schema
 *
 * Defines the schema for the `ccip-cli send` command.
 */

import { outputOptions, walletOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const sendSchema: CommandSchema<'send'> = {
  name: 'send',
  description: 'Send a CCIP message from source to destination chain',
  synopsis: 'ccip-cli send <source> <router> <dest> [options]',

  arguments: [
    {
      name: 'source',
      label: 'Source Chain',
      type: 'chain',
      required: true,
      placeholder: 'ethereum-testnet-sepolia',
      description: 'Source network (chain ID or name)',
    },
    {
      name: 'router',
      label: 'Router Address',
      type: 'string',
      required: true,
      placeholder: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
      pattern: /^0x[a-fA-F0-9]{40}$/,
      description: 'CCIP Router contract address on source chain',
    },
    {
      name: 'dest',
      label: 'Destination Chain',
      type: 'chain',
      required: true,
      placeholder: 'ethereum-testnet-sepolia-arbitrum-1',
      description: 'Destination network (chain ID or name)',
    },
  ],

  options: [
    // Message Options
    {
      type: 'string',
      name: 'receiver',
      alias: 'R',
      label: 'Receiver Address',
      description: 'Receiver address on destination chain',
      group: 'message',
      placeholder: '0x...',
      pattern: /^0x[a-fA-F0-9]{40,64}$/,
    },
    {
      type: 'string',
      name: 'data',
      alias: 'd',
      label: 'Message Data',
      description: 'Message data (hex or UTF-8 text)',
      group: 'message',
      placeholder: '0x1234... or "hello world"',
    },
    {
      type: 'array',
      name: 'transfer-tokens',
      alias: 't',
      label: 'Token Transfers',
      description: 'Token transfers (format: 0xTokenAddr=amount)',
      group: 'message',
      itemType: 'token-transfer',
      placeholder: '0xToken=1.0',
    },
    {
      type: 'select',
      name: 'fee-token',
      label: 'Fee Token',
      description: 'Token to pay fees (omit for native)',
      group: 'message',
      options: [
        { value: '', label: 'Native (ETH/SOL)' },
        { value: 'LINK', label: 'LINK' },
      ],
    },

    // Gas Options
    {
      type: 'string',
      name: 'gas-limit',
      alias: 'L',
      label: 'Gas Limit',
      description: 'Gas limit for receiver callback (0 = default ~200k)',
      group: 'gas',
      placeholder: '200000',
    },
    {
      type: 'string',
      name: 'estimate-gas-limit',
      label: 'Estimate Gas Limit',
      description: 'Auto-estimate gas with margin % (e.g., 10 for +10%)',
      group: 'gas',
      placeholder: '10',
    },
    {
      type: 'boolean',
      name: 'allow-out-of-order-exec',
      alias: 'ooo',
      label: 'Allow Out-of-Order Execution',
      description: 'Allow out-of-order execution (v1.5+ lanes only)',
      group: 'gas',
      minVersion: '0.85.0',
    },

    // Wallet Options
    ...walletOptions,
    {
      type: 'boolean',
      name: 'approve-max',
      label: 'Approve Max Allowance',
      description: 'Approve max token allowance instead of exact amount',
      group: 'wallet',
    },

    // Solana-Specific
    {
      type: 'string',
      name: 'token-receiver',
      label: 'Token Receiver',
      description: 'Token receiver if different from program receiver',
      group: 'solana',
      chains: ['solana'],
      placeholder: 'Base58 address...',
    },
    {
      type: 'array',
      name: 'account',
      label: 'Additional Accounts',
      description: 'Additional accounts for receiver program (append =rw for writable)',
      group: 'solana',
      chains: ['solana'],
      itemType: 'string',
      placeholder: 'Account pubkey',
    },

    // Dry-Run Options
    {
      type: 'boolean',
      name: 'only-get-fee',
      label: 'Only Get Fee',
      description: 'Print fee and exit without sending',
      group: 'output',
    },
    {
      type: 'boolean',
      name: 'only-estimate',
      label: 'Only Estimate',
      description: 'Print gas estimate and exit without sending',
      group: 'output',
    },

    // Output Options
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Send a simple message',
      command:
        'ccip-cli send ethereum-testnet-sepolia 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 ethereum-testnet-sepolia-arbitrum-1 --receiver 0xAB4f961939BFE6A93567cC57C59eEd7084CE2131 --data "hello"',
    },
    {
      title: 'Send with token transfer',
      command:
        'ccip-cli send ethereum-testnet-sepolia 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 ethereum-testnet-sepolia-arbitrum-1 --receiver 0xAB4f... --transfer-tokens 0xToken=1.0 --fee-token LINK',
    },
    {
      title: 'Check fee only',
      command: 'ccip-cli send ethereum-testnet-sepolia 0x0BF3dE8c... arbitrum --only-get-fee',
    },
  ],
}
