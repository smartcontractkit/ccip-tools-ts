// For reference implementation, see https://github.com/smartcontractkit/ccip/blob/ccip-develop/core/services/ocr2/plugins/ccip/hasher/leaf_hasher.go
import { concat, hexlify, id, keccak256, toBeHex, zeroPadValue } from 'ethers'

import { type CCIPMessage, defaultAbiCoder, type Lane } from '../types.js'

export const ZERO_HASH = hexlify(new Uint8Array(32).fill(0xff))

export type LeafHasher = (message: CCIPMessage) => string
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

export function getLeafHasher({
  sourceChainSelector,
  destChainSelector,
  onRamp,
}: Omit<Lane, 'version'>): LeafHasher {
  const metadataHash = keccak256(
    concat([
      METADATA_PREFIX_1_2,
      toBeHex(sourceChainSelector, 32),
      toBeHex(destChainSelector, 32),
      zeroPadValue(onRamp, 32),
    ]),
  )

  const leafHasher = (message: CCIPMessage): string => {
    const encodedTokens = defaultAbiCoder.encode(
      ['tuple(address token, uint256 amount)[]'],
      [message.tokenAmounts],
    )

    const encodedSourceTokenData = defaultAbiCoder.encode(
      ['bytes[]'],
      [message.sourceTokenData ?? []],
    )

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
  return leafHasher
}
