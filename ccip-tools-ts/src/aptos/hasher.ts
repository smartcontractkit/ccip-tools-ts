import { concat, id, keccak256, zeroPadValue } from 'ethers'

import { parseExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import { type CCIPMessage, type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getAddressBytes, networkInfo } from '../utils.ts'
import { encodeNumber, encodeRawBytes } from './utils.ts'

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
      throw new Error(`Unsupported hasher version for Aptos: ${version as string}`)
  }
}

export function hashV16AptosMessage(
  message: CCIPMessage_V1_6 | CCIPMessage<typeof CCIPVersion.V1_6>,
  metadataHash: string,
): string {
  let gasLimit
  if (!('gasLimit' in message)) {
    const parsedArgs = parseExtraArgs(
      message.extraArgs,
      networkInfo(message.header.sourceChainSelector).family,
    )
    if (!parsedArgs || !('gasLimit' in parsedArgs))
      throw new Error('Invalid extraArgs, not EVMExtraArgsV1|2')
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
