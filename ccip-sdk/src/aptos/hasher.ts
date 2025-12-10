import { concat, id, keccak256, zeroPadValue } from 'ethers'

import {
  CCIPAptosHasherVersionUnsupportedError,
  CCIPExtraArgsInvalidError,
} from '../errors/index.ts'
import { decodeExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import { type CCIPMessage, type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getAddressBytes, networkInfo } from '../utils.ts'
import { encodeNumber, encodeRawBytes } from './utils.ts'

/**
 * Creates a leaf hasher for Aptos CCIP messages.
 * @param lane - Lane configuration with selectors and onRamp.
 * @returns Leaf hasher function for the specified version.
 */
export function getAptosLeafHasher<V extends CCIPVersion = CCIPVersion>({
  sourceChainSelector,
  destChainSelector,
  onRamp,
  version,
}: {
  sourceChainSelector: bigint
  destChainSelector: bigint
  onRamp: string
  version: V
}): LeafHasher<V> {
  let metadataHash: string
  switch (version) {
    case CCIPVersion.V1_6:
      metadataHash = hashAptosMetadata(sourceChainSelector, destChainSelector, onRamp)
      return ((message: CCIPMessage<typeof CCIPVersion.V1_6>): string =>
        hashV16AptosMessage(message, metadataHash)) as LeafHasher<V>
    default:
      throw new CCIPAptosHasherVersionUnsupportedError(version as string)
  }
}

/**
 * Computes the leaf hash for a v1.6 Aptos CCIP message.
 * @param message - CCIP message to hash.
 * @param metadataHash - Pre-computed metadata hash for the lane.
 * @returns Keccak256 hash of the message.
 */
export function hashV16AptosMessage(
  message: CCIPMessage_V1_6 | CCIPMessage<typeof CCIPVersion.V1_6>,
  metadataHash: string,
): string {
  let gasLimit
  if (!('gasLimit' in message)) {
    const parsedArgs = decodeExtraArgs(
      message.extraArgs,
      networkInfo(message.header.sourceChainSelector).family,
    )
    if (!parsedArgs || !('gasLimit' in parsedArgs))
      throw new CCIPExtraArgsInvalidError('Aptos', message.extraArgs)
    gasLimit = parsedArgs.gasLimit
  } else {
    gasLimit = message.gasLimit
  }

  const innerHash = concat([
    message.header.messageId,
    zeroPadValue(message.receiver, 32),
    encodeNumber(message.header.sequenceNumber),
    encodeNumber(gasLimit), // Aptos as dest uses EVMExtraArgs
    encodeNumber(message.header.nonce),
  ])

  const tokenHash = concat([
    encodeNumber(message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeRawBytes(getAddressBytes(token.sourcePoolAddress)),
        zeroPadValue(token.destTokenAddress, 32),
        encodeNumber(token.destGasAmount),
        encodeRawBytes(token.extraData),
        encodeNumber(token.amount),
      ]),
    ),
  ])

  const outerHash = concat([
    zeroPadValue(LEAF_DOMAIN_SEPARATOR, 32),
    metadataHash,
    keccak256(innerHash),
    keccak256(getAddressBytes(message.sender)),
    keccak256(message.data),
    keccak256(tokenHash),
  ])

  return keccak256(outerHash)
}

/**
 * Computes the metadata hash for Aptos CCIP lane.
 * @param sourceChainSelector - Source chain selector.
 * @param destChainSelector - Destination chain selector.
 * @param onRamp - OnRamp address.
 * @returns Keccak256 hash of the lane metadata.
 */
export const hashAptosMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const versionHash = id('Any2AptosMessageHashV1')
  const encodedSource = encodeNumber(sourceChainSelector)
  const encodedDest = encodeNumber(destChainSelector)
  const onrampHash = keccak256(onRamp)

  return keccak256(concat([versionHash, encodedSource, encodedDest, onrampHash]))
}
