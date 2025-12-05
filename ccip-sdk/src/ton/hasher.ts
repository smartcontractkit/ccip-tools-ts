import { type Cell, Address, beginCell } from '@ton/core'

import { decodeExtraArgs } from '../extra-args.ts'
import { type LeafHasher, LEAF_DOMAIN_SEPARATOR } from '../hasher/common.ts'
import { type CCIPMessage, type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { networkInfo } from '../utils.ts'
import { hexToBuffer, sha256, toBigInt, tryParseCell } from './utils.ts'

// Convert LEAF_DOMAIN_SEPARATOR from hex string to Buffer for cell storage
const LEAF_DOMAIN_BUFFER = Buffer.from(LEAF_DOMAIN_SEPARATOR.slice(2).padStart(64, '0'), 'hex')

/**
 * Creates a leaf hasher for TON messages
 *
 * @param sourceChainSelector
 * @param destChainSelector
 * @param onRamp - as hex string
 * @param version - CCIP version (only v1.6 supported for TON)
 * @returns A LeafHasher function that computes message hashes for TON
 */
export function getTONLeafHasher<V extends CCIPVersion = CCIPVersion>({
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
  if (version !== CCIPVersion.V1_6) {
    throw new Error(`TON only supports CCIP v1.6, got: ${version}`)
  }

  // Pre-compute metadata hash once for all messages using this hasher
  const metadataHash = hashTONMetadata(sourceChainSelector, destChainSelector, onRamp)

  // Return the actual hashing function that will be called for each message
  return ((message: CCIPMessage<typeof CCIPVersion.V1_6>): string => {
    return hashV16TONMessage(message, metadataHash)
  }) as LeafHasher<V>
}

/**
 * Creates a hash that uniquely identifies the message lane configuration
 * (source chain, destination chain, and onRamp address).
 * Following the TON implementation from chainlink-ton repo.
 *
 * @param sourceChainSelector
 * @param destChainSelector
 * @param onRamp
 * @returns SHA256 hash of the metadata as hex string
 */
export const hashTONMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  // Domain separator for TON messages
  const versionHash = BigInt(sha256(Buffer.from('Any2TVMMessageHashV1')))
  const onRampBytes = hexToBuffer(onRamp)

  // Build metadata cell
  const metadataCell = beginCell()
    .storeUint(versionHash, 256)
    .storeUint(sourceChainSelector, 64)
    .storeUint(destChainSelector, 64)
    .storeRef(
      beginCell().storeUint(BigInt(onRampBytes.length), 8).storeBuffer(onRampBytes).endCell(),
    )
    .endCell()

  // Return cell hash as hex string (excludes BOC headers)
  return '0x' + metadataCell.hash().toString('hex')
}

/**
 * Computes the full message hash for a CCIP v1.6 TON message
 * Follows the chainlink-ton's Any2TVMRampMessage.generateMessageId()
 *
 * @param message - CCIP message to hash
 * @param metadataHash - Pre-computed metadata hash from hashTONMetadata()
 * @returns SHA256 hash of the complete message as hex string
 */
function hashV16TONMessage(message: CCIPMessage_V1_6, metadataHash: string): string {
  // Extract gas limit from message
  let gasLimit: bigint
  const embeddedGasLimit = (message as Partial<{ gasLimit: bigint }>).gasLimit

  if (typeof embeddedGasLimit === 'bigint') {
    gasLimit = embeddedGasLimit
  } else {
    const parsedArgs = decodeExtraArgs(
      message.extraArgs,
      networkInfo(message.header.sourceChainSelector).family,
    )
    if (!parsedArgs || parsedArgs._tag !== 'GenericExtraArgsV2') {
      throw new Error('Invalid extraArgs for TON message, must be GenericExtraArgsV2')
    }
    gasLimit = parsedArgs.gasLimit || 0n
  }

  // Build header cell containing header routing information
  const headerCell = beginCell()
    .storeUint(toBigInt(message.header.messageId), 256)
    .storeAddress(Address.parse(message.receiver))
    .storeUint(toBigInt(message.header.sequenceNumber), 64)
    .storeCoins(gasLimit)
    .storeUint(toBigInt(message.header.nonce), 64)
    .endCell()

  // Build sender cell with address bytes
  const senderBytes = hexToBuffer(message.sender)
  const senderCell = beginCell()
    .storeUint(BigInt(senderBytes.length), 8)
    .storeBuffer(senderBytes)
    .endCell()

  // Build token amounts cell if tokens are being transferred
  const tokenAmountsCell =
    message.tokenAmounts.length > 0 ? buildTokenAmountsCell(message.tokenAmounts) : null

  // Assemble the complete message cell
  const messageCell = beginCell()
    .storeBuffer(LEAF_DOMAIN_BUFFER)
    .storeUint(toBigInt(metadataHash), 256)
    .storeRef(headerCell)
    .storeRef(senderCell)
    .storeRef(tryParseCell(message.data))
    .storeMaybeRef(tokenAmountsCell)
    .endCell()

  // Return cell hash as hex string
  return '0x' + messageCell.hash().toString('hex')
}

// Type alias for token amount entries in CCIP messages
type TokenAmount = CCIPMessage_V1_6['tokenAmounts'][number]

/**
 * Creates a nested cell structure for token amounts, where each token
 * transfer is stored as a reference cell containing source pool, destination,
 * amount, and extra data.
 *
 * @param tokenAmounts - Array of token transfer details
 * @returns Cell containing all token transfer information
 */
function buildTokenAmountsCell(tokenAmounts: readonly TokenAmount[]): Cell {
  const builder = beginCell()

  // Process each token transfer
  for (const ta of tokenAmounts) {
    const sourcePoolBytes = hexToBuffer(ta.sourcePoolAddress)

    // Extract amount
    const amountSource =
      (ta as { amount?: bigint | number | string }).amount ??
      (ta as { destGasAmount?: bigint | number | string }).destGasAmount ??
      0n
    const amount = toBigInt(amountSource)

    // Store each token transfer as a reference cell
    builder.storeRef(
      beginCell()
        .storeRef(
          beginCell()
            .storeUint(BigInt(sourcePoolBytes.length), 8)
            .storeBuffer(sourcePoolBytes)
            .endCell(),
        )
        .storeAddress(Address.parse(ta.destTokenAddress))
        .storeUint(amount, 256)
        .storeRef(tryParseCell(ta.extraData))
        .endCell(),
    )
  }

  return builder.endCell()
}
