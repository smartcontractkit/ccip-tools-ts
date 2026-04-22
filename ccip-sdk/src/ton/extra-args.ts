import { type Cell, BitReader, BitString, Builder, Slice, beginCell } from '@ton/core'
import { type BytesLike, dataSlice, hexlify, toBeHex, toBigInt } from 'ethers'

import { CCIPExtraArgsInvalidError } from '../errors/index.ts'
import {
  type EVMExtraArgsV2,
  type ExtraArgs,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'
import { ChainFamily } from '../types.ts'
import { bigIntReplacer, bytesToBuffer, decodeAddress, getAddressBytes } from '../utils.ts'
import { asSnakedCell, fromSnakeData } from './utils.ts'

/**
 * Checks if extraArgs is SVMExtraArgsV1 format.
 */
function isSVMExtraArgs(extraArgs: ExtraArgs): extraArgs is SVMExtraArgsV1 {
  return 'computeUnits' in extraArgs
}

/**
 * Checks if extraArgs is SuiExtraArgsV1 format.
 */
function isSuiExtraArgs(extraArgs: ExtraArgs): extraArgs is SuiExtraArgsV1 {
  return 'receiverObjectIds' in extraArgs
}

/**
 * Encodes extraArgs as a Cell.
 *
 * Supports three formats based on the destination chain:
 * - GenericExtraArgsV2 (EVMExtraArgsV2) for EVM/TON/Aptos destinations
 * - SVMExtraArgsV1 for Solana destinations
 * - SuiExtraArgsV1 for Sui destinations
 *
 * @param extraArgs - Extra arguments for CCIP message
 * @returns Cell encoding the extra arguments
 * @throws {@link CCIPExtraArgsInvalidError} if extraArgs format is invalid
 */
export function encodeExtraArgsCell(extraArgs: ExtraArgs): Cell {
  if (isSVMExtraArgs(extraArgs)) {
    return encodeSVMExtraArgsCell(extraArgs)
  }
  if (isSuiExtraArgs(extraArgs)) {
    return encodeSuiExtraArgsCell(extraArgs)
  }
  return encodeEVMExtraArgsCell(extraArgs)
}

/**
 * Encodes extraArgs as a Cell using the GenericExtraArgsV2 (EVMExtraArgsV2) format.
 *
 * Format per chainlink-ton TL-B:
 * - tag: 32-bit opcode (0x181dcf10)
 * - gasLimit: Maybe<uint256> (1 bit flag + 256 bits if present)
 * - allowOutOfOrderExecution: 1 bit
 */
function encodeEVMExtraArgsCell(extraArgs: ExtraArgs): Cell {
  if (
    Object.keys(extraArgs).filter((k) => k !== '_tag').length !== 2 ||
    !('gasLimit' in extraArgs && 'allowOutOfOrderExecution' in extraArgs)
  )
    throw new CCIPExtraArgsInvalidError(ChainFamily.TON, JSON.stringify(extraArgs, bigIntReplacer))

  let gasLimit: bigint | null = null
  if (extraArgs.gasLimit > 0n) {
    gasLimit = extraArgs.gasLimit
  }

  // 0x181dcf10
  return beginCell()
    .storeUint(Number(EVMExtraArgsV2Tag), 32)
    .storeMaybeUint(gasLimit, 256)
    .storeBit(extraArgs.allowOutOfOrderExecution)
    .endCell()
}

/**
 * Encodes extraArgs as a Cell using the SVMExtraArgsV1 format.
 *
 * Format per chainlink-ton TL-B:
 * - tag: 32-bit opcode (0x1f3b3aba)
 * - computeUnits: uint32
 * - accountIsWritableBitmap: uint64
 * - allowOutOfOrderExecution: bool
 * - tokenReceiver: uint256
 * - accounts: SnakedCell<uint256>
 */
function encodeSVMExtraArgsCell(extraArgs: SVMExtraArgsV1): Cell {
  // Encode accounts as a snaked cell of uint256 values
  const builderFn = (account: string) =>
    new Builder().storeUint(toBigInt(getAddressBytes(account)), 256)
  const accountsCell = asSnakedCell(extraArgs.accounts, builderFn)

  // Encode tokenReceiver as uint256
  const tokenReceiver = extraArgs.tokenReceiver
    ? toBigInt(getAddressBytes(extraArgs.tokenReceiver))
    : 0n

  return beginCell()
    .storeUint(Number(SVMExtraArgsV1Tag), 32) // 0x1f3b3aba
    .storeUint(Number(extraArgs.computeUnits), 32)
    .storeUint(extraArgs.accountIsWritableBitmap, 64)
    .storeBit(extraArgs.allowOutOfOrderExecution)
    .storeUint(tokenReceiver, 256) // uint256
    .storeRef(accountsCell) // SnakedCell<uint256>
    .endCell()
}

/**
 * Encodes extraArgs as a Cell using the SuiExtraArgsV1 format.
 *
 * Format per chainlink-ton TL-B:
 * - tag: 32-bit opcode (0x21ea4ca9)
 * - gasLimit: uint256
 * - allowOutOfOrderExecution: bool
 * - tokenReceiver: uint256
 * - receiverObjectIds: SnakedCell<uint256>
 */
function encodeSuiExtraArgsCell(extraArgs: SuiExtraArgsV1): Cell {
  // Encode receiverObjectIds as a snaked cell of uint256 values
  const builderFn = (objectId: string) =>
    new Builder().storeUint(toBigInt(getAddressBytes(objectId)), 256)
  const objectIdsCell = asSnakedCell(extraArgs.receiverObjectIds, builderFn)

  // Encode tokenReceiver as uint256
  const tokenReceiver = extraArgs.tokenReceiver
    ? toBigInt(getAddressBytes(extraArgs.tokenReceiver))
    : 0n

  return beginCell()
    .storeUint(Number(SuiExtraArgsV1Tag), 32) // 0x21ea4ca9
    .storeUint(extraArgs.gasLimit, 256)
    .storeBit(extraArgs.allowOutOfOrderExecution)
    .storeUint(tokenReceiver, 256) // uint256
    .storeRef(objectIdsCell) // SnakedCell<uint256>
    .endCell()
}

/**
 * Decodes extraArgs from a BytesLike value in the legacy EVM/TON format (EVMExtraArgsV2).
 * Returns undefined if the format is invalid or does not match EVMExtraArgsV2.
 */
export function decodeLegacyEVMTONExtraArgs(
  extraArgs: BytesLike,
): (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' }) | undefined {
  let bytes
  try {
    bytes = bytesToBuffer(extraArgs)
    if (dataSlice(bytes, 0, 4) !== EVMExtraArgsV2Tag) return
  } catch {
    return
  }

  const slice = new Slice(new BitReader(new BitString(bytes, 32, bytes.length * 8)), [])
  const gasLimit = slice.loadMaybeUintBig(256) ?? 0n
  const allowOutOfOrderExecution = slice.loadBit()

  return {
    _tag: 'EVMExtraArgsV2',
    gasLimit,
    allowOutOfOrderExecution,
  }
}

/**
 * Decodes extraArgs from a TON Cell.
 * Returns undefined if the format is invalid or does not match any known extraArgs format.
 */
export function decodeTONExtraArgsCell(
  cell: Cell,
):
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
  | undefined {
  const slice = cell.beginParse()
  const tag = hexlify(slice.loadBuffer(4))

  switch (tag) {
    case EVMExtraArgsV2Tag:
      return {
        _tag: 'EVMExtraArgsV2',
        gasLimit: slice.loadMaybeUintBig(256) ?? 0n,
        allowOutOfOrderExecution: slice.loadBit(),
      }

    case SVMExtraArgsV1Tag:
      return {
        _tag: 'SVMExtraArgsV1',
        computeUnits: BigInt(slice.loadUint(32)),
        accountIsWritableBitmap: slice.loadUintBig(64),
        allowOutOfOrderExecution: slice.loadBit(),
        tokenReceiver: decodeAddress(toBeHex(slice.loadUintBig(256), 32), ChainFamily.Solana),
        accounts:
          slice.remainingRefs > 0
            ? fromSnakeData(slice.loadRef(), (accountSlice) =>
                decodeAddress(toBeHex(accountSlice.loadUintBig(256), 32), ChainFamily.Solana),
              )
            : [],
      }

    case SuiExtraArgsV1Tag:
      return {
        _tag: 'SuiExtraArgsV1',
        gasLimit: slice.loadUintBig(256),
        allowOutOfOrderExecution: slice.loadBit(),
        tokenReceiver: decodeAddress(toBeHex(slice.loadUintBig(256), 32), ChainFamily.Sui),
        receiverObjectIds:
          slice.remainingRefs > 0
            ? fromSnakeData(slice.loadRef(), (objectSlice) =>
                decodeAddress(toBeHex(objectSlice.loadUintBig(256), 32), ChainFamily.Sui),
              )
            : [],
      }

    default:
      return
  }
}
