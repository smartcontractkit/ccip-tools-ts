import {
  type Blockhash,
  type MessageCompiledInstruction,
  type MessageV1Args,
  type PublicKey,
  type TransactionInstruction,
  MessageV1,
  PACKET_DATA_SIZE,
  SIGNATURE_LENGTH_IN_BYTES,
  TransactionMessage,
  V1_TRANSACTION_SIZE_LIMIT,
  VERSION_1_MESSAGE_PREFIX,
} from '@solana/web3.js'
import bs58 from 'bs58'

import { CCIPArgumentInvalidError, CCIPTransactionTooLargeError } from '../errors/index.ts'

// v1 transaction-config wire mask bits (web3.js keeps these internal)
const CONFIG_MASK_PRIORITY_FEE_BITS = 0b00011
const CONFIG_MASK_COMPUTE_UNIT_LIMIT_BIT = 0b00100
const CONFIG_MASK_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT = 0b01000
const CONFIG_MASK_HEAP_SIZE_BIT = 0b10000

/**
 * A {@link MessageV1} that can be serialized for signing and sending.
 *
 * web3.js 1.99 adds v1 transactions (SIMD-0385: 4096-byte wire limit vs 1232 for
 * v0, inline transactionConfig, no address lookup tables) but only READ support —
 * its `MessageV1.serialize()` throws. This subclass restores serialization, so v1
 * transactions flow through the standard `tx.sign()`/`tx.partialSign()` wallet
 * paths (which sign `message.serialize()` bytes) and `VersionedTransaction` keeps
 * tracking signatures per account index.
 */
export class SerializableMessageV1 extends MessageV1 {
  override serialize(): Uint8Array {
    return serializeMessageV1(this)
  }
}

/**
 * Serializes a v1 transaction message to its wire format:
 * `0x81` prefix, 3-byte header, u32 config mask, recent blockhash, u8 instruction
 * count, u8 static-account-key count, the static keys, the transaction-config
 * values present in the mask (u64 priority fee, then u32 compute-unit limit,
 * loaded-accounts data-size limit and heap size), then instruction headers
 * (program-id index, u8 account-index count, u16 data length) and payloads.
 */
export function serializeMessageV1(message: MessageV1): Uint8Array {
  const { transactionConfig } = message
  if (message.staticAccountKeys.length > 255) {
    throw new CCIPTransactionTooLargeError(
      'Too many static account keys for a v1 transaction message (max 255)',
    )
  }
  if (message.compiledInstructions.length > 255) {
    throw new CCIPTransactionTooLargeError(
      'Too many instructions for a v1 transaction message (max 255)',
    )
  }

  const configMask =
    (transactionConfig.priorityFee != null ? CONFIG_MASK_PRIORITY_FEE_BITS : 0) |
    (transactionConfig.computeUnitLimit != null ? CONFIG_MASK_COMPUTE_UNIT_LIMIT_BIT : 0) |
    (transactionConfig.loadedAccountsDataSizeLimit != null
      ? CONFIG_MASK_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT
      : 0) |
    (transactionConfig.heapSize != null ? CONFIG_MASK_HEAP_SIZE_BIT : 0)

  // prefix + 3-byte header + u32 config mask + blockhash + u8 instruction count + u8 key count
  const head = Buffer.alloc(42)
  head[0] = VERSION_1_MESSAGE_PREFIX
  head[1] = message.header.numRequiredSignatures
  head[2] = message.header.numReadonlySignedAccounts
  head[3] = message.header.numReadonlyUnsignedAccounts
  head.writeUInt32LE(configMask, 4)
  head.set(bs58.decode(message.recentBlockhash), 8)
  head[40] = message.compiledInstructions.length
  head[41] = message.staticAccountKeys.length

  const parts: Buffer[] = [head]
  for (const key of message.staticAccountKeys) parts.push(Buffer.from(key.toBytes()))

  // config values, in the mask-bit order the wire format expects
  const configField = (value: number | null | undefined, bytes: number) => {
    if (value == null) return
    const buf = Buffer.alloc(bytes)
    if (bytes === 8) buf.writeBigUInt64LE(BigInt(value))
    else buf.writeUInt32LE(value)
    parts.push(buf)
  }
  configField(transactionConfig.priorityFee, 8)
  configField(transactionConfig.computeUnitLimit, 4)
  configField(transactionConfig.loadedAccountsDataSizeLimit, 4)
  configField(transactionConfig.heapSize, 4)

  // instruction headers first, then their payloads
  for (const { programIdIndex, accountKeyIndexes, data } of message.compiledInstructions) {
    const header = Buffer.alloc(4)
    header[0] = programIdIndex
    header[1] = accountKeyIndexes.length
    if (data.length > 0xffff) {
      throw new CCIPTransactionTooLargeError(
        'Instruction data too large for a v1 transaction message (max 65535 bytes)',
      )
    }
    header.writeUInt16LE(data.length, 2)
    parts.push(header)
  }
  for (const { accountKeyIndexes, data } of message.compiledInstructions) {
    parts.push(Buffer.from(accountKeyIndexes), Buffer.from(data))
  }

  return new Uint8Array(Buffer.concat(parts))
}

