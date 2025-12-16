import { type Address, Cell, beginCell } from '@ton/core'
import type { TonClient4 } from '@ton/ton'

import { CCIPTransactionNotFinalizedError } from '../errors/specialized.ts'
import { bytesToBuffer, sleep } from '../utils.ts'

/**
 * Converts hex string to Buffer, handling 0x prefix normalization
 * Returns empty buffer for empty input
 */
export const hexToBuffer = (value: string): Buffer => {
  if (!value || value === '0x' || value === '0X') return Buffer.alloc(0)
  // Normalize to lowercase 0x prefix for bytesToBuffer/getDataBytes
  let normalized: string
  if (value.startsWith('0x')) {
    normalized = value
  } else if (value.startsWith('0X')) {
    normalized = `0x${value.slice(2)}`
  } else {
    normalized = `0x${value}`
  }
  return bytesToBuffer(normalized)
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
 * @param client - TON V4 client
 * @param walletAddress - Address of the wallet that sent the transaction
 * @param expectedSeqno - The seqno used when sending the transaction
 * @param expectedDestination - Optional destination address to verify (e.g., offRamp)
 * @param maxAttempts - Maximum polling attempts (default: 25)
 * @param intervalMs - Polling interval in ms (default: 1000)
 * @returns Transaction info with lt and hash
 */
export async function waitForTransaction(
  client: TonClient4,
  walletAddress: Address,
  expectedSeqno: number,
  expectedDestination?: Address,
  maxAttempts = 25,
  intervalMs = 1000,
): Promise<{ lt: string; hash: string; timestamp: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Get latest block for state lookup (V4 API requires block seqno)
      const lastBlock = await client.getLastBlock()

      // Check current seqno by running the getter
      const seqnoResult = await client.runMethod(lastBlock.last.seqno, walletAddress, 'seqno')
      const currentSeqno = seqnoResult.reader.readNumber()

      const seqnoAdvanced = currentSeqno > expectedSeqno

      if (seqnoAdvanced) {
        // Get account state to find latest transaction
        const account = await client.getAccountLite(lastBlock.last.seqno, walletAddress)
        if (!account.account.last) {
          await sleep(intervalMs)
          continue
        }

        // Get recent transactions using V4 API
        const txs = await client.getAccountTransactions(
          walletAddress,
          BigInt(account.account.last.lt),
          Buffer.from(account.account.last.hash, 'base64'),
        )

        for (const { tx } of txs) {
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
        const account = await client.getAccountLite(lastBlock.last.seqno, walletAddress)
        if (account.account.last) {
          const txs = await client.getAccountTransactions(
            walletAddress,
            BigInt(account.account.last.lt),
            Buffer.from(account.account.last.hash, 'base64'),
          )
          if (txs.length > 0) {
            const { tx } = txs[0]
            return {
              lt: tx.lt.toString(),
              hash: tx.hash().toString('hex'),
              timestamp: tx.now,
            }
          }
        }
      }
    } catch {
      // Contract might not be initialized yet, or network error - retry
    }

    await sleep(intervalMs)
  }

  throw new CCIPTransactionNotFinalizedError(String(expectedSeqno))
}
