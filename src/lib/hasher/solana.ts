import { keccak256 } from 'js-sha3'
import type { CCIPMessage, CCIPVersion } from '../types.ts'
import type { LeafHasher } from './common.ts'

// Message types from https://github.com/smartcontractkit/chainlink-ccip/blob/main/chains/solana/contracts/programs/ccip-offramp/src/messages.rs
/**
 * RampMessageHeader
 * - messageId: fixed 32 bytes array as hex string
 * - sourceChainSelector, destChainSelector, sequenceNumber, nonce: u64 values as bigint
 */
class RampMessageHeader {
  messageId: string
  sourceChainSelector: bigint
  destChainSelector: bigint
  sequenceNumber: bigint
  nonce: bigint

  constructor(fields: {
    messageId: string
    sourceChainSelector: bigint
    destChainSelector: bigint
    sequenceNumber: bigint
    nonce: bigint
  }) {
    this.messageId = fields.messageId
    this.sourceChainSelector = fields.sourceChainSelector
    this.destChainSelector = fields.destChainSelector
    this.sequenceNumber = fields.sequenceNumber
    this.nonce = fields.nonce
  }
}

/**
 * Any2SVMRampExtraArgs
 * - computeUnits: u32
 * - isWritableBitmap: u64 as bigint
 */
class Any2SVMRampExtraArgs {
  computeUnits: number
  isWritableBitmap: bigint

  constructor(fields: { computeUnits: number; isWritableBitmap: bigint }) {
    this.computeUnits = fields.computeUnits
    this.isWritableBitmap = fields.isWritableBitmap
  }
}

/**
 * Any2SVMTokenTransfer
 * - sourcePoolAddress: Vec<u8> as Uint8Array
 * - destTokenAddress: Pubkey (32 bytes) as Uint8Array
 * - destGasAmount: u32
 * - extraData: Vec<u8> as Uint8Array
 * - amount: u256 as bigint
 */
class Any2SVMTokenTransfer {
  sourcePoolAddress: Uint8Array
  destTokenAddress: Uint8Array
  destGasAmount: number
  extraData: Uint8Array
  amount: bigint

  constructor(fields: {
    sourcePoolAddress: Uint8Array
    destTokenAddress: Uint8Array
    destGasAmount: number
    extraData: Uint8Array
    amount: bigint
  }) {
    this.sourcePoolAddress = fields.sourcePoolAddress
    this.destTokenAddress = fields.destTokenAddress
    this.destGasAmount = fields.destGasAmount
    this.extraData = fields.extraData
    this.amount = fields.amount
  }
}

/**
 * Any2SVMRampMessage
 * - header: RampMessageHeader
 * - sender: Vec<u8> as Uint8Array
 * - data: Vec<u8> as Uint8Array
 * - tokenReceiver: Pubkey (32 bytes) as Uint8Array
 * - tokenAmounts: array of Any2SVMTokenTransfer
 * - extraArgs: Any2SVMRampExtraArgs
 */
class Any2SVMRampMessage {
  header: RampMessageHeader
  sender: Uint8Array
  data: Uint8Array
  tokenReceiver: Uint8Array
  tokenAmounts: Any2SVMTokenTransfer[]
  extraArgs: Any2SVMRampExtraArgs

  constructor(fields: {
    header: RampMessageHeader
    sender: Uint8Array
    data: Uint8Array
    tokenReceiver: Uint8Array
    tokenAmounts: Any2SVMTokenTransfer[]
    extraArgs: Any2SVMRampExtraArgs
  }) {
    this.header = fields.header
    this.sender = fields.sender
    this.data = fields.data
    this.tokenReceiver = fields.tokenReceiver
    this.tokenAmounts = fields.tokenAmounts
    this.extraArgs = fields.extraArgs
  }
}

/**
 * ExecutionReportSingleChain
 * - sourceChainSelector: u64 as bigint
 * - message: Any2SVMRampMessage
 * - offchainTokenData: Vec<Vec<u8>> represented as an array of Uint8Array
 * - proofs: Vec<[u8; 32]> represented as an array of Uint8Array (each of length 32)
 */
class ExecutionReportSingleChain {
  sourceChainSelector: bigint
  message: Any2SVMRampMessage
  offchainTokenData: Uint8Array[]
  proofs: Uint8Array[]

  constructor(fields: {
    sourceChainSelector: bigint
    message: Any2SVMRampMessage
    offchainTokenData: Uint8Array[]
    proofs: Uint8Array[]
  }) {
    this.sourceChainSelector = fields.sourceChainSelector
    this.message = fields.message
    this.offchainTokenData = fields.offchainTokenData
    this.proofs = fields.proofs
  }
}

