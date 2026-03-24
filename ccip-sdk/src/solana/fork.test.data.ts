import type { ForkTestMessage } from '../evm/fork.test.data.ts'
import { MessageStatus } from '../types.ts'

// All messages discovered via the CCIP staging API (api.ccip.cldev.cloud) on 2026-03-24.
// Solana mainnet chain selector: 124615329519749607
// Genesis hash: 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d

export const SOLANA_TO_ETHEREUM: ForkTestMessage[] = [
  {
    messageId: '0x2d5cb1ef113d128b055b136fe8fd9a3c8c236e419ca524d2aae6992442b0b133',
    txHash:
      '47rEK1VRU2jdmmA4EADYRPFCRRJBsCgtNf5D9Zs9TgAq55edKoKfHiZq96wgF4HdJNqtLpqNif2zKie7anMGys1F',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only message from Solana to Ethereum',
  },
  {
    messageId: '0x6bacb96f497de5c20be944c9c92570df3ee735bdba7c33840355484197c242b0',
    txHash:
      '5Vhci2yRssCAm26RZjF1JJazZcKQbyZxtsmLtLiD4gjZ6AGSpm8aRZrL2SDi2r1vK2e7cdyCFyb6aVYN8D8rTPJS',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'USDC token transfer (~57.8 USDC) from Solana to Ethereum',
  },
  {
    messageId: '0x71ccbe8726eef5f4678db2d73e27a93bef18094beac17e252fd69ff9169abe7b',
    txHash:
      '2r6L7HSFVLTi7DWEieHeJYNALmkCZH8vTba8JwGkCniHAxUZXpSHg3Ujkt622ETNoekQEpMz7Ainx3z8K5xd3b6j',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'USDC token transfer (~13.7 USDC) from Solana to Ethereum',
  },
]

export const ETHEREUM_TO_SOLANA: ForkTestMessage[] = [
  {
    messageId: '0x8c8edfe2c116630204c2fa44ec4461024b3a4439cc98ae137a11c98647f8ab8c',
    txHash: '0x31f4f01bb07a1d990cba9bbbf5b044f6d794e3c07be48e4f6bc988377b92a750',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'data-only message from Ethereum to Solana',
  },
  {
    messageId: '0x7ed0b76fde523b4723e75300cf92e38bd2629429a27a1ce6a69e431d8e5d024a',
    txHash: '0x5b8ebd841d581566d8ce63166e1805f950aee27fed5c930e4411bfc9c0e5b61c',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer from BSC to Solana (~15B units)',
  },
  {
    messageId: '0xda90d3c54f7ce256c8fa45ee0b8f265c48bf4446810d560ecfc9deebe41c9cff',
    txHash: '0xc7731e71a9aa0cd8a241ee0dcd3c824a6f88bad329ecb2b5b0d0dd6219b6a02c',
    status: MessageStatus.Failed,
    version: '1.6',
    description: 'failed token transfer (10 tokens) from Base to Solana, receiver=system program',
  },
]
