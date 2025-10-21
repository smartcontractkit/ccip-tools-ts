import type { PublicKey } from '@solana/web3.js'

import type { SVMExtraArgsV1, SourceTokenData } from '../extra-args.ts'
import type { CCIPMessage_V1_6, MergeArrayElements } from '../types.ts'

export type CCIPMessage_V1_6_Solana = MergeArrayElements<
  CCIPMessage_V1_6 & SVMExtraArgsV1,
  {
    // SourceTokenData adds `destGasAmount` (decoded from source's `destExecData`);
    // not sure why they kept the "gas" name in Solana, but let's just be keep consistent
    tokenAmounts: readonly SourceTokenData[]
  }
>

declare const _test: CCIPMessage_V1_6_Solana
// _test.tokenAmounts[0].

export interface CcipMessageSentEvent {
  destChainSelector: bigint
  sequenceNumber: bigint
  message: {
    header: RampMessageHeader
    sender: PublicKey
    data: Uint8Array
    receiver: Uint8Array
    extraArgs: Uint8Array
    feeToken: PublicKey
    tokenAmounts: SVM2AnyTokenTransfer[]
    feeTokenAmount: CrossChainAmount
    feeValueJuels: CrossChainAmount
  }
}

export interface CrossChainAmount {
  leBytes: Uint8Array // 32 bytes
}

export interface SVM2AnyTokenTransfer {
  sourcePoolAddress: PublicKey
  destTokenAddress: Uint8Array
  extraData: Uint8Array
  amount: CrossChainAmount
  destExecData: Uint8Array
}

export interface RampMessageHeader {
  messageId: Uint8Array // 32 bytes
  sourceChainSelector: bigint
  destChainSelector: bigint
  sequenceNumber: bigint
  nonce: bigint
}
