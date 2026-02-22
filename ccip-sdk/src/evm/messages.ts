import type {
  AbiParameterToPrimitiveType,
  AbiParametersToPrimitiveTypes,
  ExtractAbiEvent,
} from 'abitype'
import {
  type Addressable,
  type BytesLike,
  type Result,
  dataSlice,
  hexlify,
  toBigInt,
  toNumber,
} from 'ethers'
import type { Simplify } from 'type-fest'

import { CCIPMessageDecodeError } from '../errors/index.ts'
import type { EVMExtraArgsV2 } from '../extra-args.ts'
import type { CCIPVersion, ChainFamily, MergeArrayElements } from '../types.ts'
import { decodeAddress, getDataBytes, networkInfo } from '../utils.ts'
import type EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import type OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import type OnRamp_2_0_ABI from './abi/OnRamp_2_0.ts'
import { defaultAbiCoder } from './const.ts'

/** Utility type that cleans up address types to just `string`. */
export type CleanAddressable<T> = T extends string | Addressable
  ? string
  : T extends { [K: string]: unknown } | [...unknown[]]
    ? { [K in keyof T]: CleanAddressable<T[K]> }
    : T extends { readonly [K: string]: unknown } | readonly [...unknown[]]
      ? { readonly [K in keyof T]: CleanAddressable<T[K]> }
      : T

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
  finality: number
  ccvAndExecutorHash: string
  onRampAddress: string
  offRampAddress: string
  sender: string
  receiver: string
  destBlob: string
  tokenTransfer: readonly TokenTransferV1[]
  data: string
}

/**
 * Decodes a TokenTransferV1 from bytes.
 * @param encoded - The encoded bytes.
 * @param offset - The starting offset.
 * @param sourceFamily - The source chain family for source addresses.
 * @param destFamily - The destination chain family for dest addresses.
 * @returns The decoded token transfer and the new offset.
 */
