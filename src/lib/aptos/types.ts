import type {
  AccountAddress,
  AccountAuthenticator,
  AccountPublicKey,
  AnyRawTransaction,
} from '@aptos-labs/ts-sdk'
import { bcs } from '@mysten/bcs'

export const EVMExtraArgsV2codec = bcs.struct('EVMExtraArgsV2', {
  gasLimit: bcs.u256(),
  allowOutOfOrderExecution: bcs.bool(),
})

export const SVMExtraArgsV1codec = bcs.struct('SVMExtraArgsV1', {
  computeUnits: bcs.u32(),
  accountIsWritableBitmap: bcs.u64(),
  allowOutOfOrderExecution: bcs.bool(),
  tokenReceiver: bcs.vector(bcs.u8()),
  accounts: bcs.vector(bcs.vector(bcs.u8())),
})

// Aptos Account is synchronous; this specialisation adds async signTransactionWithAuthenticator
export type AptosAsyncAccount = {
  publicKey: AccountPublicKey
  accountAddress: AccountAddress
  signTransactionWithAuthenticator: (
    transaction: AnyRawTransaction,
  ) => Promise<AccountAuthenticator> | AccountAuthenticator
}