// Helper function to convert bigint to little-endian bytes
function bigintToLeBytes(value: bigint, byteLength: number): Buffer {
  const buffer = Buffer.alloc(byteLength)
  let remaining = value
  for (let i = 0; i < byteLength; i++) {
    buffer[i] = Number(remaining & 0xffn)
    remaining = remaining >> 8n
  }
  return buffer
}

// Helper function to convert u256 to little-endian bytes (matching Go's ToLittleEndianU256)
function u256ToLeBytes(value: bigint): Buffer {
  const buffer = Buffer.alloc(32)
  let remaining = value
  for (let i = 0; i < 32; i++) {
    buffer[i] = Number(remaining & 0xffn)
    remaining = remaining >> 8n
  }
  return buffer
}

/**
 * Serializes an Any2SVMRampExtraArgs into a Buffer
 */
function serializeExtraArgs(extraArgs: Any2SVMRampExtraArgs): Buffer {
  const buffer = Buffer.alloc(12) // 4 bytes for compute_units + 8 bytes for is_writable_bitmap
  buffer.writeUInt32LE(extraArgs.computeUnits) // Changed to LE to match Go
  bigintToLeBytes(extraArgs.isWritableBitmap, 8).copy(buffer, 4)
  return buffer
}

/**
 * Serializes an Any2SVMRampMessage into a Buffer
 */
function serializeRampMessage(message: Any2SVMRampMessage): Buffer {
  const buffers: Buffer[] = []

  // Write header
  const headerBuffer = serializeHeader(message.header)
  buffers.push(headerBuffer)

  // Write sender length + data
  const senderSizeBuffer = Buffer.alloc(2)
  senderSizeBuffer.writeUInt16BE(message.sender.length)
  buffers.push(senderSizeBuffer)
  buffers.push(Buffer.from(message.sender))

  // Write data length + data
  const dataSizeBuffer = Buffer.alloc(2)
  dataSizeBuffer.writeUInt16BE(message.data.length)
  buffers.push(dataSizeBuffer)
  buffers.push(Buffer.from(message.data))

  // Write token receiver
  buffers.push(Buffer.from(message.tokenReceiver))

  // Write token amounts
  const tokenAmountsBuffer = serializeTokenAmounts(message.tokenAmounts)
  buffers.push(tokenAmountsBuffer)

  // Write extra args
  const extraArgsBuffer = serializeExtraArgs(message.extraArgs)
  buffers.push(extraArgsBuffer)

  return Buffer.concat(buffers)
}

function serializeHeader(header: RampMessageHeader): Buffer {
  const buffer = Buffer.alloc(32 + 8 * 4) // 32 bytes for message_id + 8 bytes each for 4 u64 values
  Buffer.from(header.messageId.replace('0x', ''), 'hex').copy(buffer, 0)
  bigintToLeBytes(header.sourceChainSelector, 8).copy(buffer, 32)
  bigintToLeBytes(header.destChainSelector, 8).copy(buffer, 40)
  bigintToLeBytes(header.sequenceNumber, 8).copy(buffer, 48)
  bigintToLeBytes(header.nonce, 8).copy(buffer, 56)
  return buffer
}

function serializeTokenAmounts(tokenAmounts: Any2SVMTokenTransfer[]): Buffer {
  const buffers: Buffer[] = []

  // Write array length
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32LE(tokenAmounts.length)
  buffers.push(lengthBuffer)

  // Write each token amount
  for (const token of tokenAmounts) {
    // Write source pool address length + data
    const sourcePoolAddressLen = Buffer.alloc(4)
    sourcePoolAddressLen.writeUInt32LE(token.sourcePoolAddress.length)
    buffers.push(sourcePoolAddressLen)
    buffers.push(Buffer.from(token.sourcePoolAddress))

    // Write dest token address
    buffers.push(Buffer.from(token.destTokenAddress))

    // Write dest gas amount
    const destGasAmountBuffer = Buffer.alloc(4)
    destGasAmountBuffer.writeUInt32LE(token.destGasAmount)
    buffers.push(destGasAmountBuffer)

    // Write extra data length + data
    const extraDataLen = Buffer.alloc(4)
    extraDataLen.writeUInt32LE(token.extraData.length)
    buffers.push(extraDataLen)
    buffers.push(Buffer.from(token.extraData))

    // Write amount as little-endian bytes (using u256ToLeBytes to match Go)
    buffers.push(u256ToLeBytes(token.amount))
  }

  return Buffer.concat(buffers)
}