function decodeTokenTransferV1(
  encoded: Uint8Array,
  offset: number,
  sourceFamily: ChainFamily,
  destFamily: ChainFamily,
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
  const sourcePoolAddress = decodeAddress(
    dataSlice(encoded, offset, offset + sourcePoolAddressLength),
    sourceFamily,
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
  const sourceTokenAddress = decodeAddress(
    dataSlice(encoded, offset, offset + sourceTokenAddressLength),
    sourceFamily,
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
  const destTokenAddress = decodeAddress(
    dataSlice(encoded, offset, offset + destTokenAddressLength),
    destFamily,
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
  const tokenReceiver = decodeAddress(
    dataSlice(encoded, offset, offset + tokenReceiverLength),
    destFamily,
  )
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
  const MESSAGE_V1_BASE_SIZE = 77
  const encoded = getDataBytes(encodedMessage)

  if (encoded.length < MESSAGE_V1_BASE_SIZE) throw new CCIPMessageDecodeError('MESSAGE_MIN_SIZE')

  const version = encoded[0]!
  if (version !== 1) throw new CCIPMessageDecodeError(`Invalid encoding version: ${version}`)

  // sourceChainSelector (8 bytes, big endian)
  const sourceChainSelector = toBigInt(dataSlice(encoded, 1, 9))

  // destChainSelector (8 bytes, big endian)
  const destChainSelector = toBigInt(dataSlice(encoded, 9, 17))

  // Get chain families for address decoding
  const sourceNetworkInfo = networkInfo(sourceChainSelector)
  const destNetworkInfo = networkInfo(destChainSelector)
  const sourceFamily = sourceNetworkInfo.family
  const destFamily = destNetworkInfo.family

  // messageNumber (8 bytes, big endian)
  const messageNumber = toBigInt(dataSlice(encoded, 17, 25))

  // executionGasLimit (4 bytes, big endian)
  const executionGasLimit = toNumber(dataSlice(encoded, 25, 29))

  // ccipReceiveGasLimit (4 bytes, big endian)
  const ccipReceiveGasLimit = toNumber(dataSlice(encoded, 29, 33))

  // finality (2 bytes, big endian)
  const finality = toNumber(dataSlice(encoded, 33, 35))

  // ccvAndExecutorHash (32 bytes)
  const ccvAndExecutorHash = hexlify(dataSlice(encoded, 35, 67))

  // onRampAddressLength and onRampAddress
  let offset = 67
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_ONRAMP_ADDRESS_LENGTH')
  const onRampAddressLength = encoded[offset++]!
  if (offset + onRampAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_ONRAMP_ADDRESS_CONTENT')
  }
  const onRampAddress = decodeAddress(
    dataSlice(encoded, offset, offset + onRampAddressLength),
    sourceFamily,
  )
  offset += onRampAddressLength

  // offRampAddressLength and offRampAddress
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_OFFRAMP_ADDRESS_LENGTH')
  const offRampAddressLength = encoded[offset++]!
  if (offset + offRampAddressLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_OFFRAMP_ADDRESS_CONTENT')
  }
  const offRampAddress = decodeAddress(
    dataSlice(encoded, offset, offset + offRampAddressLength),
    destFamily,
  )
  offset += offRampAddressLength

  // senderLength and sender
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_SENDER_LENGTH')
  const senderLength = encoded[offset++]!
  if (offset + senderLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_SENDER_CONTENT')
  }
  const sender = decodeAddress(dataSlice(encoded, offset, offset + senderLength), sourceFamily)
  offset += senderLength

  // receiverLength and receiver
  if (offset >= encoded.length) throw new CCIPMessageDecodeError('MESSAGE_RECEIVER_LENGTH')
  const receiverLength = encoded[offset++]!
  if (offset + receiverLength > encoded.length) {
    throw new CCIPMessageDecodeError('MESSAGE_RECEIVER_CONTENT')
  }
  const receiver = decodeAddress(dataSlice(encoded, offset, offset + receiverLength), destFamily)
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
    const result = decodeTokenTransferV1(encoded, offset, sourceFamily, destFamily)
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

// v1.2-v1.5 Message ()
type EVM2AnyMessageRequested = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof EVM2EVMOnRamp_1_5_ABI, 'CCIPSendRequested'>['inputs']
  >[0]
>

type CCIPMessageSent = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof OnRamp_1_6_ABI, 'CCIPMessageSent'>['inputs']
  >[2]
>

/**
 * v1.6+ Message Base type (all other destinations share this intersection).
 * `header` is merged to message root, for consistency.
 */
export type CCIPMessage_V1_6 = MergeArrayElements<
  Omit<CCIPMessageSent, 'header'>,
  CCIPMessageSent['header'] & { tokenAmounts: readonly SourceTokenData[] }
>

/** CCIP v1.5 EVM message type. */
export type CCIPMessage_V1_5_EVM = MergeArrayElements<
  EVM2AnyMessageRequested,
  { tokenAmounts: readonly SourceTokenData[] }
>

/** CCIP v1.2 EVM message type. */
export type CCIPMessage_V1_2_EVM = EVM2AnyMessageRequested

/** v1.6 EVM specialization with EVMExtraArgsV2 and tokenAmounts.*.destGasAmount. */
export type CCIPMessage_V1_6_EVM = CCIPMessage_V1_6 & EVMExtraArgsV2

type MessageSentV2EventParams = ExtractAbiEvent<typeof OnRamp_2_0_ABI, 'CCIPMessageSent'>['inputs']
type CCIPMessageSentV2 = {
  [N in MessageSentV2EventParams[number]['name']]: CleanAddressable<
    AbiParameterToPrimitiveType<MessageSentV2EventParams[number] & { readonly name: N }>
  >
}

/**
 * CCIP v2.0 (fka v1.7) Message
 */
export type CCIPMessage_V2_0 = Simplify<
  CCIPMessageSentV2 &
    Omit<MessageV1, 'tokenTransfer'> & {
      tokenAmounts: MessageV1['tokenTransfer']
      sequenceNumber: MessageV1['messageNumber']
      feeTokenAmount: bigint
    }
>

/** Union type for CCIP EVM messages across versions. */
export type CCIPMessage_EVM<V extends CCIPVersion = CCIPVersion> = V extends typeof CCIPVersion.V2_0
  ? CCIPMessage_V2_0
  : V extends typeof CCIPVersion.V1_6
    ? CCIPMessage_V1_6_EVM
    : V extends typeof CCIPVersion.V1_5
      ? CCIPMessage_V1_5_EVM
      : V extends typeof CCIPVersion.V1_2
        ? CCIPMessage_V1_2_EVM
        : never

const SourceTokenData =
  'tuple(bytes sourcePoolAddress, bytes destTokenAddress, bytes extraData, uint64 destGasAmount)'
/** Token transfer data in a CCIP message. */
export type SourceTokenData = {
  sourcePoolAddress: string
  destTokenAddress: string
  extraData: string
  destGasAmount: bigint
}

/**
 * Parses v1.5 and earlier `message.sourceTokenData`.
 * Version 1.6+ already contains this in `message.tokenAmounts`.
 * @param data - The source token data string to parse.
 * @returns The parsed SourceTokenData object.
 */
export function parseSourceTokenData(data: string): SourceTokenData {
  const decoded = defaultAbiCoder.decode([SourceTokenData], data)
  return (decoded[0] as Result).toObject() as SourceTokenData
}
