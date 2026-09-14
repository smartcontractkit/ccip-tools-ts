import { BorshCoder } from '@coral-xyz/anchor'
import { concat, getBytes, hexlify } from 'ethers'

import { CCIPExtraArgsEncodingUnsupportedError, CCIPExtraArgsParseError } from '../errors/index.ts'
import {
  type ExtraArgs,
  type GenericExtraArgsV3,
  type SuiExtraArgsV1,
  EVMExtraArgsV2Tag,
  GenericExtraArgsV3Tag,
  SuiExtraArgsV1Tag,
  encodeFinality,
} from '../extra-args.ts'
import { ChainFamily } from '../networks.ts'
import { decodeAddress, getAddressBytes, toLeArray } from '../utils.ts'
import { IDL as FEE_QUOTER_IDL } from './idl/1.6.0/FEE_QUOTER.ts'

/**
 * Pure Solana extra-args encoder, extracted from `SolanaChain.encodeExtraArgs`
 * so that `solana/send.ts` can call it without importing the `SolanaChain` class
 * (which would create a runtime cycle: `solana/index.ts` ↔ `solana/send.ts`).
 *
 * `SolanaChain.encodeExtraArgs` remains as a thin static wrapper for the
 * `supportedChains`-based dispatch in `extra-args.ts` and for external callers.
 *
 * Solana uses Borsh to encode extraArgs for all destination chain families.
 * For basic types (integers, bools, vectors, fixed arrays) Borsh and BCS share
 * the same wire format, so the on-chain Borsh serialization is byte-identical
 * to BCS for these structs.
 *
 * Encodes `GenericExtraArgsV2` (EVMExtraArgsV2) in Borsh format for Solana
 * sources targeting EVM (and other non-SVM, non-Sui) destinations.
 *
 * Layout: 4-byte tag + Borsh `{gasLimit: u128 LE, allowOutOfOrderExecution: bool}`.
 *
 * @throws {@link CCIPExtraArgsEncodingUnsupportedError} if SVMExtraArgsV1 encoding is attempted
 */
export function encodeSolanaExtraArgs(args: ExtraArgs): string {
  if ('computeUnits' in args)
    throw new CCIPExtraArgsEncodingUnsupportedError(ChainFamily.Solana, 'EVMExtraArgsV2 format')
  if ('finality' in args) return encodeSolanaGenericExtraArgsV3(args)
  if ('receiverObjectIds' in args) return encodeSolanaSuiExtraArgsV1(args)
  const gasLimitUint128Le = toLeArray(args.gasLimit ?? 0n, 16)
  return concat([
    EVMExtraArgsV2Tag,
    gasLimitUint128Le,
    'allowOutOfOrderExecution' in args && args.allowOutOfOrderExecution ? '0x01' : '0x00',
  ])
}

/**
 * Encodes `SuiExtraArgsV1` in Borsh format for Solana sources targeting Sui
 * destinations.
 *
 * Layout: 4-byte tag + Borsh `{gasLimit: u128 LE, allowOutOfOrderExecution: bool, tokenReceiver: [u8;32], receiverObjectIds: Vec<[u8;32]>}`.
 *
 * Note: Borsh uses 4-byte LE for vec lengths, while BCS (Sui) uses ULEB128.
 * The two encodings are NOT byte-identical when receiverObjectIds is non-empty.
 */
export function encodeSolanaSuiExtraArgsV1(args: SuiExtraArgsV1): string {
  const gasLimitLe = toLeArray(args.gasLimit, 16) // u128 LE
  const allowOOOE = args.allowOutOfOrderExecution ? '0x01' : '0x00'
  const tokenReceiver = getAddressBytes(args.tokenReceiver) // 32 bytes (fixed array)
  const receiverObjectIdsCount = toLeArray(args.receiverObjectIds.length, 4)
  const receiverObjectIds = args.receiverObjectIds.map((id) => getAddressBytes(id)) // each 32 bytes
  return concat([
    SuiExtraArgsV1Tag,
    gasLimitLe,
    allowOOOE,
    tokenReceiver,
    receiverObjectIdsCount,
    ...receiverObjectIds,
  ])
}

