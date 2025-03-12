// For reference implementation, see https://github.com/smartcontractkit/ccip/blob/ccip-develop/core/services/ocr2/plugins/ccip/hasher/leaf_hasher.go
import { concat, hexlify, id, keccak256, toBeHex, zeroPadValue } from 'ethers'

import {
  type AptosCCIPMessage,
  type CCIPMessage,
  type Lane,
  CCIPVersion,
  defaultAbiCoder,
} from '../types.js'

export const ZERO_HASH = hexlify(new Uint8Array(32).fill(0xff))

export type LeafHasher<V extends CCIPVersion = CCIPVersion> = (message: CCIPMessage<V>) => string
const INTERNAL_DOMAIN_SEPARATOR = toBeHex(1, 32)

/**
 * Computes the Keccak-256 hash of the concatenation of two hash values.
 * @param a The first hash as a Hash type.
 * @param b The second hash as a Hash type.
 * @returns The Keccak-256 hash result as a Hash type.
 */
export function hashInternal(a: string, b: string): string {
  if (a > b) {
    ;[a, b] = [b, a]
  }
  const combinedData = concat([INTERNAL_DOMAIN_SEPARATOR, a, b])
  return keccak256(combinedData)
}

const LEAF_DOMAIN_SEPARATOR = '0x00'
const METADATA_PREFIX_1_2 = id('EVM2EVMMessageHashV2')
function getV12LeafHasher(
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): LeafHasher<CCIPVersion.V1_2 | CCIPVersion.V1_5> {
  const metadataHash = keccak256(
    concat([
      METADATA_PREFIX_1_2,
      toBeHex(sourceChainSelector, 32),
      toBeHex(destChainSelector, 32),
      zeroPadValue(onRamp, 32),
    ]),
  )

  return (message: CCIPMessage<CCIPVersion.V1_2 | CCIPVersion.V1_5>): string => {
    const encodedTokens = defaultAbiCoder.encode(
      ['tuple(address token, uint256 amount)[]'],
      [message.tokenAmounts],
    )

    const encodedSourceTokenData = defaultAbiCoder.encode(['bytes[]'], [message.sourceTokenData])

    const fixedSizeValues = defaultAbiCoder.encode(
      [
        'address sender',
        'address receiver',
        'uint64 sequenceNumber',
        'uint256 gasLimit',
        'bool strict',
        'uint64 nonce',
        'address feeToken',
        'uint256 feeTokenAmount',
      ],
      [
        message.sender,
        message.receiver,
        message.sequenceNumber,
        message.gasLimit,
        message.strict,
        message.nonce,
        message.feeToken,
        message.feeTokenAmount,
      ],
    )

    const fixedSizeValuesHash = keccak256(fixedSizeValues)

    const packedValues = defaultAbiCoder.encode(
      [
        'bytes1 leafDomainSeparator',
        'bytes32 metadataHash',
        'bytes32 fixedSizeValuesHash',
        'bytes32 dataHash',
        'bytes32 tokenAmountsHash',
        'bytes32 sourceTokenDataHash',
      ],
      [
        LEAF_DOMAIN_SEPARATOR,
        metadataHash,
        fixedSizeValuesHash,
        keccak256(message.data),
        keccak256(encodedTokens),
        keccak256(encodedSourceTokenData),
      ],
    )

    return keccak256(packedValues)
  }
}