function encodeExecutionReportSingleChain(report: ExecutionReportSingleChain): Buffer {
  const buffers: Buffer[] = []

  // Write source chain selector
  const sourceChainBuffer = bigintToLeBytes(report.sourceChainSelector, 8)
  buffers.push(sourceChainBuffer)

  // Write message
  const messageBuffer = serializeRampMessage(report.message)
  buffers.push(messageBuffer)

  // Write offchain token data length
  const tokenDataLengthBuffer = Buffer.alloc(4)
  tokenDataLengthBuffer.writeUInt32LE(report.offchainTokenData.length)
  buffers.push(tokenDataLengthBuffer)

  // Write offchain token data
  for (const tokenData of report.offchainTokenData) {
    buffers.push(Buffer.from(tokenData))
  }

  // Write proofs length
  const proofsLengthBuffer = Buffer.alloc(4)
  proofsLengthBuffer.writeUInt32LE(report.proofs.length)
  buffers.push(proofsLengthBuffer)

  // Write proofs
  for (const proof of report.proofs) {
    buffers.push(Buffer.from(proof))
  }

  return Buffer.concat(buffers)
}

// Helper function to convert a hex string to Uint8Array
function hexStringToUint8Array(hex: string): Uint8Array {
  const hexWithoutPrefix = hex.replace('0x', '')
  const buffer = Buffer.from(hexWithoutPrefix, 'hex')
  return new Uint8Array(buffer)
}

function parseExtraArgs(extraArgs: string): { computeUnits: number; isWritableBitmap: bigint } {
  // Remove '0x' prefix and the tag (0x1f3b3aba)
  const data = extraArgs.slice(10)

  // Parse the data according to the format:
  // - offset to the data (32 bytes)
  // - compute_units (32 bytes)
  // - array length (32 bytes)
  // - array data...
  const computeUnitsHex = data.slice(64, 128)
  const isWritableBitmapHex = data.slice(128, 192)

  // Parse compute units as a 32-bit number (little-endian)
  const computeUnits = parseInt(computeUnitsHex.slice(-8), 16)

  // Parse is_writable_bitmap as a 64-bit number (little-endian)
  const isWritableBitmap = BigInt(`0x${isWritableBitmapHex.slice(-16)}`)

  return {
    computeUnits,
    isWritableBitmap,
  }
}

function convertCCIPMessageToRampMessage(
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
): Any2SVMRampMessage {
  const header = new RampMessageHeader({
    messageId: message.header.messageId,
    sourceChainSelector: BigInt(message.header.sourceChainSelector.toString()),
    destChainSelector: BigInt(message.header.destChainSelector.toString()),
    sequenceNumber: BigInt(message.header.sequenceNumber.toString()),
    nonce: BigInt(message.header.nonce.toString()),
  })

  const sender = message.sender ? hexStringToUint8Array(message.sender) : new Uint8Array()
  const data = message.data ? hexStringToUint8Array(message.data) : new Uint8Array()

  // Validate receiver length
  const receiverHex = message.receiver.replace('0x', '')
  if (receiverHex.length !== 64) {
    throw new Error(`invalid receiver length: ${receiverHex.length}`)
  }
  const tokenReceiver = new Uint8Array(Buffer.from(receiverHex, 'hex'))

  const tokenAmounts = message.tokenAmounts.map((token) => {
    // Validate token address length
    const destTokenAddressHex = token.destTokenAddress.replace('0x', '')
    if (destTokenAddressHex.length !== 64) {
      throw new Error(`invalid DestTokenAddress length: ${destTokenAddressHex.length}`)
    }

    return new Any2SVMTokenTransfer({
      sourcePoolAddress: token.sourcePoolAddress
        ? hexStringToUint8Array(token.sourcePoolAddress)
        : new Uint8Array(),
      destTokenAddress: new Uint8Array(Buffer.from(destTokenAddressHex, 'hex')),
      destGasAmount: Number(token.destGasAmount),
      extraData: token.extraData ? hexStringToUint8Array(token.extraData) : new Uint8Array(),
      amount: BigInt(token.amount.toString()),
    })
  })

  const { computeUnits, isWritableBitmap } = parseExtraArgs(message.extraArgs)
  const extraArgs = new Any2SVMRampExtraArgs({
    computeUnits,
    isWritableBitmap,
  })

  return new Any2SVMRampMessage({
    header,
    sender,
    data,
    tokenReceiver,
    tokenAmounts,
    extraArgs,
  })
}

