/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createHash } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { type Schema, serialize } from 'borsh'
import type { CCIPMessage, CCIPVersion } from '../types.ts'
import type { LeafHasher } from './common.ts'

/**
 * RampMessageHeader
 * - message_id: fixed 32 bytes array.
 * - source_chain_selector, dest_chain_selector, sequence_number, nonce: u64 values.
 */
class RampMessageHeader {
  message_id: Uint8Array
  source_chain_selector: BN
  dest_chain_selector: BN
  sequence_number: BN
  nonce: BN

  constructor(fields: {
    message_id: Uint8Array
    source_chain_selector: BN
    dest_chain_selector: BN
    sequence_number: BN
    nonce: BN
  }) {
    this.message_id = fields.message_id
    this.source_chain_selector = fields.source_chain_selector
    this.dest_chain_selector = fields.dest_chain_selector
    this.sequence_number = fields.sequence_number
    this.nonce = fields.nonce
  }
}

/**
 * Any2SVMRampExtraArgs
 * - compute_units: u32
 * - is_writable_bitmap: u64
 */
class Any2SVMRampExtraArgs {
  compute_units: number
  is_writable_bitmap: BN

  constructor(fields: { compute_units: number; is_writable_bitmap: BN }) {
    this.compute_units = fields.compute_units
    this.is_writable_bitmap = fields.is_writable_bitmap
  }
}

/**
 * CrossChainAmount
 * - le_bytes: fixed 32 bytes array.
 */
class CrossChainAmount {
  le_bytes: Uint8Array

  constructor(fields: { le_bytes: Uint8Array }) {
    this.le_bytes = fields.le_bytes
  }
}

/**
 * Any2SVMTokenTransfer
 * - source_pool_address: Vec<u8> as Uint8Array
 * - dest_token_address: Pubkey (32 bytes) as Uint8Array
 * - dest_gas_amount: u32
 * - extra_data: Vec<u8> as Uint8Array
 * - amount: CrossChainAmount
 */
class Any2SVMTokenTransfer {
  source_pool_address: Uint8Array
  dest_token_address: Uint8Array
  dest_gas_amount: number
  extra_data: Uint8Array
  amount: CrossChainAmount

  constructor(fields: {
    source_pool_address: Uint8Array
    dest_token_address: Uint8Array
    dest_gas_amount: number
    extra_data: Uint8Array
    amount: CrossChainAmount
  }) {
    this.source_pool_address = fields.source_pool_address
    this.dest_token_address = fields.dest_token_address
    this.dest_gas_amount = fields.dest_gas_amount
    this.extra_data = fields.extra_data
    this.amount = fields.amount
  }
}

/**
 * Any2SVMRampMessage
 * - header: RampMessageHeader
 * - sender: Vec<u8> as Uint8Array
 * - data: Vec<u8> as Uint8Array
 * - token_receiver: Pubkey (32 bytes) as Uint8Array
 * - token_amounts: array of Any2SVMTokenTransfer
 * - extra_args: Any2SVMRampExtraArgs
 */
class Any2SVMRampMessage {
  header: RampMessageHeader
  sender: Uint8Array
  data: Uint8Array
  token_receiver: Uint8Array
  token_amounts: Any2SVMTokenTransfer[]
  extra_args: Any2SVMRampExtraArgs

  constructor(fields: {
    header: RampMessageHeader
    sender: Uint8Array
    data: Uint8Array
    token_receiver: Uint8Array
    token_amounts: Any2SVMTokenTransfer[]
    extra_args: Any2SVMRampExtraArgs
  }) {
    this.header = fields.header
    this.sender = fields.sender
    this.data = fields.data
    this.token_receiver = fields.token_receiver
    this.token_amounts = fields.token_amounts
    this.extra_args = fields.extra_args
  }
}

/**
 * ExecutionReportSingleChain
 * - source_chain_selector: u64 as BN
 * - message: Any2SVMRampMessage
 * - offchain_token_data: Vec<Vec<u8>> represented as an array of Uint8Array
 * - proofs: Vec<[u8; 32]> represented as an array of Uint8Array (each of length 32)
 */
class ExecutionReportSingleChain {
  source_chain_selector: BN
  message: Any2SVMRampMessage
  offchain_token_data: Uint8Array[]
  proofs: Uint8Array[]

  constructor(fields: {
    source_chain_selector: BN
    message: Any2SVMRampMessage
    offchain_token_data: Uint8Array[]
    proofs: Uint8Array[]
  }) {
    this.source_chain_selector = fields.source_chain_selector
    this.message = fields.message
    this.offchain_token_data = fields.offchain_token_data
    this.proofs = fields.proofs
  }
}

// Borsh schema definitions for each type:

