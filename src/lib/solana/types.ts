import type { BN } from '@coral-xyz/anchor'
import type { PublicKey } from '@solana/web3.js'

export interface CcipCctpMessageSentEvent {
  originalSender: PublicKey
  remoteChainSelector: BN
  msgTotalNonce: BN
  eventAddress: PublicKey
  sourceDomain: number
  cctpNonce: BN
  messageSentBytes: Uint8Array
}

export interface CcipCctpMessageAndAttestation {
  message: {
    data: Uint8Array
  }
  attestation: Uint8Array
}

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
