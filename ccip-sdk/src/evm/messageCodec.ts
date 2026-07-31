import { ZeroHash, dataLength, solidityPacked } from 'ethers'

/**
 * TypeScript mirror of `chainlink-ccip` `MessageV1Codec` (the CCIP v2 chain-agnostic wire format), used to
 * build a candidate message for the destination OffRamp's `getCCVsForMessage(bytes)` view. A pure
 * `abi.encodePacked` builder (ethers `solidityPacked`), wrapping no function selector.
 *
 * Mirrors `MessageV1Codec.sol` `_encodeMessageV1` (69-byte header + per-field length-prefixed variable
 * fields) and `_encodeTokenTransferV1`.
 */

/** A single CCIP v2 token transfer, mirroring `MessageV1Codec.TokenTransferV1`. */
export interface MessageV1TokenTransfer {
  /** Number of tokens transferred. */
  amount: bigint
  /** Source pool address, `abi.encode(address)` (32 bytes) for EVM sources. Optional; empty if omitted. */
  sourcePoolAddress?: string
  /** Source token address, `abi.encode(address)` (32 bytes) for EVM sources. Optional; empty if omitted. */
  sourceTokenAddress?: string
  /** Destination token address, raw bytes (20 bytes for EVM destinations). */
  destTokenAddress: string
  /** Token receiver on the destination chain, raw bytes (20 bytes for EVM). Optional; empty if omitted. */
  tokenReceiver?: string
  /** Optional pool data forwarded to the destination pool. */
  extraData?: string
}

/**
 * A CCIP v2 `MessageV1`, mirroring `MessageV1Codec.MessageV1`.
 *
 * The `bytes`-typed address fields follow the codec's encoding rules exactly: source-side addresses
 * (`onRampAddress`, `sender`, and the token transfer's `sourcePoolAddress`/`sourceTokenAddress`) are
 * `abi.encode(address)` (32 bytes) for EVM; destination-side addresses (`offRampAddress`, `receiver`, and the
 * token transfer's `destTokenAddress`/`tokenReceiver`) are raw minimal bytes (20 bytes for EVM). Callers
 * building an EVM candidate should encode addresses accordingly before passing them here.
 */
export interface MessageV1 {
  /** Source chain selector. */
  sourceChainSelector: bigint
  /** Destination chain selector. */
  destChainSelector: bigint
  /** Per-lane message number. Assigned on-chain at send; not read by `getCCVsForMessage`. Default `0n`. */
  messageNumber?: bigint
  /** Destination execution gas limit. Not read by `getCCVsForMessage`. Default `0`. */
  executionGasLimit?: number | bigint
  /** User callback (`ccipReceive`) gas limit. Read by `getCCVsForMessage` (token-only determination). */
  ccipReceiveGasLimit: number | bigint
  /** Per-message finality, `bytes4`. Read by `getCCVsForMessage`. */
  finality: string
  /** Hash of verifiers+executor. Has no meaning on the destination and is not checked. Default `ZeroHash`. */
  ccvAndExecutorHash?: string
  /** Source onRamp, `abi.encode(address)`. Not read by `getCCVsForMessage`. Default empty. */
  onRampAddress?: string
  /** Destination offRamp, raw bytes. Not read by `getCCVsForMessage`. Default empty. */
  offRampAddress?: string
  /** Source sender, `abi.encode(address)`. Read by `getCCVsForMessage` (CCV set is sender-scoped). */
  sender: string
  /** Destination receiver, raw bytes. Read by `getCCVsForMessage`; must be 20 bytes for EVM. */
  receiver: string
  /** Destination-specific blob. Not read by `getCCVsForMessage`. Default empty. */
  destBlob?: string
  /** Optional token transfer (0 or 1). Read by `getCCVsForMessage` (pool CCVs). */
  tokenTransfer?: MessageV1TokenTransfer
  /** User data payload. Read by `getCCVsForMessage` (its length drives the token-only determination). */
  data?: string
}

