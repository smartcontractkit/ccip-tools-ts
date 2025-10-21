import {
  type Commitment,
  type Connection,
  type Signer,
  type Transaction,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { BytesLike } from 'ethers'

import { getDataBytes, sleep } from '../utils.ts'

export function bytesToBuffer(bytes: BytesLike): Buffer {
  return Buffer.from(getDataBytes(bytes).buffer)
}

export async function waitForFinalization(
  connection: Connection,
  signature: string,
  intervalMs = 500,
  maxAttempts = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await connection.getSignatureStatuses([signature])
    const info = status.value[0]

    if (info?.confirmationStatus === 'finalized') {
      return
    }
    await sleep(intervalMs)
  }

  throw new Error(`Transaction ${signature} not finalized after timeout`)
}

export function camelToSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z]|$)/g, (_, p1: string, p2: string) => {
      if (p2) {
        return `_${p1.slice(0, -1).toLowerCase()}_${p2.toLowerCase()}`
      }
      return `_${p1.toLowerCase()}`
    })
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/^_/, '')
}

/**
 * Used as `provider` in anchor's `Program` constructor, to support `.view()` simulations
 * @param connection - Connection to the Solana network
 * @param feePayer - Fee payer for the simulated transaction
 * @returns Value returned by the simulated method
 */
export function simulationProvider(
  connection: Connection,
  feePayer: PublicKey = new PublicKey('11111111111111111111111111111112'),
) {
  return {
    connection,
    simulate: async (
      tx: Transaction | VersionedTransaction,
      _signers?: Signer[],
      commitment: Commitment = 'confirmed',
    ) => {
      if (!('message' in tx)) {
        const message = new TransactionMessage({
          payerKey: feePayer,
          recentBlockhash: '11111111111111111111111111111112',
          instructions: tx.instructions,
        })
        tx = new VersionedTransaction(message.compileToV0Message())
      }
      const result = await connection.simulateTransaction(tx, {
        commitment,
        replaceRecentBlockhash: true,
        sigVerify: false,
      })

      if (result.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(result.value.err)}`)
      }

      return result.value
    },
  }
}
