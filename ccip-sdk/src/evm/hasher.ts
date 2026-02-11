import { concat, id, keccak256, toBeHex, zeroPadValue } from 'ethers'
import type { ReadonlyDeep } from 'type-fest'

import { CCIPExtraArgsInvalidError } from '../errors/index.ts'
import { decodeExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import type { CCIPMessage, CCIPVersion, WithLogger } from '../types.ts'
import { getAddressBytes, getDataBytes, networkInfo } from '../utils.ts'
import { defaultAbiCoder } from './const.ts'

const METADATA_PREFIX_1_2 = id('EVM2EVMMessageHashV2')

/**
 * Creates a leaf hasher for v1.2/v1.5 EVM CCIP messages.
 * @param sourceChainSelector - Source chain selector.
 * @param destChainSelector - Destination chain selector.
 * @param onRamp - OnRamp contract address.
 * @returns Leaf hasher function.
 */
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

/**
 * Creates a leaf hasher for v1.6 EVM CCIP messages.
 * @param sourceChainSelector - Source chain selector.
 * @param destChainSelector - Destination chain selector.
 * @param onRamp - OnRamp contract address.
 * @returns Leaf hasher function.
 */
export function getV16LeafHasher(
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
  { logger = console }: WithLogger = {},
): LeafHasher<typeof CCIPVersion.V1_6> {
  const onRampBytes = getAddressBytes(onRamp)
  // Addresses ≤32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes;
  // Addresses >32 bytes (e.g., TON 36B) are used as raw bytes without padding
  const onRampForHash = onRampBytes.length <= 32 ? zeroPadValue(onRampBytes, 32) : onRampBytes

  const metadataInput = concat([
    ANY_2_EVM_MESSAGE_HASH,
    toBeHex(sourceChainSelector, 32),
    toBeHex(destChainSelector, 32),
    keccak256(onRampForHash),
  ])

  return (message: ReadonlyDeep<CCIPMessage<typeof CCIPVersion.V1_6>>): string => {
    logger.debug('Message', message)

    // Non-EVM sources (e.g., TON) embed gasLimit on the message during parsing,
    // since their extraArgs format differs. EVM sources decode from extraArgs.
    let gasLimit: bigint
    const embeddedGasLimit = (message as Partial<{ gasLimit: bigint }>).gasLimit
    if (typeof embeddedGasLimit === 'bigint') {
      gasLimit = embeddedGasLimit
    } else {
      const parsedArgs = decodeExtraArgs(
        message.extraArgs,
        networkInfo(message.sourceChainSelector).family,
      )
      if (
        !parsedArgs ||
        (parsedArgs._tag !== 'EVMExtraArgsV1' && parsedArgs._tag !== 'EVMExtraArgsV2')
      )
        throw new CCIPExtraArgsInvalidError('EVM', message.extraArgs)
      gasLimit = parsedArgs.gasLimit
    }

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
      [message.messageId, message.receiver, message.sequenceNumber, gasLimit, message.nonce],
    )

    const senderBytes = getAddressBytes(message.sender)
    // Addresses ≤32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes;
    // Addresses >32 bytes (e.g., TON 36B) are used as raw bytes without padding
    const sender = senderBytes.length <= 32 ? zeroPadValue(senderBytes, 32) : senderBytes

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

    logger.debug('v1.6 leafHasher:', {
      messageId: message.messageId,
      encodedTokens,
      fixedSizeValues,
      packedValues,
      metadataInput,
    })

    return keccak256(packedValues)
  }
}
