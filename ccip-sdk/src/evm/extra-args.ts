import {
  type BytesLike,
  Result,
  concat,
  dataSlice,
  encodeBase58,
  getAddress,
  hexlify,
  toBeHex,
  toBigInt,
  toNumber,
  zeroPadValue,
} from 'ethers'

import {
  type EVMExtraArgsV1,
  type EVMExtraArgsV2,
  type ExtraArgs,
  type GenericExtraArgsV3,
  type SVMExtraArgsV1,
  type SuiExtraArgsV1,
  EVMExtraArgsV1Tag,
  EVMExtraArgsV2Tag,
  GenericExtraArgsV3Tag,
  SVMExtraArgsV1Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'
import { DEFAULT_GAS_LIMIT, defaultAbiCoder } from './const.ts'

// ABI type strings for extra args encoding
const EVMExtraArgsV1ABI = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2ABI = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
const SVMExtraArgsV1ABI =
  'tuple(uint32 computeUnits, uint64 accountIsWritableBitmap, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] accounts)'
const SuiExtraArgsV1ABI =
  'tuple(uint256 gasLimit, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] receiverObjectIds)'

/**
 * Converts an ethers Result to a plain object.
 * @internal
 */
function resultToObject<T>(o: T): T {
  if (o instanceof Promise) return o.then(resultToObject) as T
  if (!(o instanceof Result)) return o
  if (o.length === 0) return o.toArray() as T
  try {
    const obj = o.toObject()
    if (!Object.keys(obj).every((k) => /^_+\d*$/.test(k)))
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resultToObject(v)])) as T
  } catch (_) {
    // fallthrough
  }
  return o.toArray().map(resultToObject) as T
}

/**
 * Encodes GenericExtraArgsV3 using tightly packed binary format.
 *
 * Binary format:
 * - tag (4 bytes): 0x302326cb
 * - gasLimit (4 bytes): uint32 big-endian
 * - blockConfirmations (2 bytes): uint16 big-endian
 * - ccvsLength (1 byte): uint8
 * - For each CCV:
 *   - ccvAddressLength (1 byte): 0 or 20
 *   - ccvAddress (0 or 20 bytes)
 *   - ccvArgsLength (2 bytes): uint16 big-endian
 *   - ccvArgs (variable)
 * - executorLength (1 byte): 0 or 20
 * - executor (0 or 20 bytes)
 * - executorArgsLength (2 bytes): uint16 big-endian
 * - executorArgs (variable)
 * - tokenReceiverLength (1 byte): uint8
 * - tokenReceiver (variable)
 * - tokenArgsLength (2 bytes): uint16 big-endian
 * - tokenArgs (variable)
 */
function encodeExtraArgsV3(args: GenericExtraArgsV3): string {
  const parts: Uint8Array[] = []

  // Tag (4 bytes)
  parts.push(getDataBytes(GenericExtraArgsV3Tag))

  // gasLimit (4 bytes, uint32 big-endian)
  parts.push(getDataBytes(toBeHex(args.gasLimit, 4)))

  // blockConfirmations (2 bytes, uint16 big-endian)
  parts.push(getDataBytes(toBeHex(args.blockConfirmations, 2)))

  // ccvsLength (1 byte)
  parts.push(new Uint8Array([args.ccvs.length]))

  // For each CCV
  for (let i = 0; i < args.ccvs.length; i++) {
    const ccvAddress = args.ccvs[i]!
    const ccvArgsBytes = getDataBytes(args.ccvArgs[i] ?? '0x')

    if (ccvAddress && ccvAddress !== '' && ccvAddress !== '0x') {
      // ccvAddressLength = 20
      parts.push(new Uint8Array([20]))
      // ccvAddress (20 bytes)
      parts.push(getDataBytes(ccvAddress))
    } else {
      // ccvAddressLength = 0
      parts.push(new Uint8Array([0]))
    }

    // ccvArgsLength (2 bytes, uint16 big-endian)
    parts.push(getDataBytes(toBeHex(ccvArgsBytes.length, 2)))

    // ccvArgs (variable)
    if (ccvArgsBytes.length > 0) {
      parts.push(ccvArgsBytes)
    }
  }

  // executorLength (1 byte)
  if (args.executor && args.executor !== '' && args.executor !== '0x') {
    parts.push(new Uint8Array([20]))
    parts.push(getDataBytes(args.executor))
  } else {
    parts.push(new Uint8Array([0]))
  }

  // Convert BytesLike fields to Uint8Array
  const executorArgsBytes = getDataBytes(args.executorArgs)
  const tokenReceiverBytes = getDataBytes(args.tokenReceiver)
  const tokenArgsBytes = getDataBytes(args.tokenArgs)

  // executorArgsLength (2 bytes, uint16 big-endian)
  parts.push(getDataBytes(toBeHex(executorArgsBytes.length, 2)))

  // executorArgs (variable)
  if (executorArgsBytes.length > 0) {
    parts.push(executorArgsBytes)
  }

  // tokenReceiverLength (1 byte)
  parts.push(new Uint8Array([tokenReceiverBytes.length]))

  // tokenReceiver (variable)
  if (tokenReceiverBytes.length > 0) {
    parts.push(tokenReceiverBytes)
  }

  // tokenArgsLength (2 bytes, uint16 big-endian)
  parts.push(getDataBytes(toBeHex(tokenArgsBytes.length, 2)))

  // tokenArgs (variable)
  if (tokenArgsBytes.length > 0) {
    parts.push(tokenArgsBytes)
  }

  return hexlify(concat(parts))
}