/**
 * Serializes a signed v1 transaction to its wire envelope: the message bytes
 * followed by the signatures at the tail (no signature-count prefix — the count
 * comes from the message header, unlike legacy/v0). Entries may be null/undefined
 * (zero-filled slots), e.g. for simulation with `sigVerify: false`.
 */
export function serializeV1Transaction(
  message: MessageV1,
  signatures: (Uint8Array | null | undefined)[],
): Uint8Array {
  const numRequired = message.header.numRequiredSignatures
  if (signatures.length !== numRequired) {
    throw new CCIPArgumentInvalidError(
      'signatures',
      `expected ${numRequired}, got ${signatures.length}`,
    )
  }
  const messageBytes = message.serialize()
  const wire = Buffer.alloc(messageBytes.length + numRequired * SIGNATURE_LENGTH_IN_BYTES)
  wire.set(messageBytes, 0)
  signatures.forEach((signature, i) => {
    if (signature == null) return // zero-filled slot
    if (signature.length !== SIGNATURE_LENGTH_IN_BYTES) {
      throw new CCIPArgumentInvalidError(`signatures[${i}]`, 'invalid length')
    }
    wire.set(signature, messageBytes.length + i * SIGNATURE_LENGTH_IN_BYTES)
  })
  if (wire.length > V1_TRANSACTION_SIZE_LIMIT) {
    throw new CCIPTransactionTooLargeError(
      `Transaction too large: ${wire.length} > ${V1_TRANSACTION_SIZE_LIMIT}`,
    )
  }
  return wire
}

/**
 * Compiles instructions into a v1 transaction message. v1 has no address lookup
 * tables, so every account is static; compilation reuses web3.js' v0 compiler
 * (same dedupe/ordering/header semantics, same u8 account indexes) and only the
 * envelope differs. The compute-unit limit is inlined into the message's
 * transactionConfig instead of a ComputeBudget instruction.
 * @throws if the compiled accounts exceed the 255 static keys the v1 format allows
 */
export function compileV1Message({
  payerKey,
  recentBlockhash,
  instructions,
  computeUnitLimit,
}: {
  payerKey: PublicKey
  recentBlockhash: Blockhash
  instructions: TransactionInstruction[]
  computeUnitLimit?: number
}): SerializableMessageV1 {
  let messageV0
  try {
    messageV0 = new TransactionMessage({
      payerKey,
      recentBlockhash,
      instructions,
    }).compileToV0Message()
  } catch (err) {
    // v0 compilation fails before our own limit check when the accounts cannot be
    // referenced — surface the v1-specific limit instead
    throw new CCIPTransactionTooLargeError(
      'Too many static account keys for a v1 transaction message (max 255)',
      { cause: err as Error },
    )
  }
  if (messageV0.staticAccountKeys.length > 255) {
    throw new CCIPTransactionTooLargeError(
      'Too many static account keys for a v1 transaction message (max 255)',
    )
  }
  const args: MessageV1Args = {
    header: messageV0.header,
    staticAccountKeys: messageV0.staticAccountKeys,
    recentBlockhash: messageV0.recentBlockhash,
    compiledInstructions: messageV0.compiledInstructions as MessageCompiledInstruction[],
    transactionConfig: {
      computeUnitLimit: computeUnitLimit ?? null,
      heapSize: null,
      loadedAccountsDataSizeLimit: null,
      priorityFee: null,
    },
  }
  return new SerializableMessageV1(args)
}

/** Wire size limit for v0 transactions (the UDP packet data size). */
export { PACKET_DATA_SIZE, V1_TRANSACTION_SIZE_LIMIT }
