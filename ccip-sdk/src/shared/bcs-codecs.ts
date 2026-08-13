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
  type ExtraArgs,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'
import { ChainFamily } from '../networks.ts'
import { decodeAddress, getAddressBytes, getDataBytes, toLeArray } from '../utils.ts'

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
 * BCS codec for decoding Sui extra args on Sui.
 * Used for Sui → Sui messages.
 */
export const BcsSuiExtraArgsV1Codec = bcs.struct('SuiExtraArgsV1', {
  gasLimit: bcs.u128(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.fixedArray(32, bcs.u8()),
  receiverObjectIds: bcs.vector(bcs.fixedArray(32, bcs.u8())),
})

/**
 * Decodes BCS-encoded `SVMExtraArgsV1` (from Move-based sources: Sui/Aptos).
 * Used by `SolanaChain.decodeExtraArgs` when receiving messages from Sui/Aptos.
 * @param data - Full extraArgs bytes including the 4-byte tag.
 * @returns Decoded SVMExtraArgsV1 with `_tag`, or `undefined` if parsing fails.
 */
export function decodeBcsSVMExtraArgsV1(
  data: Uint8Array,
): (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' }) | undefined {
  try {
    const parsed = BcsSVMExtraArgsV1Codec.parse(getBytes(dataSlice(data, 4)))
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
  } catch {
    return undefined
  }
}

/**
 * Decodes extra arguments from Move-based chain CCIP messages.
 * Works for both Aptos and Sui since they share the same BCS encoding.
 *
 * Also handles Borsh-encoded `GenericExtraArgsV2` from Solana sources, which
 * shares the same tag (`0x181dcf10`) but uses a different binary layout:
 * Borsh serializes `gasLimit` as a 16-byte LE `u128` (21 bytes total), while
 * BCS serializes it as a 32-byte LE `u256` (37 bytes total). The length check
 * distinguishes the two formats.
 *
 * @param extraArgs - Encoded extra arguments bytes.
 * @returns Decoded extra arguments or undefined if unknown format.
 */
export function decodeMoveExtraArgs(
  extraArgs: BytesLike,
):
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
  | undefined {
  const data = getDataBytes(extraArgs),
    tag = dataSlice(data, 0, 4)
  switch (tag) {
    case EVMExtraArgsV2Tag: {
      const payload = getBytes(dataSlice(data, 4))
      // BCS-encoded GenericExtraArgsV2 from Move (Aptos/Sui) source.
      // BCS payload: 32-byte u256 gasLimit + 1-byte bool = 33 bytes.
      // EVM ABI-encoded EVMExtraArgsV2 has a different payload length (64 bytes);
      // return undefined so the EVM decoder can handle it.
      // Borsh-encoded (Solana source, 17 bytes) is handled by SolanaChain.
      if (payload.length !== 33) return undefined
      try {
        const parsed = BcsEVMExtraArgsV2Codec.parse(payload)
        return {
          _tag: 'EVMExtraArgsV2',
          ...parsed,
          gasLimit: BigInt(parsed.gasLimit),
        }
      } catch {
        return undefined
      }
    }
    case SVMExtraArgsV1Tag: {
      try {
        const parsed = BcsSVMExtraArgsV1Codec.parse(getBytes(dataSlice(data, 4)))
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
      } catch {
        return undefined
      }
    }
    case SuiExtraArgsV1Tag: {
      // BCS-encoded SuiExtraArgsV1 from Move (Sui) source.
      // EVM ABI-encoded SuiExtraArgsV1 also shares this tag but has a much
      // larger payload (≥128 bytes: 4×32-byte ABI words minimum). BCS
      // SuiExtraArgsV1 with empty receiverObjectIds is 57 bytes (16+1+32+4).
      // Reject payloads that are clearly ABI-sized so the EVM decoder handles them.
      const suiPayload = getBytes(dataSlice(data, 4))
      if (suiPayload.length >= 128) return undefined
      try {
        const parsed = BcsSuiExtraArgsV1Codec.parse(suiPayload)
        return {
          _tag: 'SuiExtraArgsV1',
          gasLimit: BigInt(parsed.gasLimit),
          allowOutOfOrderExecution: parsed.allowOutOfOrderExecution,
          tokenReceiver: getMoveAddress(new Uint8Array(parsed.tokenReceiver)),
          receiverObjectIds: parsed.receiverObjectIds.map((id) =>
            getMoveAddress(new Uint8Array(id)),
          ),
        }
      } catch {
        return undefined
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

// ─── BCS encoding for Move-source extraArgs ───────────────────────────────────

/**
 * Encodes `GenericExtraArgsV2` (EVMExtraArgsV2) in BCS format for Move sources.
 * Layout: 4-byte tag + BCS `{gasLimit: u256, allowOutOfOrderExecution: bool}`.
 * Used by Sui/Aptos onRamps for EVM destinations.
 */
export function encodeBcsGenericExtraArgsV2(args: EVMExtraArgsV2): string {
  const gasLimitLe = toLeArray(BigInt(args.gasLimit), 32)
  const allowOOOE = args.allowOutOfOrderExecution ? '0x01' : '0x00'
  return concat([EVMExtraArgsV2Tag, hexlify(gasLimitLe), allowOOOE])
}

/**
 * Encodes `SVMExtraArgsV1` in BCS format for Move sources.
 * Layout: 4-byte tag + BCS `{computeUnits: u32, accountIsWritableBitmap: u64, allowOutOfOrderExecution: bool, tokenReceiver: vector<u8>, accounts: vector<vector<u8>>}`.
 * Used by Sui/Aptos onRamps for Solana destinations.
 */
export function encodeBcsSVMExtraArgsV1(args: SVMExtraArgsV1): string {
  const tokenReceiverBytes = getAddressBytes(args.tokenReceiver)
  const accountBytes = args.accounts.map((acc) => getAddressBytes(acc))
  const encoded = BcsSVMExtraArgsV1Codec.serialize({
    computeUnits: Number(args.computeUnits),
    accountIsWritableBitmap: args.accountIsWritableBitmap,
    allowOutOfOrderExecution: args.allowOutOfOrderExecution,
    tokenReceiver: Array.from(tokenReceiverBytes),
    accounts: accountBytes.map((b) => Array.from(b)),
  })
  return concat([SVMExtraArgsV1Tag, hexlify(encoded.toBytes())])
}

/**
 * Encodes `SuiExtraArgsV1` in BCS format for Move sources.
 * Layout: 4-byte tag + BCS `{gasLimit: u64, allowOutOfOrderExecution: bool, tokenReceiver: vector<u8>, receiverObjectIds: vector<vector<u8>>}`.
 * Used by Sui onRamps for Sui destinations.
 */
export function encodeBcsSuiExtraArgsV1(args: SuiExtraArgsV1): string {
  const tokenReceiverBytes = getAddressBytes(args.tokenReceiver)
  const receiverObjectIdsBytes = args.receiverObjectIds.map((id) => getAddressBytes(id))
  const encoded = BcsSuiExtraArgsV1Codec.serialize({
    gasLimit: args.gasLimit,
    allowOutOfOrderExecution: args.allowOutOfOrderExecution,
    tokenReceiver: Array.from(tokenReceiverBytes),
    receiverObjectIds: receiverObjectIdsBytes.map((b) => Array.from(b)),
  })
  return concat([SuiExtraArgsV1Tag, hexlify(encoded.toBytes())])
}

/**
 * Encodes extra arguments in BCS format for Move-based source chains (Sui/Aptos).
 * Dispatches to the correct encoder based on the extraArgs fields.
 * @param args - Extra arguments to encode.
 * @returns Encoded extra arguments as hex string.
 */
export function encodeMoveExtraArgs(args: ExtraArgs): string {
  if ('computeUnits' in args) return encodeBcsSVMExtraArgsV1(args)
  if ('receiverObjectIds' in args) return encodeBcsSuiExtraArgsV1(args)
  // Default: GenericExtraArgsV2 (EVMExtraArgsV2)
  return encodeBcsGenericExtraArgsV2(args as EVMExtraArgsV2)
}
