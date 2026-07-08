/**
 * Shared sign-and-submit pipeline for EVM CCT operations. Maps broadcast,
 * confirmation, and revert failures to {@link CCTTxFailedError} and
 * {@link CCTTxNotConfirmedError}.
 *
 * @packageDocumentation
 */

import { type TransactionRequest, type TransactionResponse, isError } from 'ethers'

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { type EVMChain, isSigner, submitTransaction } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import type { TransactionHash } from '../operation.ts'

/** Max ms to wait for one confirmation before throwing {@link CCTTxNotConfirmedError}. */
const CONFIRM_TIMEOUT_MS = 60_000

/** True for ethers infra errors worth retrying (not an on-chain revert). */
function isTransientError(error: unknown): boolean {
  return (
    isError(error, 'TIMEOUT') || isError(error, 'NETWORK_ERROR') || isError(error, 'SERVER_ERROR')
  )
}

/**
 * Signs and submits the first transaction in `unsigned`, then waits for one confirmation.
 * `operation` labels logs and error context.
 * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
 * @throws {@link CCTTxNotConfirmedError} if submitted but not confirmed in time
 * @throws {@link CCTTxFailedError} if submission fails or the tx reverts
 */
export async function submit(
  chain: EVMChain,
  wallet: unknown,
  unsigned: UnsignedEVMTx,
  operation: string,
): Promise<TransactionHash> {
  if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

  chain.logger.debug(`${operation}: submitting...`)

  let response: TransactionResponse
  try {
    let tx: TransactionRequest = { ...unsigned.transactions[0]! }
    tx = await wallet.populateTransaction(tx)
    tx.from = undefined // some signers reject a pre-populated `from`
    response = await submitTransaction(wallet, tx, chain.provider)
  } catch (error) {
    throw new CCTTxFailedError(operation, error instanceof Error ? error.message : String(error), {
      cause: error instanceof Error ? error : undefined,
      isTransient: isTransientError(error),
    })
  }

  chain.logger.debug(`${operation}: waiting for confirmation, tx =`, response.hash)

  let receipt
  try {
    receipt = await response.wait(1, CONFIRM_TIMEOUT_MS)
  } catch (error) {
    throw new CCTTxNotConfirmedError(operation, response.hash, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (!receipt) throw new CCTTxNotConfirmedError(operation, response.hash)
  if (receipt.status === 0) {
    throw new CCTTxFailedError(operation, 'transaction reverted', {
      context: { txHash: response.hash },
    })
  }

  chain.logger.info(`${operation}: confirmed, tx =`, response.hash)
  return { hash: response.hash }
}
