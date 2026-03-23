import type { ForkTestMessage } from '../evm/fork.test.data.ts'
import { MessageStatus } from '../types.ts'

// All messages discovered via the CCIP staging API (api.ccip.cldev.cloud) on 2026-03-23.
// Solana devnet chain selector: 16423721717087811551
// Genesis hash: EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG

export const SOLANA_TO_SEPOLIA: ForkTestMessage[] = [
  {
    messageId: '0x1eedaa9f593912c0ca79aeedbf6ed9a89f98d6e79ee04ba58671b304576696e3',
    txHash:
      '3ZP8X35uCYbBgMBSLPTWByTFd7D3i1cNa42DxnbzJcZbifrEJgGwr53pUofNbKYCFXNPpenXLy2SSDfmPamSjNPw',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (45 tokens) from Solana to Sepolia',
  },
  {
    messageId: '0x611b861aa75aeddcbfc01ef326cb93da17cbc2b04e76981686a68a2b6aaa62b0',
    txHash:
      '4e4ADL2aq1P8fgkYNPkGZwz8avu7SzoUnnhi4zzjzuhQKq6KFe2fQ8qv8WZazbaDxwZEGaLAW47rq17xEf6gNnJ3',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (45 tokens) from Solana to Sepolia',
  },
  {
    messageId: '0xbd607f844acc61e16c2d7497ff528ad3d7a61eae2e7fe283154646eec7571bd0',
    txHash:
      '4QUmX2mPz7Y4nfkR45zKUDC9cRzxFi679enThv74mpTzaFEzewB5WFetaZ4ziMFCaq8pQQJWYGkzpY7STehpkU2X',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (45 tokens) from Solana to Sepolia',
  },
]

export const SEPOLIA_TO_SOLANA: ForkTestMessage[] = [
  {
    messageId: '0x052c16788d18aa9d967aa402035de05b3daedb19c7f9aafbd4bd473511b45fa6',
    txHash: '0x40cad340bbc7bfa7f08518b43c27138198f92ff30b2c4ded3f0243c493e9ef7c',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (1T units) from Sepolia to Solana',
  },
  {
    messageId: '0x28597da56be79032b1200e3ed28fbee6751ca4ba856612993e2b43984b89b66c',
    txHash: '0x6ef7f57480f62df565f7ed4b79eeb14427518d00ce3168741bbc76e10d71adbf',
    status: MessageStatus.Success,
    version: '1.6',
    description: 'token transfer (1T units) from Sepolia to Solana',
  },
]
