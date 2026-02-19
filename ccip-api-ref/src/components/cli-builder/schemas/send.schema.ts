/**
 * Send Command Schema
 *
 * Defines the schema for the `ccip-cli send` command.
 */

import { outputOptions, rpcOptions, walletOptions } from './common.ts'
import type { CommandSchema } from '../types/index.ts'

export const sendSchema: CommandSchema<'send'> = {
  name: 'send',
  description: 'Send a CCIP message from source to destination chain',
  synopsis: 'ccip-cli send -s <source> -d <dest> -r <router> [options]',

  arguments: [],

  options: [
    // Required Options
    {
      type: 'chain',
      name: 'source',
      alias: 's',
      label: 'Source Chain',
      required: true,
      placeholder: 'ethereum-testnet-sepolia',
      description: 'Source network (chain ID, selector, or name)',
      group: 'required',
    },
    {
      type: 'chain',
      name: 'dest',
      alias: 'd',
      label: 'Destination Chain',
      required: true,
      placeholder: 'ethereum-testnet-sepolia-arbitrum-1',
      description: 'Destination network (chain ID, selector, or name)',
      group: 'required',
    },
    {
      type: 'string',
      name: 'router',
      alias: 'r',
      label: 'Router Address',
      required: true,
      placeholder: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
      pattern: /^0x[a-fA-F0-9]{40}$/,
      description: 'CCIP Router contract address on source chain',
      group: 'required',
    },

    // Message Options
    {
      type: 'string',
      name: 'receiver',
      alias: 'to',
      label: 'Receiver Address',
      description: 'Receiver address on destination. Defaults to sender if same chain family.',
      group: 'message',
      placeholder: '0x...',
      pattern: /^0x[a-fA-F0-9]{40,64}$/,
    },
    {
      type: 'string',
      name: 'data',
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
      type: 'number',
      name: 'gas-limit',
      alias: 'L',
      label: 'Gas Limit',
      description:
        'Gas limit for receiver callback. Defaults to ramp config (~200k) if not specified. Alias: --compute-units',
      group: 'gas',
      placeholder: '200000',
    },
    {
      type: 'number',
      name: 'estimate-gas-limit',
      label: 'Estimate Gas Limit',
      description:
        'Estimate gas limit with margin % (e.g., 10 for +10%). Conflicts with --gas-limit.',
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

    // Solana/Sui-Specific
    {
      type: 'string',
      name: 'token-receiver',
      label: 'Token Receiver',
      description: 'Solana token receiver (if different from program receiver)',
      group: 'solana',
      chains: ['solana'],
      placeholder: 'Base58 address...',
    },
    {
      type: 'array',
      name: 'account',
      alias: 'receiver-object-id',
      label: 'Additional Accounts',
      description: 'Solana accounts (append =rw for writable) or Sui object IDs',
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
      description: 'Print gas estimate and exit without sending. Requires --estimate-gas-limit.',
      group: 'output',
    },

    // Wait Option
    {
      type: 'boolean',
      name: 'wait',
      label: 'Wait for Execution',
      description: 'Wait for message execution on destination chain',
      group: 'output',
      defaultValue: false,
    },

    // RPC and Output Options
    ...rpcOptions,
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Send a simple message',
      command:
        'ccip-cli send -s ethereum-testnet-sepolia -d ethereum-testnet-sepolia-arbitrum-1 -r 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 --to 0xAB4f961939BFE6A93567cC57C59eEd7084CE2131 --data "hello"',
    },
    {
      title: 'Send with token transfer',
      command:
        'ccip-cli send -s ethereum-testnet-sepolia -d arbitrum-sepolia -r 0x0BF3dE8c... --to 0xAB4f... -t 0xToken=1.0 --fee-token LINK',
    },
    {
      title: 'Check fee only',
      command:
        'ccip-cli send -s ethereum-testnet-sepolia -d arbitrum-sepolia -r 0x0BF3dE8c... --only-get-fee',
    },
  ],
}
