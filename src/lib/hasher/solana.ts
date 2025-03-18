import { sha256 } from '@noble/hashes/sha256'
import { PublicKey } from '@solana/web3.js'
import { concat, zeroPadValue } from 'ethers'
import { type CCIPMessage, type CCIPVersion, defaultAbiCoder } from '../types.js'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from './common.js'

export const getV16SolanaLeafHasher =
  (
    sourceChainSelector: bigint,
    destChainSelector: bigint,
    onRamp: string,
  ): LeafHasher<CCIPVersion.V1_6> =>
  (message: CCIPMessage<CCIPVersion.V1_6>): string =>
    hashSolanaMessage(message, hashSolanaMetadata(sourceChainSelector, destChainSelector, onRamp))

const encode = (target: string, value: string | bigint | number) =>
  defaultAbiCoder.encode([target], [value])

const encodeSolanaAddress = (address: string): Uint8Array => {
  try {
    const publicKey = new PublicKey(address)
    return publicKey.toBytes() as Uint8Array
  } catch (error: unknown) {
    throw new Error(`Invalid Solana address: ${address}`, { cause: error })
  }
}

export const hashSolanaMessage = (
  message: CCIPMessage<CCIPVersion.V1_6>,
  metadataHash: string,
): string => {
  const innerHash = concat([
    encode('bytes32', message.header.messageId),
    encodeSolanaAddress(message.receiver),
    encode('uint64', message.header.sequenceNumber),
    encode('uint256', message.gasLimit),
    encode('uint64', message.header.nonce),
  ])

  const tokenHash = concat([
    encode('uint256', message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeSolanaAddress(token.sourcePoolAddress),
        encodeSolanaAddress(token.destTokenAddress),
        encode('uint32', token.destGasAmount),
        encode('bytes', token.extraData),
        encode('uint256', token.amount),
      ]),
    ),
  ])

  const outerHash = concat([
    zeroPadValue(LEAF_DOMAIN_SEPARATOR, 32),
    metadataHash,
    sha256Hash(innerHash),
    sha256Hash(message.sender),
    sha256Hash(message.data),
    sha256Hash(tokenHash),
  ])

  return bufferToHex(sha256Hash(outerHash))
}

export const hashSolanaMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const versionHash = sha256Hash(Buffer.from('Any2SolanaMessageHashV1'))
  const encodedSource = encode('uint64', sourceChainSelector)
  const encodedDest = encode('uint64', destChainSelector)
  const onrampHash = sha256Hash(Buffer.from(onRamp))

  return bufferToHex(sha256Hash(concat([versionHash, encodedSource, encodedDest, onrampHash])))
}

function sha256Hash(data: Uint8Array | string): Uint8Array {
  const buffer = typeof data === 'string' ? Buffer.from(data.slice(2), 'hex') : data
  return sha256(buffer)
}

function bufferToHex(buffer: Uint8Array): string {
  return '0x' + Buffer.from(buffer).toString('hex')
}
