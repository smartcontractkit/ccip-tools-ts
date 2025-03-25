import { sha256 } from '@noble/hashes/sha256'
import { PublicKey } from '@solana/web3.js'
import { concat, zeroPadValue } from 'ethers'
import { type CCIPMessage, type CCIPVersion, defaultAbiCoder } from '../types.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from './common.ts'

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
    return new PublicKey(address).toBytes()
  } catch {
    throw new Error(`Invalid Solana address: ${address}`)
  }
}

export const hashSolanaMessage = (
  message: CCIPMessage<CCIPVersion.V1_6>,
  metadataHash: string,
): string => {
  const innerHash = concat([
    encode('bytes32', message.header.messageId),
    zeroPadValue(message.receiver, 32),
    encode('uint64', message.header.sequenceNumber),
    encode('uint256', message.gasLimit),
    encode('uint64', message.header.nonce),
  ])

  const tokenHash = concat([
    encode('uint256', message.tokenAmounts.length),
    ...message.tokenAmounts.map((token) =>
      concat([
        encodeSolanaAddress(token.sourcePoolAddress),
        zeroPadValue(token.destTokenAddress, 32),
        encode('uint32', token.destGasAmount),
        encode('bytes', token.extraData),
        encode('uint256', token.amount),
      ]),
    ),
  ])

  const outerHash = concat([
    zeroPadValue(LEAF_DOMAIN_SEPARATOR, 32),
    metadataHash,
    sha256(innerHash),
    sha256(message.sender),
    sha256(message.data),
    sha256(tokenHash),
  ])

  return bufferToHex(sha256(outerHash))
}

export const hashSolanaMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const versionHash = sha256(Buffer.from('Any2SolanaMessageHashV1'))
  const encodedSource = encode('uint64', sourceChainSelector)
  const encodedDest = encode('uint64', destChainSelector)
  const onrampHash = sha256(Buffer.from(onRamp))

  return bufferToHex(sha256(concat([versionHash, encodedSource, encodedDest, onrampHash])))
}

function bufferToHex(buffer: Uint8Array): string {
  return '0x' + Buffer.from(buffer).toString('hex')
}