/**
 * Encodes `GenericExtraArgsV3` in Borsh format for Solana sources targeting
 * CCIP v2 EVM destinations.
 *
 * Layout: 4-byte tag + Borsh `{gas_limit: u32 LE, finality: {flags: u16 LE, block_depth: u16 LE}, ccvs: Vec<[u8;32]>, ccv_args: Vec<Vec<u8>>, executor: [u8;32], executor_args: Vec<u8>, token_receiver: Vec<u8>, token_args: Vec<u8>}`.
 *
 * `CrossChainGas` is a u32 newtype → serialized as 4 bytes LE.
 * `FinalityConfig` → `{flags: u16, block_depth: u16}` (4 bytes total).
 */
export function encodeSolanaGenericExtraArgsV3(args: GenericExtraArgsV3): string {
  const gasLimitLe = toLeArray(args.gasLimit, 4) // CrossChainGas = u32
  const finalityEncoded = encodeFinality(args.finality)
  const flagsLe = toLeArray((finalityEncoded >>> 16) & 0xffff, 2) // u16 LE
  const blockDepthLe = toLeArray(finalityEncoded & 0xffff, 2) // u16 LE
  // ccvs: Vec<Pubkey> — each Pubkey is [u8; 32]
  const ccvBytes = args.ccvs.map((ccv) => getAddressBytes(ccv))
  const ccvsCount = toLeArray(ccvBytes.length, 4)
  // ccv_args: Vec<Vec<u8>>
  const ccvArgsBytes = args.ccvArgs.map((a) => getBytes(a))
  const ccvArgsCount = toLeArray(ccvArgsBytes.length, 4)
  const ccvArgsEncoded = ccvArgsBytes.map((b) => concat([toLeArray(b.length, 4), b]))
  // executor: Pubkey [u8; 32] — NO_EXECUTION_TAG → 32-byte zero-padded tag
  const executorBytes = getAddressBytes(args.executor)
  // executor_args: Vec<u8>
  const executorArgsBytes = getBytes(args.executorArgs)
  // token_receiver: Vec<u8>
  const tokenReceiverBytes = getAddressBytes(args.tokenReceiver)
  // token_args: Vec<u8>
  const tokenArgsBytes = getBytes(args.tokenArgs)
  return concat([
    GenericExtraArgsV3Tag,
    gasLimitLe,
    flagsLe,
    blockDepthLe,
    ccvsCount,
    ...ccvBytes,
    ccvArgsCount,
    ...ccvArgsEncoded,
    executorBytes,
    toLeArray(executorArgsBytes.length, 4),
    executorArgsBytes,
    toLeArray(tokenReceiverBytes.length, 4),
    tokenReceiverBytes,
    toLeArray(tokenArgsBytes.length, 4),
    tokenArgsBytes,
  ])
}

/**
 * Decodes Borsh-encoded `GenericExtraArgsV3` from Solana sources targeting
 * CCIP v2 EVM destinations.
 *
 * @param data - Full extraArgs bytes including the 4-byte tag.
 * @returns Decoded GenericExtraArgsV3 with `_tag`.
 */
