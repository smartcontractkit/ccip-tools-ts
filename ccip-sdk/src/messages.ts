import { type BytesLike, dataSlice, hexlify, toBigInt, toNumber } from 'ethers'

import { CCIPMessageDecodeError } from './errors/index.ts'
import { type FinalityRequested, decodeFinalityRequested } from './extra-args.ts'
import { networkInfo } from './networks.ts'
import { decodeAddress, getDataBytes } from './utils.ts'

/** Token transfer in MessageV1 format. */
export type TokenTransferV1 = {
  amount: bigint
  sourcePoolAddress: string
  sourceTokenAddress: string
  destTokenAddress: string
  tokenReceiver: string
  extraData: string
}

/** MessageV1 struct matching the Solidity MessageV1Codec format. */
export type MessageV1 = {
  sourceChainSelector: bigint
  destChainSelector: bigint
  messageNumber: bigint
  executionGasLimit: number
  ccipReceiveGasLimit: number
  finality: FinalityRequested
  ccvAndExecutorHash: string
  onRampAddress: string
  offRampAddress: string
  sender: string
  receiver: string
  destBlob: string
  tokenTransfer: readonly TokenTransferV1[]
  data: string
}

/** Renders a MessageV1 address field, given as hex, from the source or the dest chain. */
type AddressDecoder = (address: string, chain: 'source' | 'dest') => string

/**
 * Decodes a TokenTransferV1 from bytes.
 * @param encoded - The encoded bytes.
 * @param offset - The starting offset.
 * @param decodeAddr - Renders the source and dest addresses.
 * @returns The decoded token transfer and the new offset.
 */
function decodeTokenTransferV1(
  encoded: Uint8Array,
  offset: number,
  decodeAddr: AddressDecoder,
): { tokenTransfer: TokenTransferV1; newOffset: number } {
  // version (1 byte)
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('TOKEN_TRANSFER_VERSION')
  const version = encoded[offset++]!
  if (version !== 1) throw new CCIPMessageDecodeError(`Invalid encoding version: ${version}`)

  // amount (32 bytes)
  if (offset + 32 > encoded.length) throw new CCIPMessageDecodeError('TOKEN_TRANSFER_AMOUNT')
  const amount = toBigInt(dataSlice(encoded, offset, offset + 32))
  offset += 32

  // sourcePoolAddressLength and sourcePoolAddress
  if (offset >= encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_SOURCE_POOL_LENGTH')
  }
  const sourcePoolAddressLength = encoded[offset++]!
  if (offset + sourcePoolAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_SOURCE_POOL_CONTENT')
  }
  const sourcePoolAddress = decodeAddr(
    dataSlice(encoded, offset, offset + sourcePoolAddressLength),
    'source',
  )
  offset += sourcePoolAddressLength

  // sourceTokenAddressLength and sourceTokenAddress
  if (offset >= encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_SOURCE_TOKEN_LENGTH')
  }
  const sourceTokenAddressLength = encoded[offset++]!
  if (offset + sourceTokenAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_SOURCE_TOKEN_CONTENT')
  }
  const sourceTokenAddress = decodeAddr(
    dataSlice(encoded, offset, offset + sourceTokenAddressLength),
    'source',
  )
  offset += sourceTokenAddressLength

  // destTokenAddressLength and destTokenAddress
  if (offset >= encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_DEST_TOKEN_LENGTH')
  }
  const destTokenAddressLength = encoded[offset++]!
  if (offset + destTokenAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_DEST_TOKEN_CONTENT')
  }
  const destTokenAddress = decodeAddr(
    dataSlice(encoded, offset, offset + destTokenAddressLength),
    'dest',
  )
  offset += destTokenAddressLength

  // tokenReceiverLength and tokenReceiver
  if (offset >= encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_TOKEN_RECEIVER_LENGTH')
  }
  const tokenReceiverLength = encoded[offset++]!
  if (offset + tokenReceiverLength > encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_TOKEN_RECEIVER_CONTENT')
  }
  const tokenReceiver = decodeAddr(dataSlice(encoded, offset, offset + tokenReceiverLength), 'dest')
  offset += tokenReceiverLength

  // extraDataLength and extraData
  if (offset + 2 > encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_EXTRA_DATA_LENGTH')
  }
  const extraDataLength = toNumber(dataSlice(encoded, offset, offset + 2))
  offset += 2
  if (offset + extraDataLength > encoded.length) {
    throw new CCIPMessageDecodeError('TOKEN_TRANSFER_EXTRA_DATA_CONTENT')
  }
  const extraData = hexlify(dataSlice(encoded, offset, offset + extraDataLength))
  offset += extraDataLength

  return {
    tokenTransfer: {
      amount,
      sourcePoolAddress,
      sourceTokenAddress,
      destTokenAddress,
      tokenReceiver,
      extraData,
    },
    newOffset: offset,
  }
}

