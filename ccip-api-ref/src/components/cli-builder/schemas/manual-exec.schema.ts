/**
 * ManualExec Command Schema
 *
 * Defines the schema for the `ccip-cli manual-exec` command.
 */

import type { CommandSchema } from '../types/index.ts'
import { outputOptions, rpcOptions, walletOptions } from './common.ts'

export const manualExecSchema: CommandSchema<'manual-exec'> = {
  name: 'manual-exec',
  description: 'Manually execute pending or failed CCIP messages',
  synopsis: 'ccip-cli manual-exec <tx-hash-or-id> [options]',

  arguments: [
    {
      name: 'tx-hash-or-id',
      label: 'Transaction Hash or Message ID',
      type: 'string',
      required: true,
      placeholder: '0x1234567890abcdef...',
      description:
        'Transaction hash or CCIP message ID (32-byte hex). Message ID path only needs destination RPC.',
    },
  ],

  options: [
    // Verification Sources
    {
      type: 'array',
      name: 'verifier',
      alias: 'verifiers',
      label: 'Verifier Endpoints',
      description:
        "Verifier endpoint URLs to read CCV attestations from directly, when the CCIP API and indexers don't " +
        "cover the destination's CCV policy (e.g. a CCV no indexer has onboarded). Tried in order until " +
        'covered. https:// or http:// for a grpc-web proxy; grpc:// or grpcs:// (TLS) or ' +
        'grpc+plaintext:// for a native gRPC aggregator.',
      group: 'verification',
      itemType: 'string',
      placeholder: 'grpc://aggregator.example:443',
    },
    {
      type: 'array',
      name: 'ccv-data',
      label: 'Supplied CCV Attestations',
      description:
        'CCV attestations obtained out of band, as <dest-ccv-address>=<0x-hex>; they win over fetched ' +
        "ones. The CCV's verifyMessage still decides validity onchain, so wrong bytes can only waste gas.",
      group: 'verification',
      itemType: 'string',
      placeholder: '0x345AEDB0...=0x00010001...',
    },
    // Message Selection
    {
      type: 'number',
      name: 'log-index',
      label: 'Log Index',
      description: 'Select specific message by log index',
      group: 'message',
      placeholder: '0',
    },
    // Gas Options
    {
      type: 'number',
      name: 'gas-limit',
      alias: 'L',
      label: 'Gas Limit',
      description:
        'Override gas limit for receiver callback (0 = original). Alias: --compute-units',
      group: 'gas',
      placeholder: '500000',
    },
    {
      type: 'number',
      name: 'tokens-gas-limit',
      label: 'Tokens Gas Limit',
      description: 'Override gas limit for token pool releaseOrMint calls',
      group: 'gas',
      placeholder: '200000',
    },
    {
      type: 'number',
      name: 'estimate-gas-limit',
      label: 'Estimate Gas Limit',
      description: 'Estimate gas with margin % (e.g., 10 for +10%). Conflicts with --gas-limit.',
      group: 'gas',
      placeholder: '10',
    },
    // Solana Options
    {
      type: 'boolean',
      name: 'force-buffer',
      label: 'Force Buffer',
      description: 'Use buffer for large messages on Solana',
      group: 'solana',
    },
    {
      type: 'boolean',
      name: 'force-lookup-table',
      label: 'Force Lookup Table',
      description: 'Create lookup table for accounts on Solana',
      group: 'solana',
    },
    {
      type: 'boolean',
      name: 'clear-leftover-accounts',
      label: 'Clear Leftover Accounts',
      description: 'Clear buffers/tables from previous attempts',
      group: 'solana',
    },
    // Sui Options
    {
      type: 'array',
      name: 'receiver-object-ids',
      label: 'Receiver Object IDs',
      description: 'Receiver object IDs for Sui execution',
      group: 'sui',
      placeholder: '0xabc...',
      itemType: 'string',
    },
    ...walletOptions,
    ...rpcOptions,
    ...outputOptions,
  ],

  examples: [
    {
      title: 'Execute pending message',
      command: 'ccip-cli manual-exec 0x1234... --wallet ledger',
    },
    {
      title: 'Override gas limit',
      command: 'ccip-cli manual-exec 0x1234... --gas-limit 500000',
    },
    {
      title: 'Solana with buffer',
      command: 'ccip-cli manual-exec 0x1234... --force-buffer --clear-leftover-accounts',
    },
    {
      title: 'Sui with receiver objects',
      command: 'ccip-cli manual-exec 0x1234... --receiver-object-ids 0xabc... 0xdef...',
    },
  ],
}
