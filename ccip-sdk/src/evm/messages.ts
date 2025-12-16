import type { AbiParametersToPrimitiveTypes, ExtractAbiEvent } from 'abitype'
import type { Addressable, Result } from 'ethers'

import type { EVMExtraArgsV2 } from '../extra-args.ts'
import type { CCIPVersion, MergeArrayElements } from '../types.ts'
import type EVM2EVMOnRamp_1_5_ABI from './abi/OnRamp_1_5.ts'
import type OnRamp_1_6_ABI from './abi/OnRamp_1_6.ts'
import { defaultAbiCoder } from './const.ts'

/** Utility type that cleans up address types to just `string`. */
export type CleanAddressable<T> = T extends string | Addressable
  ? string
  : T extends Record<string, unknown>
    ? { [K in keyof T]: CleanAddressable<T[K]> }
    : T extends readonly unknown[]
      ? readonly CleanAddressable<T[number]>[]
      : T

// v1.2-v1.5 Message ()
type EVM2AnyMessageRequested = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof EVM2EVMOnRamp_1_5_ABI, 'CCIPSendRequested'>['inputs']
  >[0]
>

type CCIPMessageSent = CleanAddressable<
  AbiParametersToPrimitiveTypes<
    ExtractAbiEvent<typeof OnRamp_1_6_ABI, 'CCIPMessageSent'>['inputs']
  >[2]
>

/**
 * v1.6+ Message Base type (all other destinations share this intersection).
 * `header` is merged to message root, for consistency.
 */
export type CCIPMessage_V1_6 = MergeArrayElements<
  Omit<CCIPMessageSent, 'header'>,
  CCIPMessageSent['header'] & { tokenAmounts: readonly SourceTokenData[] }
>

/** CCIP v1.5 EVM message type. */
export type CCIPMessage_V1_5_EVM = MergeArrayElements<
  EVM2AnyMessageRequested,
  { tokenAmounts: readonly SourceTokenData[] }
>

/** CCIP v1.2 EVM message type. */
export type CCIPMessage_V1_2_EVM = EVM2AnyMessageRequested

/** v1.6 EVM specialization with EVMExtraArgsV2 and tokenAmounts.*.destGasAmount. */
export type CCIPMessage_V1_6_EVM = CCIPMessage_V1_6 & EVMExtraArgsV2

/** Union type for CCIP EVM messages across versions. */
export type CCIPMessage_EVM<V extends CCIPVersion = CCIPVersion> = V extends typeof CCIPVersion.V1_2
  ? CCIPMessage_V1_2_EVM
  : V extends typeof CCIPVersion.V1_5
    ? CCIPMessage_V1_5_EVM
    : CCIPMessage_V1_6_EVM

const SourceTokenData =
  'tuple(bytes sourcePoolAddress, bytes destTokenAddress, bytes extraData, uint64 destGasAmount)'
/** Token transfer data in a CCIP message. */
export type SourceTokenData = {
  sourcePoolAddress: string
  destTokenAddress: string
  extraData: string
  destGasAmount: bigint
}

/**
 * Parses v1.5 and earlier `message.sourceTokenData`.
 * Version 1.6+ already contains this in `message.tokenAmounts`.
 * @param data - The source token data string to parse.
 * @returns The parsed SourceTokenData object.
 */
export function parseSourceTokenData(data: string): SourceTokenData {
  const decoded = defaultAbiCoder.decode([SourceTokenData], data)
  return (decoded[0] as Result).toObject() as SourceTokenData
}
