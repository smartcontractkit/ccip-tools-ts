import type {
  AddressLookupTableAccount,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js'

import type { SVMExtraArgsV1 } from '../extra-args.ts'
import type { CCIPMessage_V1_6 } from '../types.ts'

// SourceTokenData adds `destGasAmount` (decoded from source's `destExecData`);
// not sure why they kept the "gas" name in Solana, but let's just be keep consistent
export type CCIPMessage_V1_6_Solana = CCIPMessage_V1_6 & SVMExtraArgsV1

/**
 * Contains unsigned data for a Solana transaction.
 * instructions - array of instructions; may or may not fit in a single transaction
 * mainIndex - index of the main instruction in the array
 * lookupTables - array of lookupTables to be used in *main* transaction
 */
export type UnsignedTx = {
  instructions: TransactionInstruction[]
  mainIndex?: number
  lookupTables?: AddressLookupTableAccount[]
}

export type Wallet = {
  readonly publicKey: PublicKey
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
}

export function isWallet(wallet: unknown): wallet is Wallet {
  return (
    typeof wallet === 'object' &&
    wallet !== null &&
    'publicKey' in wallet &&
    'signTransaction' in wallet &&
    typeof wallet.publicKey === 'object' &&
    wallet.publicKey !== null &&
    'toBase58' in wallet.publicKey &&
    typeof wallet.publicKey.toBase58 === 'function' &&
    typeof wallet.signTransaction === 'function'
  )
}