/**
 * Decodes GenericExtraArgsV3 from tightly packed binary format.
 * @param data - Bytes to decode (without the tag prefix).
 * @returns Decoded GenericExtraArgsV3 or undefined if parsing fails.
 */
function decodeExtraArgsV3(data: Uint8Array): GenericExtraArgsV3 | undefined {
  let offset = 0

  // gasLimit (4 bytes, uint32 big-endian)
  if (offset + 4 > data.length) return undefined
  const gasLimit = toBigInt(data.subarray(offset, offset + 4))
  offset += 4

  // blockConfirmations (2 bytes, uint16 big-endian)
  if (offset + 2 > data.length) return undefined
  const blockConfirmations = toNumber(data.subarray(offset, offset + 2))
  offset += 2

  // ccvsLength (1 byte)
  if (offset + 1 > data.length) return undefined
  const ccvsLength = data[offset]!
  offset += 1

  const ccvs: string[] = []
  const ccvArgs: string[] = []

  // For each CCV
  for (let i = 0; i < ccvsLength; i++) {
    // ccvAddressLength (1 byte)
    if (offset + 1 > data.length) return undefined
    const ccvAddrLen = data[offset]!
    offset += 1

    // ccvAddress (0 or 20 bytes)
    if (ccvAddrLen === 20) {
      if (offset + 20 > data.length) return undefined
      ccvs.push(getAddress(hexlify(data.slice(offset, offset + 20))))
      offset += 20
    } else if (ccvAddrLen === 0) {
      ccvs.push('')
    } else {
      return undefined // Invalid address length
    }

    // ccvArgsLength (2 bytes, uint16 big-endian)
    if (offset + 2 > data.length) return undefined
    const ccvArgsLen = toNumber(data.subarray(offset, offset + 2))
    offset += 2

    // ccvArgs (variable)
    if (offset + ccvArgsLen > data.length) return undefined
    ccvArgs.push(hexlify(data.slice(offset, offset + ccvArgsLen)))
    offset += ccvArgsLen
  }

  // executorLength (1 byte)
  if (offset + 1 > data.length) return undefined
  const executorLen = data[offset]!
  offset += 1

  // executor (0 or 20 bytes)
  let executor = ''
  if (executorLen === 20) {
    if (offset + 20 > data.length) return undefined
    executor = getAddress(hexlify(data.slice(offset, offset + 20)))
    offset += 20
  } else if (executorLen !== 0) {
    return undefined // Invalid executor length
  }

  // executorArgsLength (2 bytes, uint16 big-endian)
  if (offset + 2 > data.length) return undefined
  const executorArgsLen = toNumber(data.subarray(offset, offset + 2))
  offset += 2

  // executorArgs (variable)
  if (offset + executorArgsLen > data.length) return undefined
  const executorArgs = hexlify(data.slice(offset, offset + executorArgsLen))
  offset += executorArgsLen

  // tokenReceiverLength (1 byte)
  if (offset + 1 > data.length) return undefined
  const tokenReceiverLen = data[offset]!
  offset += 1

  // tokenReceiver (variable)
  if (offset + tokenReceiverLen > data.length) return undefined
  const tokenReceiverBytes = data.slice(offset, offset + tokenReceiverLen)
  offset += tokenReceiverLen

  // Convert tokenReceiver bytes to string
  let tokenReceiver: string
  if (tokenReceiverLen === 0) {
    tokenReceiver = ''
  } else if (tokenReceiverLen === 20) {
    // 20 bytes = EVM address, return checksummed
    tokenReceiver = getAddress(hexlify(tokenReceiverBytes))
  } else {
    // Other lengths: return as hex string
    tokenReceiver = hexlify(tokenReceiverBytes)
  }

  // tokenArgsLength (2 bytes, uint16 big-endian)
  if (offset + 2 > data.length) return undefined
  const tokenArgsLen = toNumber(data.subarray(offset, offset + 2))
  offset += 2

  // tokenArgs (variable)
  if (offset + tokenArgsLen > data.length) return undefined
  const tokenArgs = hexlify(data.slice(offset, offset + tokenArgsLen))
  offset += tokenArgsLen

  return {
    gasLimit,
    blockConfirmations,
    ccvs,
    ccvArgs,
    executor,
    executorArgs,
    tokenReceiver,
    tokenArgs,
  }
}

