import { type BytesLike, concat, dataSlice, encodeBase58, zeroPadValue } from 'ethers'

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
import { ChainFamily } from '../networks.ts'
import { DEFAULT_GAS_LIMIT } from '../shared/constants.ts'
import { decodeExtraArgsV3, encodeExtraArgsV3 } from '../shared/extra-args-v3.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'
import { defaultAbiCoder } from './const.ts'
import { resultToObject } from './types.ts'

// ABI type strings for extra args encoding
const EVMExtraArgsV1ABI = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2ABI = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
const SVMExtraArgsV1ABI =
  'tuple(uint32 computeUnits, uint64 accountIsWritableBitmap, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] accounts)'
const SuiExtraArgsV1ABI =
  'tuple(uint256 gasLimit, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] receiverObjectIds)'

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
    case GenericExtraArgsV3Tag:
      return decodeExtraArgsV3(data, ChainFamily.EVM)
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
  if ('finality' in args) {
    // GenericExtraArgsV3 - tightly packed binary encoding
    return encodeExtraArgsV3(args, ChainFamily.EVM)
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
            receiverObjectIds: args.receiverObjectIds.map((a) =>
              zeroPadValue(getAddressBytes(a), 32),
            ),
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
