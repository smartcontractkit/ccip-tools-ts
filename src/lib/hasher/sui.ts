import { concat, id, keccak256, zeroPadValue } from 'ethers'
import { parseExtraArgs } from '../extra-args.ts'
import { type CCIPMessage, type CCIPVersion, defaultAbiCoder } from '../types.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from './common.ts'

export const getV16SuiLeafHasher =
  (
    sourceChainSelector: bigint,
    destChainSelector: bigint,
    onRamp: string,
  ): LeafHasher<typeof CCIPVersion.V1_6> =>
  (message: CCIPMessage<typeof CCIPVersion.V1_6>): string =>
    hashSuiMessage(message, hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp))

const encode = (target: string, value: string | bigint | number) =>
  defaultAbiCoder.encode([target], [value])

// Encode bytes without offset pointer (matches Move's eth_abi::encode_bytes behavior)
const encodeBytes = (value: string): string => {
  const hexValue = value.startsWith('0x') ? value.slice(2) : value
  const byteLength = hexValue.length / 2

  // Encode length as u256
  const lengthHex = BigInt(byteLength).toString(16).padStart(64, '0')

  // Padding to 32-byte alignment
  const paddingNeeded = (32 - (byteLength % 32)) % 32
  const paddingHex = '0'.repeat(paddingNeeded * 2)

  return '0x' + lengthHex + hexValue + paddingHex
}

export const hashSuiMessage = (
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  metadataHash: string,
): string => {
  const parsedArgs = parseExtraArgs(message.extraArgs)

  if (!parsedArgs || parsedArgs._tag !== 'SUIExtraArgsV1') {
    throw new Error('Invalid extraArgs for Sui message, must be SUIExtraArgsV1')
  }

  const innerHash = concat([
    encode('bytes32', message.header.messageId),
    zeroPadValue(message.receiver, 32),
    encode('uint64', message.header.sequenceNumber),
    encode('uint256', parsedArgs.gasLimit),
    zeroPadValue(parsedArgs.tokenReceiver, 32),
    encode('uint64', message.header.nonce),
  ])

  const tokenHash = concat([
    encode('uint256', message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeBytes(token.sourcePoolAddress),
        zeroPadValue(token.destTokenAddress, 32),
        encode('uint32', token.destGasAmount),
        encodeBytes(token.extraData),
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

export const hashSuiMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const versionHash = id('Any2SuiMessageHashV1')
  const encodedSource = encode('uint64', sourceChainSelector)
  const encodedDest = encode('uint64', destChainSelector)
  const onrampHash = keccak256(onRamp)

  return keccak256(concat([versionHash, encodedSource, encodedDest, onrampHash]))
}