/**
 * Decodes extra arguments from a CCIP message.
 * @param extraArgs - Encoded extra arguments bytes.
 * @returns Decoded extra arguments with tag, or undefined if unknown format.
 */
export function decodeExtraArgs(
  extraArgs: BytesLike,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (GenericExtraArgsV3 & { _tag: 'GenericExtraArgsV3' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | (SuiExtraArgsV1 & { _tag: 'SuiExtraArgsV1' })
  | undefined {
  const data = getDataBytes(extraArgs),
    tag = dataSlice(data, 0, 4)
  switch (tag) {
    case EVMExtraArgsV1Tag: {
      const args = defaultAbiCoder.decode([EVMExtraArgsV1ABI], dataSlice(data, 4))
      return { ...(resultToObject(args[0]) as EVMExtraArgsV1), _tag: 'EVMExtraArgsV1' }
    }
    case EVMExtraArgsV2Tag: {
      const args = defaultAbiCoder.decode([EVMExtraArgsV2ABI], dataSlice(data, 4))
      return { ...(resultToObject(args[0]) as EVMExtraArgsV2), _tag: 'EVMExtraArgsV2' }
    }
    case GenericExtraArgsV3Tag: {
      const parsed = decodeExtraArgsV3(data.slice(4))
      if (!parsed) return undefined
      return { ...parsed, _tag: 'GenericExtraArgsV3' }
    }
    case SVMExtraArgsV1Tag: {
      const args = defaultAbiCoder.decode([SVMExtraArgsV1ABI], dataSlice(data, 4))
      const parsed = resultToObject(args[0]) as SVMExtraArgsV1
      parsed.tokenReceiver = encodeBase58(parsed.tokenReceiver)
      parsed.accounts = parsed.accounts.map((a: string) => encodeBase58(a))
      return { ...parsed, _tag: 'SVMExtraArgsV1' }
    }
    case SuiExtraArgsV1Tag: {
      const args = defaultAbiCoder.decode([SuiExtraArgsV1ABI], dataSlice(data, 4))
      const parsed = resultToObject(args[0]) as SuiExtraArgsV1
      return {
        ...parsed,
        _tag: 'SuiExtraArgsV1',
      }
    }
    default:
      return undefined
  }
}

/**
 * Encodes extra arguments for a CCIP message.
 * @param args - Extra arguments to encode.
 * @returns Encoded extra arguments as hex string.
 */
export function encodeExtraArgs(args: ExtraArgs | undefined): string {
  if (!args) return '0x'
  if ('blockConfirmations' in args) {
    // GenericExtraArgsV3 - tightly packed binary encoding
    return encodeExtraArgsV3(args)
  } else if ('computeUnits' in args) {
    return concat([
      SVMExtraArgsV1Tag,
      defaultAbiCoder.encode(
        [SVMExtraArgsV1ABI],
        [
          {
            ...args,
            tokenReceiver: getAddressBytes(args.tokenReceiver),
            accounts: args.accounts.map((a) => getAddressBytes(a)),
          },
        ],
      ),
    ])
  } else if ('receiverObjectIds' in args) {
    return concat([
      SuiExtraArgsV1Tag,
      defaultAbiCoder.encode(
        [SuiExtraArgsV1ABI],
        [
          {
            ...args,
            tokenReceiver: zeroPadValue(getAddressBytes(args.tokenReceiver), 32),
            receiverObjectIds: args.receiverObjectIds.map((a) => getDataBytes(a)),
          },
        ],
      ),
    ])
  } else if ('allowOutOfOrderExecution' in args) {
    if ((args as Partial<typeof args>).gasLimit == null) args.gasLimit = DEFAULT_GAS_LIMIT
    return concat([EVMExtraArgsV2Tag, defaultAbiCoder.encode([EVMExtraArgsV2ABI], [args])])
  } else if ((args as Partial<typeof args>).gasLimit != null) {
    return concat([EVMExtraArgsV1Tag, defaultAbiCoder.encode([EVMExtraArgsV1ABI], [args])])
  }
  return '0x'
}
