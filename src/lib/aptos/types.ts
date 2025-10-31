import type {
  AccountAddress,
  AccountAuthenticator,
  AccountPublicKey,
  AnyRawTransaction,
} from '@aptos-labs/ts-sdk'
import { bcs } from '@mysten/bcs'

export const EVMExtraArgsV2Codec = bcs.struct('EVMExtraArgsV2', {
  gasLimit: bcs.u256(),
  allowOutOfOrderExecution: bcs.bool(),
})

export const SVMExtraArgsV1Codec = bcs.struct('SVMExtraArgsV1', {
  computeUnits: bcs.u32(),
  accountIsWritableBitmap: bcs.u64(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.vector(bcs.u8()),
  accounts: bcs.vector(bcs.vector(bcs.u8())),
})

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

// Aptos Account is synchronous; this specialisation adds async signTransactionWithAuthenticator
export type AptosAsyncAccount = {
  publicKey: AccountPublicKey
  accountAddress: AccountAddress
  signTransactionWithAuthenticator: (
    transaction: AnyRawTransaction,
  ) => Promise<AccountAuthenticator> | AccountAuthenticator
}
