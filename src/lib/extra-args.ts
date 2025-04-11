import {
  type Result,
  concat,
  dataLength,
  dataSlice,
  decodeBase58,
  encodeBase58,
  getBytes,
  id,
  toBeHex,
  toBigInt,
} from 'ethers'

import { defaultAbiCoder } from './types.ts'
import { toLeHex } from './utils.ts'

const EVMExtraArgsV1Tag = id('CCIP EVMExtraArgsV1').substring(0, 10) as '0x97a657c9'
const EVMExtraArgsV2Tag = id('CCIP EVMExtraArgsV2').substring(0, 10) as '0x181dcf10'
const SVMExtraArgsTag = id('CCIP SVMExtraArgsV1').substring(0, 10) as '0x1f3b3aba'

const EVMExtraArgsV1 = 'tuple(uint256 gasLimit)'
const EVMExtraArgsV2 = 'tuple(uint256 gasLimit, bool allowOutOfOrderExecution)'
const SVMExtraArgsV1 =
  'tuple(uint32 computeUnits, uint64 accountIsWritableBitmap, bool allowOutOfOrderExecution, bytes32 tokenReceiver, bytes32[] accounts)'

export interface EVMExtraArgsV1 {
  gasLimit?: bigint
}
export interface EVMExtraArgsV2 extends EVMExtraArgsV1 {
  allowOutOfOrderExecution: boolean
}
export interface SVMExtraArgsV1 {
  computeUnits: number
  accountIsWritableBitmap: bigint
  allowOutOfOrderExecution: boolean
  tokenReceiver: string
  accounts: string[]
}

const DEFAULT_GAS_LIMIT = 200_000n

/**
 * Encodes extra arguments for CCIP messages.
 * args.allowOutOfOrderExecution enforces ExtraArgsV2 (v1.5+)
 **/
export function encodeExtraArgs(
  args: EVMExtraArgsV1 | EVMExtraArgsV2 | SVMExtraArgsV1,
  from: 'evm' | 'solana' = 'evm',
): string {
  if (from === 'solana') {
    if (!('allowOutOfOrderExecution' in args) || 'computeUnits' in args)
      throw new Error('Solana can only encode EVMExtraArgsV2')
    if (args.gasLimit == null) args.gasLimit = DEFAULT_GAS_LIMIT
    const gasLimitUint128Le = toLeHex(args.gasLimit, 16)
    return concat([
      EVMExtraArgsV2Tag,
      gasLimitUint128Le,
      args.allowOutOfOrderExecution ? '0x01' : '0x00',
    ])
  }
  if (!args) return '0x'
  if ('computeUnits' in args) {
    return concat([
      SVMExtraArgsTag,
      defaultAbiCoder.encode(
        [SVMExtraArgsV1],
        [
          {
            ...args,
            tokenReceiver: args.tokenReceiver.startsWith('0x')
              ? args.tokenReceiver
              : toBeHex(decodeBase58(args.tokenReceiver), 32),
            accounts: args.accounts.map((a) =>
              a.startsWith('0x') ? a : toBeHex(decodeBase58(a), 32),
            ),
          },
        ],
      ),
    ])
  } else if ('allowOutOfOrderExecution' in args) {
    if (args.gasLimit == null) args.gasLimit = DEFAULT_GAS_LIMIT
    return concat([EVMExtraArgsV2Tag, defaultAbiCoder.encode([EVMExtraArgsV2], [args])])
  } else if (args.gasLimit != null) {
    return concat([EVMExtraArgsV1Tag, defaultAbiCoder.encode([EVMExtraArgsV1], [args])])
  }
  return '0x'
}

/**
 * Parses extra arguments from CCIP messages
 * @param data - extra arguments bytearray data
 * @returns extra arguments object if found
 **/
export function parseExtraArgs(
  data: string,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | (SVMExtraArgsV1 & { _tag: 'SVMExtraArgsV1' })
  | undefined {
  if (data === '0x') return { _tag: 'EVMExtraArgsV1' }
  if (data.startsWith(EVMExtraArgsV1Tag)) {
    const args = defaultAbiCoder.decode([EVMExtraArgsV1], dataSlice(data, 4))
    return { ...((args[0] as Result).toObject() as EVMExtraArgsV1), _tag: 'EVMExtraArgsV1' }
  }
  if (data.startsWith(EVMExtraArgsV2Tag)) {
    if (dataLength(data) === 4 + 16 + 1) {
      // Solana-generated EVMExtraArgsV2
      return {
        _tag: 'EVMExtraArgsV2',
        gasLimit: toBigInt(getBytes(dataSlice(data, 4, 4 + 16)).reverse()), // from Uint128LE
        allowOutOfOrderExecution: dataSlice(data, 4 + 16, 4 + 16 + 1) === '0x01',
      }
    }
    const args = defaultAbiCoder.decode([EVMExtraArgsV2], dataSlice(data, 4))
    return { ...((args[0] as Result).toObject() as EVMExtraArgsV2), _tag: 'EVMExtraArgsV2' }
  }
  if (data.startsWith(SVMExtraArgsTag)) {
    const args = defaultAbiCoder.decode([SVMExtraArgsV1], dataSlice(data, 4))
    const parsed = (args[0] as Result).toObject() as SVMExtraArgsV1
    parsed.computeUnits = Number(parsed.computeUnits)
    parsed.tokenReceiver = encodeBase58(parsed.tokenReceiver)
    parsed.accounts = parsed.accounts.map((a: string) => encodeBase58(a))
    return { ...parsed, _tag: 'SVMExtraArgsV1' }
  }
}

const SourceTokenData =
  'tuple(bytes sourcePoolAddress, bytes destTokenAddress, bytes extraData, uint64 destGasAmount)'
export interface SourceTokenData {
  sourcePoolAddress: string
  destTokenAddress: string
  extraData: string
  destGasAmount: bigint
}

/**
 * parse <=v1.5 `message.sourceTokenData`;
 * v1.6+ already contains this in `message.tokenAmounts`
 */
export function parseSourceTokenData(data: string): SourceTokenData {
  const decoded = defaultAbiCoder.decode([SourceTokenData], data)
  return (decoded[0] as Result).toObject() as SourceTokenData
}
