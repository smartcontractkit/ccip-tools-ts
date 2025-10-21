import { concat, id, keccak256, toBeHex, zeroPadValue } from 'ethers'

import { parseExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import type { CCIPMessage, CCIPVersion, DeepReadonly } from '../types.ts'
import { getAddressBytes, getDataBytes, networkInfo } from '../utils.ts'
import { defaultAbiCoder } from './const.ts'

const METADATA_PREFIX_1_2 = id('EVM2EVMMessageHashV2')
export function getV12LeafHasher(
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): LeafHasher<typeof CCIPVersion.V1_2 | typeof CCIPVersion.V1_5> {
  const metadataHash = keccak256(
    concat([
      METADATA_PREFIX_1_2,
      toBeHex(sourceChainSelector, 32),
      toBeHex(destChainSelector, 32),
      zeroPadValue(onRamp, 32),
    ]),
  )

  return (message: CCIPMessage<typeof CCIPVersion.V1_2 | typeof CCIPVersion.V1_5>): string => {
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
): LeafHasher<typeof CCIPVersion.V1_6> {
  const metadataInput = concat([
    ANY_2_EVM_MESSAGE_HASH,
    toBeHex(sourceChainSelector, 32),
    toBeHex(destChainSelector, 32),
    keccak256(zeroPadValue(getAddressBytes(onRamp), 32)),
  ])

  return (message: DeepReadonly<CCIPMessage<typeof CCIPVersion.V1_6>>): string => {
    console.debug('Message', message)
    const parsedArgs = parseExtraArgs(
      message.extraArgs,
      networkInfo(message.header.sourceChainSelector).family,
    )
    if (
      !parsedArgs ||
      (parsedArgs._tag !== 'EVMExtraArgsV1' && parsedArgs._tag !== 'EVMExtraArgsV2')
    )
      throw new Error('Invalid extraArgs, not EVMExtraArgsV1|2')
    const tokenAmounts = message.tokenAmounts.map((ta) => ({
      ...ta,
      sourcePoolAddress: zeroPadValue(getAddressBytes(ta.sourcePoolAddress), 32),
      extraData: getDataBytes(ta.extraData),
    }))
    const encodedTokens = defaultAbiCoder.encode(
      [
        'tuple(bytes sourcePoolAddress, address destTokenAddress, uint32 destGasAmount, bytes extraData, uint256 amount)[]',
      ],
      [tokenAmounts],
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
        parsedArgs.gasLimit,
        message.header.nonce,
      ],
    )

    const sender = zeroPadValue(getAddressBytes(message.sender), 32)

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
        keccak256(sender),
        keccak256(getDataBytes(message.data)),
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
