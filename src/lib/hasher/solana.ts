import { serialize as borshSerialize } from 'borsh'
import {
  ZeroHash,
  concat,
  dataLength,
  decodeBase58,
  getBytes,
  keccak256,
  toBeHex,
  toUtf8Bytes,
} from 'ethers'

import { parseExtraArgs } from '../extra-args.ts'
import type { CCIPMessage, CCIPVersion } from '../types.ts'
import { getAddressBytes, getDataBytes, toLeHex } from '../utils.ts'
import type { LeafHasher } from './common.ts'

const SvmExtraArgsSchema = {
  struct: {
    computeUnits: 'u32',
    accountIsWritableBitmap: 'u64',
  },
} as const

const SvmTokenAmountsSchema = {
  array: {
    type: {
      struct: {
        sourcePoolAddress: { array: { type: 'u8' } },
        destTokenAddress: { array: { type: 'u8', len: 32 } },
        destGasAmount: 'u32',
        extraData: { array: { type: 'u8' } },
        amount: { struct: { leBytes: { array: { type: 'u8', len: 32 } } } },
      },
    },
  },
} as const

export function getV16SolanaLeafHasher(
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): LeafHasher<typeof CCIPVersion.V1_6> {
  return (message: CCIPMessage<typeof CCIPVersion.V1_6>): string => {
    const parsedArgs = parseExtraArgs(message.extraArgs)
    if (!parsedArgs || parsedArgs._tag !== 'SVMExtraArgsV1')
      throw new Error('Invalid extraArgs, not SVMExtraArgsV1')

    const any2SVMExtraArgsBorshEncoded = borshSerialize(SvmExtraArgsSchema, parsedArgs, true)

    const dataBytes = getDataBytes(message.data)
    const onRampBytes = getAddressBytes(onRamp)
    const tokenReceiver = getAddressBytes(parsedArgs.tokenReceiver)
    const sender = getAddressBytes(message.sender)

    const tokenAmountsEncoded = borshSerialize(
      SvmTokenAmountsSchema,
      message.tokenAmounts.map((ta) => ({
        sourcePoolAddress: getAddressBytes(ta.sourcePoolAddress),
        destTokenAddress: getAddressBytes(ta.destTokenAddress),
        destGasAmount: Number(ta.destGasAmount),
        extraData: getDataBytes(ta.extraData),
        amount: { leBytes: getBytes(toLeHex(ta.amount, 32)) },
      })),
      true,
    )
    return keccak256(
      concat([
        ZeroHash,
        toUtf8Bytes('Any2SVMMessageHashV1'),
        toBeHex(sourceChainSelector, 8),
        toBeHex(destChainSelector, 8),
        toBeHex(dataLength(onRampBytes), 2),
        onRampBytes,
        message.header.messageId,
        tokenReceiver,
        toBeHex(message.header.sequenceNumber, 8),
        any2SVMExtraArgsBorshEncoded,
        toBeHex(message.header.nonce, 8),
        toBeHex(dataLength(sender), 2),
        sender,
        toBeHex(dataLength(dataBytes), 2),
        dataBytes,
        tokenAmountsEncoded,
        ...parsedArgs.accounts.map((a) => toBeHex(decodeBase58(a), 32)),
      ]),
    )
  }
}
