import { serialize as borshSerialize } from 'borsh'
import bs58 from 'bs58'
import {
  ZeroHash,
  concat,
  dataLength,
  hexlify,
  keccak256,
  toBeHex,
  toUtf8Bytes,
  zeroPadValue,
} from 'ethers'

import { decodeExtraArgs } from '../extra-args.ts'
import type { LeafHasher } from '../hasher/index.ts'
import { type CCIPMessage, type DeepReadonly, type Lane, CCIPVersion } from '../types.ts'
import { getAddressBytes, getDataBytes, networkInfo, toLeArray } from '../utils.ts'

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

export function getV16SolanaLeafHasher(lane: Lane): LeafHasher<typeof CCIPVersion.V1_6> {
  if (lane.version !== CCIPVersion.V1_6)
    throw new Error(`Unsupported lane version: ${lane.version}`)

  return (message: DeepReadonly<CCIPMessage<typeof CCIPVersion.V1_6>>): string => {
    let parsedArgs
    if ('accountIsWritableBitmap' in message) {
      parsedArgs = {
        computeUnits: Number(message.computeUnits),
        accountIsWritableBitmap: message.accountIsWritableBitmap,
        tokenReceiver: message.tokenReceiver,
        accounts: message.accounts,
      }
    } else {
      parsedArgs = decodeExtraArgs(message.extraArgs, networkInfo(lane.sourceChainSelector).family)
      if (!parsedArgs || parsedArgs._tag !== 'SVMExtraArgsV1')
        throw new Error('Invalid extraArgs, not SVMExtraArgsV1')
    }

    const any2SVMExtraArgsBorshEncoded = borshSerialize(SvmExtraArgsSchema, parsedArgs, true)

    const dataBytes = getDataBytes(message.data)
    const onRampBytes = getAddressBytes(lane.onRamp)
    const receiver = getAddressBytes(message.receiver)
    const tokenReceiver = getAddressBytes(parsedArgs.tokenReceiver)
    const sender = getAddressBytes(message.sender)

    const tokenAmountsEncoded = borshSerialize(
      SvmTokenAmountsSchema,
      message.tokenAmounts.map((ta) => ({
        sourcePoolAddress: getAddressBytes(ta.sourcePoolAddress),
        destTokenAddress: getAddressBytes(ta.destTokenAddress),
        destGasAmount: Number(ta.destGasAmount),
        extraData: getDataBytes(ta.extraData),
        amount: { leBytes: toLeArray(ta.amount, 32) },
      })),
      true,
    )
    const packedValues = [
      ZeroHash,
      toUtf8Bytes('Any2SVMMessageHashV1'),
      toBeHex(lane.sourceChainSelector, 8),
      toBeHex(lane.destChainSelector, 8),
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
      ...[receiver].filter((a) => hexlify(a) !== ZeroHash),
      ...parsedArgs.accounts.map((a) => zeroPadValue(bs58.decode(a), 32)),
    ]
    console.debug(
      'v1.6 solana leafHasher',
      packedValues.map((o) => (o instanceof Uint8Array ? `[${o.length}]:${hexlify(o)}` : o)),
    )
    return keccak256(concat(packedValues))
  }
}
