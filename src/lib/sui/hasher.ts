import { concat, id, keccak256, zeroPadValue } from 'ethers'

import { encodeNumber, encodeRawBytes } from '../aptos/utils.ts'
import { parseExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import { type CCIPMessage, type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

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
      throw new Error(`Unsupported hasher version for Sui: ${version as string}`)
  }
}

export function hashV16SuiMessage(
  message: CCIPMessage_V1_6 | CCIPMessage_V1_6_Sui,
  metadataHash: string,
): string {
  let tokenReceiver, gasLimit
  if ('tokenReceiver' in message) {
    ;({ tokenReceiver, gasLimit } = message)
  } else {
    const parsedArgs = parseExtraArgs(message.extraArgs)
    if (!parsedArgs || parsedArgs._tag !== 'SuiExtraArgsV1')
      throw new Error('Invalid extraArgs for Sui message, must be SUIExtraArgsV1')
    ;({ tokenReceiver, gasLimit } = parsedArgs)
  }

  const innerHash = concat([
    encodeNumber(message.header.messageId),
    zeroPadValue(message.receiver, 32),
    encodeNumber(message.header.sequenceNumber),
    encodeNumber(gasLimit),
    zeroPadValue(tokenReceiver, 32),
    encodeNumber(message.header.nonce),
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
