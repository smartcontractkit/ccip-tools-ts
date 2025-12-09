import { createHash } from 'crypto'

import { type Address, Cell, beginCell } from '@ton/core'
import type { TonClient } from '@ton/ton'

import { sleep } from '../utils.ts'

/**
 * Computes SHA256 hash of data and returns as hex string
 * Used throughout TON hasher for domain separation and message hashing
 */
export const sha256 = (data: Uint8Array): string => {
  return '0x' + createHash('sha256').update(data).digest('hex')
}

/**
 * Converts hex string to Buffer, handling 0x prefix normalization
 * Returns empty buffer for empty input
 */
export const hexToBuffer = (value: string): Buffer => {
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  return normalized.length === 0 ? Buffer.alloc(0) : Buffer.from(normalized, 'hex')
}

/**
 * Converts various numeric types to BigInt for TON's big integer operations
 * Used throughout the hasher for chain selectors, amounts, and sequence numbers
 */
export const toBigInt = (value: bigint | number | string): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  return BigInt(value)
}

/**
 * Attempts to parse hex string as TON BOC (Bag of Cells) format
 * Falls back to storing raw bytes as cell data if BOC parsing fails
 * Used for parsing message data, extra data, and other hex-encoded fields
 */
export const tryParseCell = (hex: string): Cell => {
  const bytes = hexToBuffer(hex)
  if (bytes.length === 0) return beginCell().endCell()
  try {
    return Cell.fromBoc(bytes)[0]
  } catch {
    return beginCell().storeBuffer(bytes).endCell()
  }
}

/**
 * Extracts the 32-bit magic tag from a BOC-encoded cell
 * Magic tags identify the type of TON structures (e.g., extra args types)
 * Used for type detection and validation when decoding CCIP extra args
 * Returns tag as 0x-prefixed hex string for easy comparison
 */
export function extractMagicTag(bocHex: string): string {
  const cell = Cell.fromBoc(hexToBuffer(bocHex))[0]
  const tag = cell.beginParse().loadUint(32)
  return `0x${tag.toString(16).padStart(8, '0')}`
}

/**
 * Waits for a transaction to be confirmed by polling until the wallet's seqno advances.
 * Once seqno advances past expectedSeqno, fetches the latest transaction details.
 *
 * @param client - TON client
 * @param walletAddress - Address of the wallet that sent the transaction
 * @param expectedSeqno - The seqno used when sending the transaction
 * @param expectedDestination - Optional destination address to verify (e.g., offRamp)
 * @param maxAttempts - Maximum polling attempts (default: 25)
 * @param intervalMs - Polling interval in ms (default: 1000)
 * @returns Transaction info with lt and hash
 */
export async function waitForTransaction(
  client: TonClient,
  walletAddress: Address,
  expectedSeqno: number,
  expectedDestination?: Address,
  maxAttempts = 25,
  intervalMs = 1000,
): Promise<{ lt: string; hash: string; timestamp: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Check current seqno by calling the wallet's seqno getter
      const seqnoResult = await client.runMethod(walletAddress, 'seqno')
      const currentSeqno = seqnoResult.stack.readNumber()

      // Check if transaction was processed
      const seqnoAdvanced = currentSeqno > expectedSeqno

      if (seqnoAdvanced) {
        // Get the most recent transaction (should be ours)
        const txs = await client.getTransactions(walletAddress, { limit: 5 })

        for (const tx of txs) {
          // If destination verification requested, check outgoing messages
          if (expectedDestination) {
            const outMessages = tx.outMessages.values()
            let destinationMatch = false

            for (const msg of outMessages) {
              if (msg.info.type === 'internal' && msg.info.dest.equals(expectedDestination)) {
                destinationMatch = true
                break
              }
            }

            if (!destinationMatch) continue
          }

          return {
            lt: tx.lt.toString(),
            hash: tx.hash().toString('hex'),
            timestamp: tx.now,
          }
        }
      }

      // Handle case where contract was just deployed (seqno 0 -> 1)
      if (expectedSeqno === 0 && attempt > 0) {
        const txs = await client.getTransactions(walletAddress, { limit: 1 })
        if (txs.length > 0) {
          const tx = txs[0]
          return {
            lt: tx.lt.toString(),
            hash: tx.hash().toString('hex'),
            timestamp: tx.now,
          }
        }
      }
    } catch {
      // Contract might not be initialized yet, or network error - retry
    }

    await sleep(intervalMs)
  }

  throw new Error(
    `Transaction with seqno ${expectedSeqno} not confirmed after ${maxAttempts} attempts`,
  )
}