function hashAnyToSVMMessage(
  message: Any2SVMRampMessage,
  onRamp: string,
  msgAccounts: Uint8Array[] = [],
): Buffer {
  const buffers: Buffer[] = []

  // Write domain separator
  const domainSeparator = Buffer.alloc(32, 0)
  buffers.push(domainSeparator)

  // Write message type
  const messageType = Buffer.from('Any2SVMMessageHashV1')
  buffers.push(messageType)

  // Write source chain selector
  const sourceChainBuffer = bigintToLeBytes(message.header.sourceChainSelector, 8)
  buffers.push(sourceChainBuffer)

  // Write dest chain selector
  const destChainBuffer = bigintToLeBytes(message.header.destChainSelector, 8)
  buffers.push(destChainBuffer)

  // Write onRamp size and data
  const onRampData = Buffer.from(onRamp.replace('0x', ''), 'hex')
  const onRampSizeBuffer = Buffer.alloc(2)
  onRampSizeBuffer.writeUInt16BE(onRampData.length)
  buffers.push(onRampSizeBuffer)
  buffers.push(onRampData)

  // Write message ID
  const messageId = Buffer.from(message.header.messageId.replace('0x', ''), 'hex')
  buffers.push(messageId)

  // Write token receiver
  const tokenReceiver = Buffer.from(message.tokenReceiver)
  buffers.push(tokenReceiver)

  // Write sequence number
  const seqBuffer = bigintToLeBytes(message.header.sequenceNumber, 8)
  buffers.push(seqBuffer)

  // Write extra args
  const extraArgsBuffer = serializeExtraArgs(message.extraArgs)
  buffers.push(extraArgsBuffer)

  // Write nonce
  const nonceBuffer = bigintToLeBytes(message.header.nonce, 8)
  buffers.push(nonceBuffer)

  // Write sender size and data
  const senderSizeBuffer = Buffer.alloc(2)
  senderSizeBuffer.writeUInt16BE(message.sender.length)
  buffers.push(senderSizeBuffer)
  buffers.push(Buffer.from(message.sender))

  // Write data size and data
  const dataSizeBuffer = Buffer.alloc(2)
  dataSizeBuffer.writeUInt16BE(message.data.length)
  buffers.push(dataSizeBuffer)
  buffers.push(Buffer.from(message.data))

  // Write token amounts
  const tokenAmountsBuffer = serializeTokenAmounts(message.tokenAmounts)
  buffers.push(tokenAmountsBuffer)

  // Write message accounts
  for (const account of msgAccounts) {
    const accountBuffer = Buffer.from(account)
    buffers.push(accountBuffer)
  }

  // Use legacy Keccak-256 (same as Go's sha3.NewLegacyKeccak256())
  const combined = Buffer.concat(buffers)
  return Buffer.from(keccak256(combined), 'hex')
}

export const getV16SolanaLeafHasher =
  (
    sourceChainSelector: bigint,
    destChainSelector: bigint,
    onRamp: string,
  ): LeafHasher<typeof CCIPVersion.V1_6> =>
  (message: CCIPMessage<typeof CCIPVersion.V1_6>): string =>
    hashSolanaMessage(
      message,
      hashSolanaMetadata(message, sourceChainSelector, destChainSelector, onRamp),
    )

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
  const rampMessage = convertCCIPMessageToRampMessage(message)
  const report = new ExecutionReportSingleChain({
    sourceChainSelector: BigInt(message.header.sourceChainSelector.toString()),
    message: rampMessage,
    offchainTokenData: [],
    proofs: [],
  })

  const encodedReport = encodeExecutionReportSingleChain(report)
  const combined = Buffer.concat([Buffer.from(metadataHash, 'hex'), encodedReport])
  return keccak256(combined)
}

export const hashSolanaMetadata = (
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const header = new RampMessageHeader({
    messageId: message.header.messageId,
    sourceChainSelector: BigInt(sourceChainSelector.toString()),
    destChainSelector: BigInt(destChainSelector.toString()),
    sequenceNumber: BigInt(message.header.sequenceNumber.toString()),
    nonce: BigInt(message.header.nonce.toString()),
  })

  const extraArgs = new Any2SVMRampExtraArgs({
    computeUnits: 0,
    isWritableBitmap: BigInt(0),
  })

  const rampMessage = new Any2SVMRampMessage({
    header,
    sender: new Uint8Array(),
    data: new Uint8Array(),
    tokenReceiver: Buffer.from(onRamp.replace('0x', ''), 'hex'),
    tokenAmounts: [],
    extraArgs,
  })

  return hashAnyToSVMMessage(rampMessage, onRamp).toString('hex')
}
