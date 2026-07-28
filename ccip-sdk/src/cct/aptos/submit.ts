/**
 * Signs and submits an unsigned Aptos transaction, returning once confirmed.
 * Shared by every {@link AptosOperation}; mirrors the Solana `submit` helper.
 *
 * @packageDocumentation
 */

import { Deserializer, SimpleTransaction } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../aptos/index.ts'
import { isAptosAccount } from '../../aptos/types.ts'
import { CCIPError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { CCTTxFailedError } from '../errors.ts'
import type { TransactionHash } from '../operation.ts'

/**
 * Signs the first transaction of an unsigned Aptos tx with the given account,
 * submits it, and waits for confirmation.
 *
 * @param chain - Aptos chain to submit through
 * @param wallet - Aptos account with signing capability
 * @param transactions - BCS-serialized `SimpleTransaction` bytes (first is submitted)
 * @param operation - Operation name for error/log context
 * @returns The confirmed transaction hash
 * @throws {@link CCIPWalletInvalidError} if `wallet` is not an Aptos account
 * @throws {@link CCTTxFailedError} if signing, submission, or confirmation fails
 */
export async function submit(
  chain: AptosChain,
  wallet: unknown,
  transactions: [Uint8Array, ...Uint8Array[]],
  operation: string,
): Promise<TransactionHash> {
  if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

  try {
    const unsigned = SimpleTransaction.deserialize(new Deserializer(transactions[0]))
    const senderAuthenticator = await wallet.signTransactionWithAuthenticator(unsigned)
    const pending = await chain.provider.transaction.submit.simple({
      transaction: unsigned,
      senderAuthenticator,
    })
    const { hash } = await chain.provider.waitForTransaction({ transactionHash: pending.hash })
    chain.logger.debug(`${operation}: tx = ${hash}`)
    return { hash }
  } catch (error) {
    if (error instanceof CCIPError) throw error
    throw new CCTTxFailedError(operation, error instanceof Error ? error.message : String(error), {
      cause: error instanceof Error ? error : undefined,
    })
  }
}