const RampMessageHeaderSchema = new Map([
  [
    RampMessageHeader,
    {
      kind: 'struct',
      fields: [
        ['message_id', [32]],
        ['source_chain_selector', 'u64'],
        ['dest_chain_selector', 'u64'],
        ['sequence_number', 'u64'],
        ['nonce', 'u64'],
      ],
    },
  ],
])

const Any2SVMRampExtraArgsSchema = new Map([
  [
    Any2SVMRampExtraArgs,
    {
      kind: 'struct',
      fields: [
        ['compute_units', 'u32'],
        ['is_writable_bitmap', 'u64'],
      ],
    },
  ],
])

const CrossChainAmountSchema = new Map([
  [
    CrossChainAmount,
    {
      kind: 'struct',
      fields: [['le_bytes', [32]]],
    },
  ],
])

const Any2SVMTokenTransferSchema = new Map([
  [
    Any2SVMTokenTransfer,
    {
      kind: 'struct',
      fields: [
        ['source_pool_address', ['u8']], // variable-length vector of u8
        ['dest_token_address', [32]], // fixed 32 bytes Pubkey
        ['dest_gas_amount', 'u32'],
        ['extra_data', ['u8']], // variable-length vector of u8
        ['amount', CrossChainAmount],
      ],
    },
  ],
])

const Any2SVMRampMessageSchema = new Map([
  [
    Any2SVMRampMessage,
    {
      kind: 'struct',
      fields: [
        ['header', RampMessageHeader],
        ['sender', ['u8']],
        ['data', ['u8']],
        ['token_receiver', [32]],
        ['token_amounts', [Any2SVMTokenTransfer]],
        ['extra_args', Any2SVMRampExtraArgs],
      ],
    },
  ],
])

const ExecutionReportSingleChainSchema = new Map([
  [
    ExecutionReportSingleChain,
    {
      kind: 'struct',
      fields: [
        ['source_chain_selector', 'u64'],
        ['message', Any2SVMRampMessage],
        ['offchain_token_data', [['u8']]], // vector of variable-length byte arrays
        ['proofs', [[32]]], // vector of 32-byte arrays
      ],
    },
  ],
])

const schema: Schema = new Map([
  ...RampMessageHeaderSchema,
  ...Any2SVMRampExtraArgsSchema,
  ...CrossChainAmountSchema,
  ...Any2SVMTokenTransferSchema,
  ...Any2SVMRampMessageSchema,
  ...ExecutionReportSingleChainSchema
])

/**
 * Encodes an ExecutionReportSingleChain instance into a Buffer.
 *
 * @param report The ExecutionReportSingleChain instance to encode.
 * @returns A Buffer containing the serialized report.
 */
function encodeExecutionReportSingleChain(report: ExecutionReportSingleChain): Buffer {
  return Buffer.from(serialize(schema, report))
}

export const getV16SolanaLeafHasher =
  (
    sourceChainSelector: bigint,
    destChainSelector: bigint,
    onRamp: string,
  ): LeafHasher<typeof CCIPVersion.V1_6> =>
  (message: CCIPMessage<typeof CCIPVersion.V1_6>): string =>
    hashSolanaMessage(message, hashSolanaMetadata(sourceChainSelector, destChainSelector, onRamp))

// --- Helper: convert a hex string to Uint8Array ---
function hexStringToUint8Array(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2)
  const bytes = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16))
  }
  return new Uint8Array(bytes)
}

