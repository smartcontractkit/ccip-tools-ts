/**
 * BCS (Binary Canonical Serialization) codecs for Move-based chains (Aptos, Sui).
 * These chains share similar BCS encoding and 32-byte address formats.
 */
import { bcs } from '@mysten/bcs'
import {
  type BigNumberish,
  type BytesLike,
  concat,
  dataLength,
  dataSlice,
  getBytes,
  hexlify,
  toBeHex,
  zeroPadBytes,
  zeroPadValue,
} from 'ethers'

import { CCIPDataFormatUnsupportedError } from '../errors/index.ts'
import {
  type EVMExtraArgsV2,
  type SVMExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
} from '../extra-args.ts'
import { ChainFamily } from '../types.ts'
import { decodeAddress, getDataBytes } from '../utils.ts'

/**
 * BCS codec for decoding EVM extra args on Move chains (Aptos/Sui).
 * Used when receiving cross-chain messages from EVM source chains.
 */
export const BcsEVMExtraArgsV2Codec = bcs.struct('EVMExtraArgsV2', {
  gasLimit: bcs.u256(),
  allowOutOfOrderExecution: bcs.bool(),
})

/**
 * BCS codec for decoding SVM (Solana) extra args on Move chains (Aptos/Sui).
 * Used when receiving cross-chain messages from Solana source chains.
 */
export const BcsSVMExtraArgsV1Codec = bcs.struct('SVMExtraArgsV1', {
  computeUnits: bcs.u32(),
  accountIsWritableBitmap: bcs.u64(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.vector(bcs.u8()),
  accounts: bcs.vector(bcs.vector(bcs.u8())),
})

/**
 * Decodes extra arguments from Move-based chain CCIP messages.
 * Works for both Aptos and Sui since they share the same BCS encoding.
 * @param extraArgs - Encoded extra arguments bytes.
 * @returns Decoded extra arguments or undefined if unknown format.
 */
export function decodeMoveExtraArgs(
  extraArgs: BytesLike,
):
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | undefined {
  const data = getDataBytes(extraArgs),
    tag = dataSlice(data, 0, 4)
  switch (tag) {
    case EVMExtraArgsV2Tag: {
      const parsed = BcsEVMExtraArgsV2Codec.parse(getBytes(dataSlice(data, 4)))
      // Move serialization of EVMExtraArgsV2: 37 bytes total: 4 tag + 32 LE gasLimit + 1 allowOOOE
      return {
        _tag: 'EVMExtraArgsV2',
        ...parsed,
        gasLimit: BigInt(parsed.gasLimit),
      }
    }
    case SVMExtraArgsV1Tag: {
      const parsed = BcsSVMExtraArgsV1Codec.parse(getBytes(dataSlice(data, 4)))
      // Move serialization of SVMExtraArgsV1: 13 bytes total: 4 tag + 8 LE computeUnits
      return {
        _tag: 'SVMExtraArgsV1',
        ...parsed,
        computeUnits: BigInt(parsed.computeUnits),
        accountIsWritableBitmap: BigInt(parsed.accountIsWritableBitmap),
        tokenReceiver: decodeAddress(new Uint8Array(parsed.tokenReceiver), ChainFamily.Solana),
        accounts: parsed.accounts.map((account) =>
          decodeAddress(new Uint8Array(account), ChainFamily.Solana),
        ),
      }
    }
  }
}

/**
 * Converts bytes to a Move-chain address (32-byte zero-padded).
 * Works for both Aptos and Sui since they share the same address format.
 * @param bytes - Bytes to convert.
 * @returns Address as 0x-prefixed hex string, 32 bytes padded.
 * @throws {@link CCIPDataFormatUnsupportedError} if bytes length exceeds 32
 */
export function getMoveAddress(bytes: BytesLike | readonly number[]): string {
  let suffix = ''
  if (Array.isArray(bytes)) bytes = new Uint8Array(bytes)
  if (typeof bytes === 'string' && bytes.startsWith('0x')) {
    const idx = bytes.indexOf('::')
    if (idx > 0) {
      suffix = bytes.slice(idx)
      bytes = bytes.slice(0, idx)
    }
  }
  bytes = getDataBytes(bytes)
  if (bytes.length > 32)
    throw new CCIPDataFormatUnsupportedError(`Move address exceeds 32 bytes: ${hexlify(bytes)}`)
  return zeroPadValue(bytes, 32) + suffix
}

/**
 * Encodes a numeric value as a 32-byte hex string.
 * Used for BCS encoding on Move chains (Aptos/Sui).
 * @param value - Numeric value to encode.
 * @returns 32-byte hex string representation of the value.
 */
export const encodeNumber = (value: BigNumberish): string => toBeHex(value, 32)

/**
 * Encodes dynamic bytes with length prefix for BCS serialization.
 * Used for BCS encoding on Move chains (Aptos/Sui).
 * @param value - Bytes to encode.
 * @returns Encoded bytes with 32-byte aligned padding.
 */
export const encodeRawBytes = (value: BytesLike): string =>
  concat([
    encodeNumber(dataLength(value)),
    zeroPadBytes(value, Math.ceil(dataLength(value) / 32) * 32),
  ])
