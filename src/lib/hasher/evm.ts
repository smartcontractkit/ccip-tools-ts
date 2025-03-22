// For reference implementation, see https://github.com/smartcontractkit/ccip/blob/ccip-develop/core/services/ocr2/plugins/ccip/hasher/leaf_hasher.go
import { concat, id, keccak256, toBeHex, zeroPadValue } from 'ethers'
import { type CCIPMessage, type CCIPVersion, defaultAbiCoder } from '../types.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from './common.ts'

const METADATA_PREFIX_1_2 = id('EVM2EVMMessageHashV2')
export function getV12LeafHasher(
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
export function getV16LeafHasher(
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