// --- Conversion from CCIPMessage (V1_6) to Any2SVMRampMessage ---
// Adjust the field mappings if your actual CCIPMessage differs.
function convertCCIPMessageToRampMessage(
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
): Any2SVMRampMessage {
  // Create the header.
  const header = new RampMessageHeader({
    // Expecting a hex string for messageId.
    message_id: hexStringToUint8Array(message.header.messageId),
    // Convert the chain selector and numeric fields using BN.
    source_chain_selector: new BN(message.header.sourceChainSelector.toString()),
    // If the dest chain selector is not in the header, you can set it to a default (or update this conversion)
    dest_chain_selector: new BN(0),
    sequence_number: new BN(message.header.sequenceNumber.toString()),
    nonce: new BN(message.header.nonce.toString()),
  })

  // Assume sender and data are given as hex strings; if not, adjust accordingly.
  const sender = message.sender ? hexStringToUint8Array(message.sender) : new Uint8Array()
  const data = message.data ? hexStringToUint8Array(message.data) : new Uint8Array()

  // Convert tokenReceiver string to a PublicKey buffer.
  const token_receiver = new PublicKey(message.receiver).toBuffer()

  // Map tokenAmounts (each of type SourceTokenData merged with additional fields).
  const token_amounts = message.tokenAmounts.map((token) => {
    // Handle the destTokenAddress - could be a hex string (Ethereum address) or base58 (Solana address)
    let dest_token_address: Uint8Array
    try {
      // Try as Solana address first
      dest_token_address = new PublicKey(token.destTokenAddress).toBuffer()
    } catch {
      // If that fails, try as hex string (Ethereum address)
      if (token.destTokenAddress.startsWith('0x')) {
        dest_token_address = hexStringToUint8Array(token.destTokenAddress)
        // Pad to 32 bytes if needed
        if (dest_token_address.length < 32) {
          const paddedArray = new Uint8Array(32)
          paddedArray.set(dest_token_address, 32 - dest_token_address.length)
          dest_token_address = paddedArray
        }
      } else {
        // If all else fails, use empty array
        dest_token_address = new Uint8Array(32)
      }
    }

    return new Any2SVMTokenTransfer({
      source_pool_address: token.sourcePoolAddress
        ? hexStringToUint8Array(token.sourcePoolAddress)
        : new Uint8Array(),
      dest_token_address,
      dest_gas_amount: Number(token.destGasAmount),
      extra_data: token.extraData ? hexStringToUint8Array(token.extraData) : new Uint8Array(),
      // For the CrossChainAmount, assume token.amount is a hex string representing 32 bytes.
      amount: new CrossChainAmount({
        le_bytes: hexStringToUint8Array(token.amount.toString(16)),
      }),
    })
  })

  // Map gasLimit into the extra_args.compute_units (and set bitmap to 0 by default).
  const extra_args = new Any2SVMRampExtraArgs({
    compute_units: Number(message.gasLimit),
    is_writable_bitmap: new BN(0),
  })

  return new Any2SVMRampMessage({
    header,
    sender,
    data,
    token_receiver,
    token_amounts,
    extra_args,
  })
}

/**
 * hashSolanaMessage uses the internal encoder (encodeExecutionReportSingleChain)
 * to serialize a report containing the CCIP message and then combines it with
 * the metadata hash.
 *
 * @param message - the CCIPMessage (V1_6) to hash.
 * @param metadataHash - a hex string computed by hashSolanaMetadata.
 * @returns a hex string representing the final hash.
 */
export const hashSolanaMessage = (
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  metadataHash: string,
): string => {
  // Convert the CCIPMessage to our internal RampMessage.
  const rampMessage = convertCCIPMessageToRampMessage(message)

  // Create an ExecutionReportSingleChain.
  // Here we set offchain_token_data and proofs to empty arrays.
  // Note: the source_chain_selector is taken from the message header.
  const report = new ExecutionReportSingleChain({
    source_chain_selector: new BN(message.header.sourceChainSelector.toString()),
    message: rampMessage,
    offchain_token_data: [],
    proofs: [],
  })

  // Encode the report.
  const encodedReport = encodeExecutionReportSingleChain(report)

  // Combine the metadata hash (expected as hex) with the encoded report bytes.
  const combined = Buffer.concat([Buffer.from(metadataHash, 'hex'), encodedReport])

  // Compute the SHA-256 hash of the combination.
  const finalHash = createHash('sha256').update(combined).digest('hex')

  return finalHash
}

export const hashSolanaMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  // Convert bigint to BN safely.
  const sourceChainSelectorBN = new BN(sourceChainSelector.toString())
  const destChainSelectorBN = new BN(destChainSelector.toString())

  // Create a minimal RampMessageHeader using provided selectors.
  const header = new RampMessageHeader({
    message_id: new Uint8Array(32), // All zeros for a deterministic value.
    source_chain_selector: sourceChainSelectorBN,
    dest_chain_selector: destChainSelectorBN,
    sequence_number: new BN(0), // Default to 0; adjust as needed.
    nonce: new BN(0), // Default to 0; adjust as needed.
  })

  // Create dummy extra arguments.
  const extra_args = new Any2SVMRampExtraArgs({
    compute_units: 0, // Default value.
    is_writable_bitmap: new BN(0), // Default value.
  })

  // Create a minimal RampMessage.
  const rampMessage = new Any2SVMRampMessage({
    header,
    sender: new Uint8Array(), // No sender data.
    data: new Uint8Array(), // No additional message data.
    token_receiver: new PublicKey(onRamp).toBuffer(), // Convert the onRamp string to a PublicKey buffer.
    token_amounts: [], // No token transfers.
    extra_args,
  })

  // Create the ExecutionReportSingleChain with minimal offchain data and proofs.
  const report = new ExecutionReportSingleChain({
    source_chain_selector: sourceChainSelectorBN,
    message: rampMessage,
    offchain_token_data: [], // Empty offchain token data.
    proofs: [], // No proofs.
  })

  // Encode the report using the Borsh encoder.
  const encoded = encodeExecutionReportSingleChain(report)

  // Compute the SHA-256 hash of the encoded report.
  const hash = createHash('sha256').update(encoded).digest('hex')
  return hash
}