const ANY_2_EVM_MESSAGE_HASH = id('Any2EVMMessageHashV1')
function getV16LeafHasher(
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): LeafHasher<CCIPVersion.V1_6> {
  const metadataInput = concat([
    ANY_2_EVM_MESSAGE_HASH,
    toBeHex(sourceChainSelector, 32),
    toBeHex(destChainSelector, 32),
    keccak256(zeroPadValue(onRamp, 32)),
  ])

  return (message: CCIPMessage<CCIPVersion.V1_6>): string => {
    const encodedTokens = defaultAbiCoder.encode(
      [
        'tuple(bytes sourcePoolAddress, address destTokenAddress, uint32 destGasAmount, bytes extraData, uint256 amount)[]',
      ],
      [message.tokenAmounts],
    )

    const fixedSizeValues = defaultAbiCoder.encode(
      [
        'bytes32 messageId',
        'address receiver',
        'uint64 sequenceNumber',
        'uint256 gasLimit',
        'uint64 nonce',
      ],
      [
        message.header.messageId,
        message.receiver,
        message.header.sequenceNumber,
        message.gasLimit,
        message.header.nonce,
      ],
    )

    const packedValues = defaultAbiCoder.encode(
      [
        'bytes32 leafDomainSeparator',
        'bytes32 metadataHash',
        'bytes32 fixedSizeValuesHash',
        'bytes32 sender',
        'bytes32 dataHash',
        'bytes32 tokenAmountsHash',
      ],
      [
        zeroPadValue(LEAF_DOMAIN_SEPARATOR, 32),
        keccak256(metadataInput),
        keccak256(fixedSizeValues),
        keccak256(message.sender),
        keccak256(message.data),
        keccak256(encodedTokens),
      ],
    )

    console.debug('v1.6 leafHasher:', {
      messageId: message.header.messageId,
      encodedTokens,
      fixedSizeValues,
      packedValues,
      metadataInput,
    })

    return keccak256(packedValues)
  }
}

export function getLeafHasher<V extends CCIPVersion = CCIPVersion>({
  sourceChainSelector,
  destChainSelector,
  onRamp,
  version,
}: Lane<V>): LeafHasher<V> {
  switch (version) {
    case CCIPVersion.V1_2:
    case CCIPVersion.V1_5:
      return getV12LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher<V>
    case CCIPVersion.V1_6:
      return getV16LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher<V>
    default:
      throw new Error(`Unsupported CCIP version: ${version}`)
  }
}

export type AptosLeafHasher = (message: AptosCCIPMessage) => string

export const makeAptosHasher =
  (sourceChainSelector: bigint, destChainSelector: bigint, onRamp: string): AptosLeafHasher =>
  (message: AptosCCIPMessage): string =>
    hashAptosMessage(message, hashAptosMetadata(sourceChainSelector, destChainSelector, onRamp))

const encode = (target: string, value: string | bigint | number) =>
  defaultAbiCoder.encode([target], [value])

/**
 * Encodes dynamic bytes without the extra length prefix.
 * The default ABI encoding for type "bytes" is: 32-byte length prefix + the actual data padded.
 * This helper strips the 32-byte length prefix, mimicking the Move implementation.
 */
const encodeRawBytes = (value: string): string => {
  const encoded = encode('bytes', value)
  // Remove "0x" and skip the first 64 hex characters (32 bytes of length)
  return '0x' + encoded.slice(66)
}

export const hashAptosMessage = (message: AptosCCIPMessage, metadataHash: string): string => {
  const innerHash = concat([
    encode('bytes32', message.header.messageId),
    encode('bytes32', zeroPadValue(message.receiver, 32)),
    encode('uint64', message.header.sequenceNumber),
    encode('uint256', message.gasLimit),
    encode('uint64', message.header.nonce),
  ])

  const tokenHash = concat([
    encode('uint256', message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeRawBytes(token.sourcePoolAddress),
        encode('bytes32', zeroPadValue(token.destTokenAddress, 32)),
        encode('uint32', token.destGasAmount),
        encodeRawBytes(token.extraData),
        encode('uint256', token.amount),
      ]),
    ),
  ])

  const outerHash = concat([
    encode('bytes32', zeroPadValue(LEAF_DOMAIN_SEPARATOR, 32)),
    metadataHash,
    keccak256(innerHash),
    keccak256(message.sender),
    keccak256(message.data),
    keccak256(tokenHash),
  ])

  return keccak256(outerHash)
}

export const hashAptosMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const versionHash = id('Any2AptosMessageHashV1')
  const encodedSource = encode('uint64', sourceChainSelector)
  const encodedDest = encode('uint64', destChainSelector)
  const onrampHash = keccak256(onRamp)

  return keccak256(concat([versionHash, encodedSource, encodedDest, onrampHash]))
}