/**
 * Decodes a MessageV1 from bytes following the v1 protocol format.
 * @param encodedMessage - The encoded message bytes to decode.
 * @returns The decoded MessageV1 struct.
 */
export function decodeMessageV1(encodedMessage: BytesLike): MessageV1 {
  return parseMessageV1(encodedMessage, (sourceChainSelector, destChainSelector) => {
    const families = {
      source: networkInfo(sourceChainSelector).family,
      dest: networkInfo(destChainSelector).family,
    }
    return (address, chain) => decodeAddress(address, families[chain])
  })
}

/**
 * Decodes a MessageV1 like {@link decodeMessageV1}, but leaves every address as the raw hex bytes
 * the message encodes, instead of rendering it in its chain family's format (which normalizes,
 * e.g. a left-padded EVM address to 20 bytes). For passing fields back onchain byte for byte.
 * @param encodedMessage - The encoded message bytes to decode.
 * @returns The decoded MessageV1 struct, with 0x-hex addresses.
 */
export function decodeMessageV1Raw(encodedMessage: BytesLike): MessageV1 {
  return parseMessageV1(encodedMessage, () => (address) => address)
}

function parseMessageV1(
  encodedMessage: BytesLike,
  addressDecoder: (sourceChainSelector: bigint, destChainSelector: bigint) => AddressDecoder,
): MessageV1 {
  const MESSAGE_V1_BASE_SIZE = 79
  const encoded = getDataBytes(encodedMessage)

  if (encoded.length < MESSAGE_V1_BASE_SIZE) throw new CCIPMessageDecodeError('MESSAGE_MIN_SIZE')

  const version = encoded[0]!
  if (version !== 1) throw new CCIPMessageDecodeError(`Invalid encoding version: ${version}`)

  // sourceChainSelector (8 bytes, big endian)
  const sourceChainSelector = toBigInt(dataSlice(encoded, 1, 9))

  // destChainSelector (8 bytes, big endian)
  const destChainSelector = toBigInt(dataSlice(encoded, 9, 17))

  const decodeAddr = addressDecoder(sourceChainSelector, destChainSelector)

  // messageNumber (8 bytes, big endian)
  const messageNumber = toBigInt(dataSlice(encoded, 17, 25))

  // executionGasLimit (4 bytes, big endian)
  const executionGasLimit = toNumber(dataSlice(encoded, 25, 29))

  // ccipReceiveGasLimit (4 bytes, big endian)
  const ccipReceiveGasLimit = toNumber(dataSlice(encoded, 29, 33))

  // finality (4 bytes, big endian)
  const finality = decodeFinalityRequested(toNumber(dataSlice(encoded, 33, 37)))

  // ccvAndExecutorHash (32 bytes)
  const ccvAndExecutorHash = hexlify(dataSlice(encoded, 37, 69))

  // onRampAddressLength and onRampAddress
  let offset = 69
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_ONRAMP_ADDRESS_LENGTH')
  const onRampAddressLength = encoded[offset++]!
  if (offset + onRampAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_ONRAMP_ADDRESS_CONTENT')
  }
  const onRampAddress = decodeAddr(
    dataSlice(encoded, offset, offset + onRampAddressLength),
    'source',
  )
  offset += onRampAddressLength

  // offRampAddressLength and offRampAddress
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_OFFRAMP_ADDRESS_LENGTH')
  const offRampAddressLength = encoded[offset++]!
  if (offset + offRampAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_OFFRAMP_ADDRESS_CONTENT')
  }
  const offRampAddress = decodeAddr(
    dataSlice(encoded, offset, offset + offRampAddressLength),
    'dest',
  )
  offset += offRampAddressLength

  // senderLength and sender
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_SENDER_LENGTH')
  const senderLength = encoded[offset++]!
  if (offset + senderLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_SENDER_CONTENT')
  }
  const sender = decodeAddr(dataSlice(encoded, offset, offset + senderLength), 'source')
  offset += senderLength

  // receiverLength and receiver
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_RECEIVER_LENGTH')
  const receiverLength = encoded[offset++]!
  if (offset + receiverLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_RECEIVER_CONTENT')
  }
  const receiver = decodeAddr(dataSlice(encoded, offset, offset + receiverLength), 'dest')
  offset += receiverLength

  // destBlobLength and destBlob
  if (offset + 2 > encoded.length) throw new CCIPMessageDecodeError('MESSAGE_DEST_BLOB_LENGTH')
  const destBlobLength = toNumber(dataSlice(encoded, offset, offset + 2))
  offset += 2
  if (offset + destBlobLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_DEST_BLOB_CONTENT')
  }
  const destBlob = hexlify(dataSlice(encoded, offset, offset + destBlobLength))
  offset += destBlobLength

  // tokenTransferLength and tokenTransfer
  if (offset + 2 > encoded.length) throw new CCIPMessageDecodeError('MESSAGE_TOKEN_TRANSFER_LENGTH')
  const tokenTransferLength = toNumber(dataSlice(encoded, offset, offset + 2))
  offset += 2

  // Decode token transfer, which is either 0 or 1
  const tokenTransfer: TokenTransferV1[] = []
  if (tokenTransferLength > 0) {
    const expectedEnd = offset + tokenTransferLength
    const result = decodeTokenTransferV1(encoded, offset, decodeAddr)
    tokenTransfer.push(result.tokenTransfer)
    offset = result.newOffset
    if (offset !== expectedEnd) throw new CCIPMessageDecodeError('MESSAGE_TOKEN_TRANSFER_CONTENT')
  }

  // dataLength and data
  if (offset + 2 > encoded.length) throw new CCIPMessageDecodeError('MESSAGE_DATA_LENGTH')
  const dataLength = toNumber(dataSlice(encoded, offset, offset + 2))
  offset += 2
  if (offset + dataLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_DATA_CONTENT')
  }
  const data = hexlify(dataSlice(encoded, offset, offset + dataLength))
  offset += dataLength

  // Ensure we've consumed all bytes
  if (offset !== encoded.length) throw new CCIPMessageDecodeError('MESSAGE_FINAL_OFFSET')

  return {
    sourceChainSelector,
    destChainSelector,
    messageNumber,
    executionGasLimit,
    ccipReceiveGasLimit,
    finality,
    ccvAndExecutorHash,
    onRampAddress,
    offRampAddress,
    sender,
    receiver,
    destBlob,
    tokenTransfer,
    data,
  }
}

