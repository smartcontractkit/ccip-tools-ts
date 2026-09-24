import type {
  AddressLookupTableAccount,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionVersion,
  VersionedTransaction,
} from '@solana/web3.js'

import type { SVMExtraArgsV1 } from '../extra-args.ts'
import type { ChainFamily } from '../networks.ts'
import type { CCIPMessage_V1_6 } from '../types.ts'

/** Solana-specific CCIP v1.6 message type with SVM extra args. */
export type CCIPMessage_V1_6_Solana = CCIPMessage_V1_6 & SVMExtraArgsV1

/**
 * Contains unsigned data for a Solana transaction.
 * instructions - array of instructions; may or may not fit in a single transaction
 * mainIndex - index of the main instruction in the array
 * lookupTables - array of lookupTables to be used in *main* transaction
 */
export type UnsignedSolanaTx = {
  family: typeof ChainFamily.Solana
  instructions: TransactionInstruction[]
  mainIndex?: number
  lookupTables?: AddressLookupTableAccount[]
}

/** Minimal Solana wallet interface (anchor.Wallet=) */
export type Wallet = {
  readonly publicKey: PublicKey
  /**
   * Transaction versions the wallet can sign, as in `@solana/wallet-adapter` (`null`: legacy
   * only). Unset means every version, like a keypair's. Without `1` (e.g. Ledger, which can't
   * parse v1 yet), a transaction too large for v0 is split into smaller v0 ones, or rejected
   * as too large, instead of falling back to v1.
   */
  readonly supportedTransactionVersions?: ReadonlySet<TransactionVersion> | null
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>
}

/**
 * Whether a wallet can sign v1 transactions: it either doesn't declare
 * `supportedTransactionVersions`, or declares `1` among them.
 */
export function canSignV1Transactions(wallet: Wallet): boolean {
  const versions = wallet.supportedTransactionVersions
  return versions === undefined || !!versions?.has(1)
}

/** Typeguard for Solana Wallet */
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
