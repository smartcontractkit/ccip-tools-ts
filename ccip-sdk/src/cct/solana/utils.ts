import {
  type Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'

import { CCIPCctParamsInvalidError } from '../../errors/index.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'

/** Supported serialized transaction encodings. */
export type SerializedSolanaTxEncoding = 'base58' | 'base64' | 'hex'

/** Derives a PDA from a UTF-8 seed and optional raw seed buffers. */
export function derivePda(seed: string, programId: PublicKey, extra: Buffer[] = []): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], programId)[0]
}

/** Serializes an unsigned Solana tx into one unsigned v0 transaction. */
export function serializeUnsignedSolanaTx(
  connection: Connection,
  unsigned: Pick<UnsignedSolanaTx, 'instructions' | 'lookupTables'>,
  payer: PublicKey | string,
  encoding?: SerializedSolanaTxEncoding,
): Promise<string>
export async function serializeUnsignedSolanaTx(
  connection: Connection,
  unsigned: Pick<UnsignedSolanaTx, 'instructions' | 'lookupTables'>,
  payer: PublicKey | string,
  encoding = 'base64',
): Promise<string> {
  const payerKey = typeof payer === 'string' ? new PublicKey(payer) : payer
  const { blockhash } = await connection.getLatestBlockhash()
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: unsigned.instructions,
  }).compileToV0Message(unsigned.lookupTables)
  const serialized = Buffer.from(new VersionedTransaction(message).serialize())

  if (encoding === 'base58') return bs58.encode(serialized)
  if (encoding === 'base64') return serialized.toString('base64')
  if (encoding === 'hex') return serialized.toString('hex')
  throw new CCIPCctParamsInvalidError(
    'serializeUnsignedTx',
    'encoding',
    `unsupported Solana transaction encoding: ${String(encoding)}`,
  )
}
