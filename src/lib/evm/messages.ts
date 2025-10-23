import type { AbiParametersToPrimitiveTypes, ExtractAbiEvent } from 'abitype'
import type { Addressable } from 'ethers'

import type EVM2EVMOnRamp_1_5_ABI from '../../abi/OnRamp_1_5.ts'
import type OnRamp_1_6_ABI from '../../abi/OnRamp_1_6.ts'
import type { EVMExtraArgsV2, SourceTokenData } from '../extra-args.ts'
import type { CCIPVersion, MergeArrayElements } from '../types.ts'

// addresses often come as `string | Addressable`, this type cleans them up to just `string`
type CleanAddressable<T> = T extends string | Addressable
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

// v1.6+ Message Base (all other dests share this intersection)
export type CCIPMessage_V1_6 = MergeArrayElements<
  CleanAddressable<
    AbiParametersToPrimitiveTypes<
      ExtractAbiEvent<typeof OnRamp_1_6_ABI, 'CCIPMessageSent'>['inputs']
    >[2]
  >,
  { tokenAmounts: readonly SourceTokenData[] }
>

export type CCIPMessage_V1_5_EVM = MergeArrayElements<
  EVM2AnyMessageRequested,
  {
    header: Omit<CCIPMessage_V1_6['header'], 'destChainSelector'>
    tokenAmounts: readonly SourceTokenData[]
  }
>

export type CCIPMessage_V1_2_EVM = EVM2AnyMessageRequested & {
  header: Omit<CCIPMessage_V1_6['header'], 'destChainSelector'>
}

// v1.6 EVM specialization, extends CCIPMessage_V1_6, plus EVMExtraArgsV2 and tokenAmounts.*.destGasAmount
export type CCIPMessage_V1_6_EVM = CCIPMessage_V1_6 & EVMExtraArgsV2

export type CCIPMessage_EVM<V extends CCIPVersion = CCIPVersion> = V extends typeof CCIPVersion.V1_2
  ? CCIPMessage_V1_2_EVM
  : V extends typeof CCIPVersion.V1_5
    ? CCIPMessage_V1_5_EVM
    : CCIPMessage_V1_6_EVM
