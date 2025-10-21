import { concat, id, keccak256, zeroPadValue } from 'ethers'

import { parseExtraArgs } from '../extra-args.ts'
import { type CCIPMessage, type CCIPVersion, defaultAbiCoder } from '../types.ts'
import { networkInfo } from '../utils.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from './common.ts'

export const getV16AptosLeafHasher =
  (
    sourceChainSelector: bigint,
    destChainSelector: bigint,
    onRamp: string,
  ): LeafHasher<typeof CCIPVersion.V1_6> =>
  (message: CCIPMessage<typeof CCIPVersion.V1_6>): string =>
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

export const hashAptosMessage = (
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  metadataHash: string,
): string => {
  const parsedArgs = parseExtraArgs(
    message.extraArgs,
    networkInfo(message.header.sourceChainSelector).family,
  )
  if (!parsedArgs || (parsedArgs._tag !== 'EVMExtraArgsV1' && parsedArgs._tag !== 'EVMExtraArgsV2'))
    throw new Error('Invalid extraArgs, not EVMExtraArgsV1|2')

  const innerHash = concat([
    encode('bytes32', message.header.messageId),
    zeroPadValue(message.receiver, 32),
    encode('uint64', message.header.sequenceNumber),
    encode('uint256', parsedArgs.gasLimit), // TODO: fix aptos->solana, computeUnits
    encode('uint64', message.header.nonce),
  ])

  const tokenHash = concat([
    encode('uint256', message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeRawBytes(token.sourcePoolAddress),
        zeroPadValue(token.destTokenAddress, 32),
        encode('uint32', token.destGasAmount),
        encodeRawBytes(token.extraData),
        encode('uint256', token.amount),
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