/**
 * Read source/dest chain selectors from a MessageV1 payload without full decoding.
 * Useful when Canton ledger events omit `sourceChainSelector` in the Created event view.
 */
export function readMessageV1ChainSelectors(encodedMessage: BytesLike): {
  sourceChainSelector: bigint
  destChainSelector: bigint
} {
  const encoded = getDataBytes(encodedMessage)
  if (encoded.length < 17) throw new CCIPMessageDecodeError('MESSAGE_MIN_SIZE')
  return {
    sourceChainSelector: toBigInt(dataSlice(encoded, 1, 9)),
    destChainSelector: toBigInt(dataSlice(encoded, 9, 17)),
  }
}

/** Read the source OnRamp address embedded in a MessageV1 payload. */
export function readMessageV1OnRampAddress(encodedMessage: BytesLike): string {
  const encoded = getDataBytes(encodedMessage)
  if (encoded.length < 71) throw new CCIPMessageDecodeError('MESSAGE_MIN_SIZE')
  const { sourceChainSelector } = readMessageV1ChainSelectors(encodedMessage)
  const sourceFamily = networkInfo(sourceChainSelector).family
  let offset = 69
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_ONRAMP_ADDRESS_LENGTH')
  const onRampAddressLength = encoded[offset++]!
  if (offset + onRampAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_ONRAMP_ADDRESS_CONTENT')
  }
  return decodeAddress(dataSlice(encoded, offset, offset + onRampAddressLength), sourceFamily)
}

/** Read the destination OffRamp address embedded in a MessageV1 payload. */
export function readMessageV1OffRampAddress(encodedMessage: BytesLike): string {
  const encoded = getDataBytes(encodedMessage)
  if (encoded.length < 71) throw new CCIPMessageDecodeError('MESSAGE_MIN_SIZE')
  const { destChainSelector } = readMessageV1ChainSelectors(encodedMessage)
  const destFamily = networkInfo(destChainSelector).family
  let offset = 69
  const onRampAddressLength = encoded[offset++]!
  offset += onRampAddressLength
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_OFFRAMP_ADDRESS_LENGTH')
  const offRampAddressLength = encoded[offset++]!
  if (offset + offRampAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_OFFRAMP_ADDRESS_CONTENT')
  }
  return decodeAddress(dataSlice(encoded, offset, offset + offRampAddressLength), destFamily)
}