/** Empty `bytes` value (`abi.encodePacked` emits nothing for a zero-length `bytes`). */
const EMPTY_BYTES = '0x'

/**
 * Encode a {@link MessageV1TokenTransfer} to its wire bytes, mirroring
 * `MessageV1Codec._encodeTokenTransferV1` (version `1`, `uint256 amount`, then each `bytes` field as a
 * `uint8`/`uint16` byte-length prefix followed by its raw bytes).
 */
export function encodeTokenTransferV1(transfer: MessageV1TokenTransfer): string {
  const sourcePoolAddress = transfer.sourcePoolAddress ?? EMPTY_BYTES
  const sourceTokenAddress = transfer.sourceTokenAddress ?? EMPTY_BYTES
  const tokenReceiver = transfer.tokenReceiver ?? EMPTY_BYTES
  const extraData = transfer.extraData ?? EMPTY_BYTES

  return solidityPacked(
    [
      'uint8', // version
      'uint256', // amount
      'uint8',
      'bytes', // sourcePoolAddress
      'uint8',
      'bytes', // sourceTokenAddress
      'uint8',
      'bytes', // destTokenAddress
      'uint8',
      'bytes', // tokenReceiver
      'uint16',
      'bytes', // extraData
    ],
    [
      1,
      transfer.amount,
      dataLength(sourcePoolAddress),
      sourcePoolAddress,
      dataLength(sourceTokenAddress),
      sourceTokenAddress,
      dataLength(transfer.destTokenAddress),
      transfer.destTokenAddress,
      dataLength(tokenReceiver),
      tokenReceiver,
      dataLength(extraData),
      extraData,
    ],
  )
}

/**
 * Encode a {@link MessageV1} candidate to its wire bytes, byte-for-byte matching
 * `MessageV1Codec._encodeMessageV1`: a 69-byte static header (`uint8` version `1`, `uint64` selectors and
 * message number, `uint32` gas limits, `bytes4` finality, `bytes32` ccvAndExecutorHash) followed by the
 * variable fields, each prefixed by its byte length (`uint8` for the four address fields, `uint16` for
 * `destBlob`/`tokenTransfer`/`data`). The token transfer is present iff its encoded length is non-zero.
 */
export function encodeMessageV1(message: MessageV1): string {
  const onRampAddress = message.onRampAddress ?? EMPTY_BYTES
  const offRampAddress = message.offRampAddress ?? EMPTY_BYTES
  const destBlob = message.destBlob ?? EMPTY_BYTES
  const data = message.data ?? EMPTY_BYTES
  const tokenTransfer = message.tokenTransfer
    ? encodeTokenTransferV1(message.tokenTransfer)
    : EMPTY_BYTES

  return solidityPacked(
    [
      'uint8', // version
      'uint64', // sourceChainSelector
      'uint64', // destChainSelector
      'uint64', // messageNumber
      'uint32', // executionGasLimit
      'uint32', // ccipReceiveGasLimit
      'bytes4', // finality
      'bytes32', // ccvAndExecutorHash
      'uint8',
      'bytes', // onRampAddress
      'uint8',
      'bytes', // offRampAddress
      'uint8',
      'bytes', // sender
      'uint8',
      'bytes', // receiver
      'uint16',
      'bytes', // destBlob
      'uint16',
      'bytes', // tokenTransfer
      'uint16',
      'bytes', // data
    ],
    [
      1,
      message.sourceChainSelector,
      message.destChainSelector,
      message.messageNumber ?? 0n,
      message.executionGasLimit ?? 0,
      message.ccipReceiveGasLimit,
      message.finality,
      message.ccvAndExecutorHash ?? ZeroHash,
      dataLength(onRampAddress),
      onRampAddress,
      dataLength(offRampAddress),
      offRampAddress,
      dataLength(message.sender),
      message.sender,
      dataLength(message.receiver),
      message.receiver,
      dataLength(destBlob),
      destBlob,
      dataLength(tokenTransfer),
      tokenTransfer,
      dataLength(data),
      data,
    ],
  )
}