export function decodeSolanaGenericExtraArgsV3(
  data: Uint8Array,
): GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' } {
  const buf = Buffer.from(data)
  let offset = 4 // skip 4-byte tag
  const gasLimit = BigInt(buf.readUInt32LE(offset))
  offset += 4
  const flags = buf.readUInt16LE(offset)
  offset += 2
  const blockDepth = buf.readUInt16LE(offset)
  offset += 2
  const finality = (flags << 16) | blockDepth
  // ccvs: Vec<Pubkey>
  const ccvCount = buf.readUInt32LE(offset)
  offset += 4
  const ccvs: Buffer[] = []
  for (let i = 0; i < ccvCount; i++) {
    ccvs.push(buf.subarray(offset, offset + 32))
    offset += 32
  }
  // ccv_args: Vec<Vec<u8>>
  const ccvArgCount = buf.readUInt32LE(offset)
  offset += 4
  const ccvArgs: Buffer[] = []
  for (let i = 0; i < ccvArgCount; i++) {
    const len = buf.readUInt32LE(offset)
    offset += 4
    ccvArgs.push(buf.subarray(offset, offset + len))
    offset += len
  }
  // executor: Pubkey [u8; 32]
  const executor = buf.subarray(offset, offset + 32)
  offset += 32
  // executor_args: Vec<u8>
  const executorArgsLen = buf.readUInt32LE(offset)
  offset += 4
  const executorArgs = buf.subarray(offset, offset + executorArgsLen)
  offset += executorArgsLen
  // token_receiver: Vec<u8>
  const tokenReceiverLen = buf.readUInt32LE(offset)
  offset += 4
  const tokenReceiver = buf.subarray(offset, offset + tokenReceiverLen)
  offset += tokenReceiverLen
  // token_args: Vec<u8>
  const tokenArgsLen = buf.readUInt32LE(offset)
  offset += 4
  const tokenArgs = buf.subarray(offset, offset + tokenArgsLen)
  // offset += tokenArgsLen
  return {
    _tag: 'GenericExtraArgsV3',
    gasLimit,
    finality: finality === 0 ? 'finalized' : flags & 1 ? 'safe' : blockDepth,
    ccvs: ccvs.map((ccv) => decodeAddress(ccv, ChainFamily.Solana)),
    ccvArgs: ccvArgs.map((a) => hexlify(a)),
    executor: decodeAddress(executor, ChainFamily.Solana),
    executorArgs: hexlify(executorArgs),
    tokenReceiver: hexlify(tokenReceiver),
    tokenArgs: hexlify(tokenArgs),
  }
}

/**
 * Decodes Borsh-encoded `SuiExtraArgsV1` from Solana sources targeting Sui dest.
 *
 * Decoding is driven by the generated FEE_QUOTER Anchor IDL (`SuiExtraArgsV1`,
 * added in 1.6.4) via anchor's `BorshTypesCoder`, instead of hand-rolled
 * offset arithmetic — the IDL is the on-chain source of truth, so an IDL bump
 * that changes the type is caught by regeneration and the fixture tests, not
 * silently mis-decoded.
 *
 * @param data - Full extraArgs bytes including the 4-byte tag.
 * @returns Decoded SuiExtraArgsV1 with `_tag`.
 * @throws if the tag is unexpected or the data is too short or malformed.
 */
export function decodeSolanaSuiExtraArgsV1(
  data: Uint8Array,
): SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' } {
  // The wire format is `bytes(tag) ++ borsh(SuiExtraArgsV1)`; the IDL describes
  // the struct only, so the tag is validated and stripped before decoding.
  const tag = hexlify(data.subarray(0, 4))
  if (tag !== SuiExtraArgsV1Tag)
    throw new CCIPExtraArgsParseError(
      `Solana Borsh SuiExtraArgsV1: unexpected tag ${tag}, expected ${SuiExtraArgsV1Tag}`,
    )
  const decoded = FEE_QUOTER_CODER.types.decode(
    'SuiExtraArgsV1',
    Buffer.from(data).subarray(4),
  ) as {
    gasLimit: { toString: () => string } // anchor returns BN for u128
    allowOutOfOrderExecution: boolean
    tokenReceiver: ArrayLike<number>
    receiverObjectIds: ArrayLike<number>[]
  }
  return {
    _tag: 'SuiExtraArgsV1',
    gasLimit: BigInt(decoded.gasLimit.toString()),
    allowOutOfOrderExecution: decoded.allowOutOfOrderExecution,
    tokenReceiver: hexlify(Buffer.from(decoded.tokenReceiver)),
    receiverObjectIds: decoded.receiverObjectIds.map((id) => hexlify(Buffer.from(id))),
  }
}

// The IDL (`./idl/*/FEE_QUOTER.ts`) is the on-chain source of truth for
// extraArgs struct layouts; its coder decodes them without hand-rolled field
// offsets. GenericExtraArgsV3 is an SDK-side construct with no IDL definition,
// so it keeps its manual decoder.
const FEE_QUOTER_CODER = new BorshCoder(FEE_QUOTER_IDL)
