import type {
  AccountAddress,
  AccountAuthenticator,
  AccountPublicKey,
  AnyRawTransaction,
} from '@aptos-labs/ts-sdk'
import { bcs } from '@mysten/bcs'
import { getBytes } from 'ethers'

import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import type { ChainFamily, ExecutionReport } from '../types.ts'
import { getAddressBytes } from '../utils.ts'

/** Aptos account type with async transaction signing capability. */
export type AptosAsyncAccount = {
  publicKey: AccountPublicKey
  accountAddress: AccountAddress
  signTransactionWithAuthenticator: (
    transaction: AnyRawTransaction,
  ) => Promise<AccountAuthenticator> | AccountAuthenticator
}

/** Typeguard for an aptos-ts-sdk-like Account */
export function isAptosAccount(account: unknown): account is AptosAsyncAccount {
  return (
    typeof account === 'object' &&
    account !== null &&
    'publicKey' in account &&
    'accountAddress' in account &&
    'signTransactionWithAuthenticator' in account
  )
}

export const ExecutionReportCodec = bcs.struct('ExecutionReport', {
  sourceChainSelector: bcs.u64(),
  messageId: bcs.fixedArray(32, bcs.u8()),
  headerSourceChainSelector: bcs.u64(),
  destChainSelector: bcs.u64(),
  sequenceNumber: bcs.u64(),
  nonce: bcs.u64(),
  sender: bcs.vector(bcs.u8()),
  data: bcs.vector(bcs.u8()),
  receiver: bcs.fixedArray(32, bcs.u8()),
  gasLimit: bcs.u256(),
  tokenAmounts: bcs.vector(
    bcs.struct('TokenAmounts', {
      sourcePoolAddress: bcs.vector(bcs.u8()),
      destTokenAddress: bcs.fixedArray(32, bcs.u8()),
      destGasAmount: bcs.u32(),
      extraData: bcs.vector(bcs.u8()),
      amount: bcs.u256(),
    }),
  ),
  offchainTokenData: bcs.vector(bcs.vector(bcs.u8())),
  proofs: bcs.vector(bcs.fixedArray(32, bcs.u8())),
})

/**
 * Serializes an execution report for Aptos using BCS encoding.
 * @param execReport - Execution report to serialize.
 * @returns BCS-encoded bytes.
 */
export function serializeExecutionReport(
  execReport: ExecutionReport<CCIPMessage_V1_6_EVM>,
): Uint8Array {
  const message = execReport.message
  return ExecutionReportCodec.serialize({
    sourceChainSelector: message.sourceChainSelector,
    messageId: getBytes(message.messageId),
    headerSourceChainSelector: message.sourceChainSelector,
    destChainSelector: message.destChainSelector,
    sequenceNumber: message.sequenceNumber,
    nonce: message.nonce,
    sender: getAddressBytes(message.sender),
    data: getBytes(message.data),
    receiver: getAddressBytes(message.receiver),
    gasLimit: message.gasLimit,
    tokenAmounts: message.tokenAmounts.map((ta) => ({
      sourcePoolAddress: getAddressBytes(ta.sourcePoolAddress),
      destTokenAddress: getAddressBytes(ta.destTokenAddress),
      destGasAmount: Number(ta.destGasAmount),
      extraData: getBytes(ta.extraData),
      amount: ta.amount,
    })),
    offchainTokenData: execReport.offchainTokenData.map(() => []),
    proofs: execReport.proofs.map((p) => getBytes(p)),
  }).toBytes()
}

/**
 * Unsigned Aptos transactions, BCS-serialized.
 */
export type UnsignedAptosTx = {
  family: typeof ChainFamily.Aptos
  transactions: [Uint8Array]
}
