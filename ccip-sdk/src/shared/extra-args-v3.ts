import {
  type BytesLike,
  concat,
  getAddress,
  hexlify,
  toBeArray,
  toBigInt,
  toNumber,
  zeroPadValue,
} from 'ethers'

import {
  type GenericExtraArgsV3,
  GenericExtraArgsV3Tag,
  decodeFinalityRequested,
  encodeFinality,
} from '../extra-args.ts'
import { ChainFamily } from '../networks.ts'
import { decodeAddress, getAddressBytes, getDataBytes } from '../utils.ts'

/**
 * Encodes GenericExtraArgsV3 using tightly packed binary format, which the OnRamps of more than
 * one family parse (EVM, Aptos).
 *
 * Binary format:
 * - tag (4 bytes): 0xa69dd4aa
 * - gasLimit (4 bytes): uint32 big-endian
 * - finality (4 bytes): uint32 big-endian (see FinalityCodec / encodeFinality)
 * - ccvsLength (1 byte): uint8
 * - For each CCV:
 *   - ccvAddressLength (1 byte): 0, or the width of a source chain address
 *   - ccvAddress (variable)
 *   - ccvArgsLength (2 bytes): uint16 big-endian
 *   - ccvArgs (variable)
 * - executorLength (1 byte): 0, or the width of a source chain address
 * - executor (variable)
 * - executorArgsLength (2 bytes): uint16 big-endian
 * - executorArgs (variable)
 * - tokenReceiverLength (1 byte): uint8
 * - tokenReceiver (variable)
 * - tokenArgsLength (2 bytes): uint16 big-endian
 * - tokenArgs (variable)
 *
 * @param args - Extra arguments to encode.
 * @param family - Family of the source chain, of which CCVs and executor are addresses.
 * @returns Encoded extra arguments as hex string.
 */
export function encodeExtraArgsV3(args: GenericExtraArgsV3, family: ChainFamily): string {
  // CCVs and executor are addresses of the source chain: 20 bytes on EVM, 32 on other families;
  // an empty one selects the lane's default
  const address = (addr?: string) =>
    addr && addr !== '0x'
      ? zeroPadValue(
          getAddressBytes(decodeAddress(addr, family)),
          family === ChainFamily.EVM ? 20 : 32,
        )
      : '0x'
  // data with its length in a prefix of `width` bytes
  const prefixed = (data: BytesLike, width: number) => {
    const bytes = getDataBytes(data)
    return [toBeArray(bytes.length, width), bytes]
  }
  return concat([
    GenericExtraArgsV3Tag,
    toBeArray(args.gasLimit, 4),
    toBeArray(encodeFinality(args.finality), 4),
    toBeArray(args.ccvs.length, 1),
    ...args.ccvs.flatMap((ccv, i) => [
      ...prefixed(address(ccv), 1),
      ...prefixed(args.ccvArgs[i] ?? '0x', 2),
    ]),
    ...prefixed(address(args.executor), 1),
    ...prefixed(args.executorArgs, 2),
    ...prefixed(getAddressBytes(args.tokenReceiver), 1),
    ...prefixed(args.tokenArgs, 2),
  ])
}

/**
 * Decodes GenericExtraArgsV3 from tightly packed binary format.
 * @param extraArgs - Bytes to decode, with the tag prefix.
 * @param family - Family of the source chain, of which CCVs and executor are addresses.
 * @returns Decoded GenericExtraArgsV3, or undefined if parsing fails.
 */
export function decodeExtraArgsV3(
  extraArgs: BytesLike,
  family: ChainFamily,
): (GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' }) | undefined {
  const bytes = getDataBytes(extraArgs)
  if (hexlify(bytes.subarray(0, 4)) !== GenericExtraArgsV3Tag) return
  let offset = 4
  const read = (length: number) => {
    if (offset + length > bytes.length) throw new RangeError('GenericExtraArgsV3 too short')
    return bytes.subarray(offset, (offset += length))
  }
  // length-prefixed fields; an address of a width other than its family's fails to decode
  const address = () => {
    const addr = read(read(1)[0]!)
    return addr.length ? decodeAddress(addr, family) : ''
  }
  const data = () => hexlify(read(toNumber(read(2))))
  try {
    const gasLimit = toBigInt(read(4))
    const finality = decodeFinalityRequested(toNumber(read(4)))
    const ccvs: string[] = []
    const ccvArgs: string[] = []
    for (let i = read(1)[0]!; i > 0; i--) {
      ccvs.push(address())
      ccvArgs.push(data())
    }
    const executor = address()
    const executorArgs = data()
    const tokenReceiver = hexlify(read(read(1)[0]!))
    const tokenArgs = data()
    return {
      _tag: 'GenericExtraArgsV3',
      gasLimit,
      finality,
      ccvs,
      ccvArgs,
      executor,
      executorArgs,
      // 20 bytes = EVM address, checksummed; other lengths: hex string
      tokenReceiver:
        tokenReceiver === '0x'
          ? ''
          : tokenReceiver.length === 42
            ? getAddress(tokenReceiver)
            : tokenReceiver,
      tokenArgs,
    }
  } catch {
    return undefined
  }
}
