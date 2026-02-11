import { Buffer } from 'buffer'

import { Address, Cell, beginCell } from '@ton/core'
import { sha256, toBigInt } from 'ethers'

import {
  CCIPExtraArgsInvalidError,
  CCIPHasherVersionUnsupportedError,
} from '../errors/specialized.ts'
import { decodeExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/common.ts'
import { type CCIPMessage, type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { bytesToBuffer, networkInfo } from '../utils.ts'
import { tryParseCell } from './utils.ts'

// TON uses 256 bits (32 bytes) of zeros as leaf domain separator
const TON_LEAF_DOMAIN_SEPARATOR = 0n

// ============================================================================
// Any→TON for manual execution on TON OffRamp
// ============================================================================

/**
 * Creates a leaf hasher for Any→TON messages.
 * Used for manual execution on the TON OffRamp.
 *
 * @param lane - Lane configuration containing sourceChainSelector, destChainSelector,
 *   onRamp (as hex string), and version (only v1.6 supported for TON).
 * @returns A LeafHasher function that computes message hashes for TON.
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
    throw new CCIPHasherVersionUnsupportedError('TON', version)
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
 * for Any→TON messages. Uses Any2TVMMessageHashV1 prefix.
 *
 * @param sourceChainSelector - Source chain selector.
 * @param destChainSelector - Destination chain selector.
 * @param onRamp - OnRamp address as hex string.
 * @returns SHA256 hash of the metadata as hex string.
 */
export const hashTONMetadata = (
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  // Domain separator for Any→TON messages
  const versionHash = BigInt(sha256(Buffer.from('Any2TVMMessageHashV1')))
  const onRampBytes = bytesToBuffer(onRamp)

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
 * Computes the full message hash for Any→TON messages.
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
      networkInfo(message.sourceChainSelector).family,
    )
    if (!parsedArgs || parsedArgs._tag !== 'EVMExtraArgsV2') {
      throw new CCIPExtraArgsInvalidError('TON', message.extraArgs)
    }
    gasLimit = parsedArgs.gasLimit || 0n
  }

  // Build header cell containing header routing information
  const headerCell = beginCell()
    .storeUint(toBigInt(message.messageId), 256)
    .storeAddress(Address.parse(message.receiver))
    .storeUint(toBigInt(message.sequenceNumber), 64)
    .storeCoins(gasLimit)
    .storeUint(toBigInt(message.nonce), 64)
    .endCell()

  // Build sender cell with address bytes
  const senderBytes = bytesToBuffer(message.sender)
  const senderCell = beginCell()
    .storeUint(BigInt(senderBytes.length), 8)
    .storeBuffer(senderBytes)
    .endCell()

  // Build token amounts cell if tokens are being transferred
  const tokenAmountsCell =
    message.tokenAmounts.length > 0 ? buildAny2TONTokenAmountsCell(message.tokenAmounts) : null

  // Assemble the complete message cell
  // LEAF_DOMAIN_SEPARATOR (256 bits) + metadataHash (256 bits) + refs
  const messageCell = beginCell()
    .storeUint(TON_LEAF_DOMAIN_SEPARATOR, 256)
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
 * Creates a nested cell structure for token amounts in Any→TON messages.
 *
 * @param tokenAmounts - Array of token transfer details
 * @returns Cell containing all token transfer information
 */
function buildAny2TONTokenAmountsCell(tokenAmounts: readonly TokenAmount[]): Cell {
  const builder = beginCell()

  // Process each token transfer
  for (const ta of tokenAmounts) {
    const sourcePoolBytes = bytesToBuffer(ta.sourcePoolAddress)

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

// ============================================================================
// TON→Any for manual execution on EVM OffRamps
// ============================================================================

/**
 * Creates a leaf hasher for TON→Any messages.
 * Used for manual execution on EVM OffRamps when source is TON.
 * Uses TON cell hashing (SHA256) with TVM2AnyMessageHashV1 prefix.
 *
 * @param sourceChainSelector - TON source chain selector.
 * @param destChainSelector - Destination chain selector.
 * @param onRamp - TON OnRamp address (in TON format, e.g., "EQ..." or "0:...").
 * @param ctx - Context with logger.
 * @returns Leaf hasher function for TVM2Any messages.
 */
export function getTVM2AnyLeafHasher(
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
  { logger = console }: { logger?: Console } = {},
): LeafHasher<typeof CCIPVersion.V1_6> {
  // Compute metadata hash using TVM2AnyMessageHashV1 prefix
  const versionHash = BigInt(sha256(Buffer.from('TVM2AnyMessageHashV1')))

  // OnRamp is a TON address stored directly using storeAddress
  const onRampAddress = Address.parse(onRamp)
  const metadataCell = beginCell()
    .storeUint(versionHash, 256)
    .storeUint(sourceChainSelector, 64)
    .storeUint(destChainSelector, 64)
    .storeAddress(onRampAddress)
    .endCell()

  const metadataHash = BigInt('0x' + metadataCell.hash().toString('hex'))

  logger.debug('TVM2Any metadata hash computed', {
    sourceChainSelector: sourceChainSelector.toString(),
    destChainSelector: destChainSelector.toString(),
    onRamp,
    metadataHash: '0x' + metadataHash.toString(16).padStart(64, '0'),
  })

  return (message: CCIPMessage_V1_6): string => {
    logger.debug('TVM2Any leaf hash computation', {
      messageId: message.messageId,
      sender: message.sender,
      sequenceNumber: message.sequenceNumber.toString(),
      nonce: message.nonce.toString(),
    })

    // Parse sender as TON address
    const senderAddress = Address.parse(message.sender)

    // Build body cell matching TVM2AnyRampMessageBody structure
    const bodyCell = buildTVM2AnyBodyCell(message, logger)

    // Build leaf cell per TVM2AnyRampMessage.generateMessageId()
    // Structure: LEAF_DOMAIN_SEPARATOR (256) + metadataHash (256) + sender (addr) + seqNum (64) + nonce (64) + body (ref)
    const leafCell = beginCell()
      .storeUint(TON_LEAF_DOMAIN_SEPARATOR, 256)
      .storeUint(metadataHash, 256)
      .storeAddress(senderAddress)
      .storeUint(message.sequenceNumber, 64)
      .storeUint(message.nonce, 64)
      .storeRef(bodyCell)
      .endCell()

    const leafHash = '0x' + leafCell.hash().toString('hex')
    logger.debug('TVM2Any leaf hash computed', { leafHash })

    return leafHash
  }
}

/**
 * Builds the body cell for TVM2Any messages matching TVM2AnyRampMessageBody structure.
 * Structure: receiver (ref) + data (ref) + extraArgs (ref) + tokenAmounts (ref) + feeToken (addr) + feeTokenAmount (uint256)
 *
 * @param message - CCIP message to build body cell for.
 * @param logger - Logger for debugging.
 * @returns TON Cell representing the message body.
 */
function buildTVM2AnyBodyCell(message: CCIPMessage_V1_6, logger: Console): Cell {
  // Receiver as CrossChainAddress cell (length-prefixed bytes)
  const receiverBytes = bytesToBuffer(message.receiver)
  const receiverCell = beginCell()
    .storeUint(receiverBytes.length, 8)
    .storeBuffer(receiverBytes)
    .endCell()

  // Data cell
  const dataBytes = bytesToBuffer(message.data)
  const dataCell =
    dataBytes.length > 0 ? beginCell().storeBuffer(dataBytes).endCell() : beginCell().endCell()

  // ExtraArgs cell already in BOC format from TON OnRamp
  let extraArgsCell: Cell
  try {
    const extraArgsBytes = bytesToBuffer(message.extraArgs)
    extraArgsCell =
      extraArgsBytes.length > 0 ? Cell.fromBoc(extraArgsBytes)[0]! : beginCell().endCell()
  } catch {
    extraArgsCell = beginCell().endCell()
  }

  // TODO: implement when token transfers supported
  const tokenAmountsCell = beginCell().endCell()

  // FeeToken parsed as TON address if present
  let feeTokenAddress: Address | null = null
  if (message.feeToken && message.feeToken !== '' && message.feeToken !== '0x') {
    try {
      feeTokenAddress = Address.parse(message.feeToken)
    } catch {
      logger.debug('Could not parse feeToken as TON address:', message.feeToken)
    }
  }

  // FeeTokenAmount
  const feeTokenAmount = toBigInt(message.feeTokenAmount)

  // Assemble body cell: 4 refs, then inline address and uint256
  return beginCell()
    .storeRef(receiverCell)
    .storeRef(dataCell)
    .storeRef(extraArgsCell)
    .storeRef(tokenAmountsCell)
    .storeAddress(feeTokenAddress)
    .storeUint(feeTokenAmount, 256)
    .endCell()
}
