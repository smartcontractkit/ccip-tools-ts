import { concat, id, keccak256, zeroPadValue } from 'ethers'

import { encodeNumber, encodeRawBytes } from '../aptos/utils.ts'
import { CCIPExtraArgsInvalidError, CCIPSuiHasherVersionUnsupportedError } from '../errors/index.ts'
import { decodeExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import { type CCIPMessage, type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

/**
 * Creates a leaf hasher for Sui CCIP messages.
 * @param lane - Lane configuration with selectors and onRamp.
 * @returns Leaf hasher function for the specified version.
 */
export function getSuiLeafHasher<V extends CCIPVersion = CCIPVersion>({
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
      metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)
      return ((message: CCIPMessage<typeof CCIPVersion.V1_6>): string =>
        hashV16SuiMessage(message, metadataHash)) as LeafHasher<V>
    default:
      throw new CCIPSuiHasherVersionUnsupportedError(version as string)
  }
}

/**
 * Computes the leaf hash for a v1.6 Sui CCIP message.
 * @param message - CCIP message to hash.
 * @param metadataHash - Pre-computed metadata hash for the lane.
 * @returns Keccak256 hash of the message.
 */
export function hashV16SuiMessage(
  message: CCIPMessage_V1_6 | CCIPMessage_V1_6_Sui,
  metadataHash: string,
): string {
  let tokenReceiver, gasLimit
  if ('tokenReceiver' in message) {
    ;({ tokenReceiver, gasLimit } = message)
  } else {
    const parsedArgs = decodeExtraArgs(message.extraArgs)
    if (!parsedArgs || parsedArgs._tag !== 'SuiExtraArgsV1')
      throw new CCIPExtraArgsInvalidError('Sui', message.extraArgs)
    ;({ tokenReceiver, gasLimit } = parsedArgs)
  }

  const innerHash = concat([
    encodeNumber(message.messageId),
    zeroPadValue(message.receiver, 32),
    encodeNumber(message.sequenceNumber),
    encodeNumber(gasLimit),
    zeroPadValue(tokenReceiver, 32),
    encodeNumber(message.nonce),
  ])

  const tokenHash = concat([
    encodeNumber(message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeRawBytes(token.sourcePoolAddress),
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
    keccak256(message.sender),
    keccak256(message.data),
    keccak256(tokenHash),
  ])

  return keccak256(outerHash)
}

/**
 * Computes the metadata hash for Sui CCIP lane.
 * @param sourceChainSelector - Source chain selector.
 * @param destChainSelector - Destination chain selector.
 * @param onRamp - OnRamp address.
 * @returns Keccak256 hash of the lane metadata.
 */
export const hashSuiMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const versionHash = id('Any2SuiMessageHashV1')
  const encodedSource = encodeNumber(sourceChainSelector)
  const encodedDest = encodeNumber(destChainSelector)
  const onrampHash = keccak256(onRamp)

  return keccak256(concat([versionHash, encodedSource, encodedDest, onrampHash]))
}
