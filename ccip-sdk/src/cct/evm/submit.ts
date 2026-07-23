/**
 * Shared sign-and-submit pipeline for EVM CCT operations. Maps broadcast and
 * confirmation failures to {@link CCTTxFailedError} / {@link CCTTxNotConfirmedError},
 * and on-chain reverts to {@link CCIPExecTxRevertedError}. Operations map the
 * confirmed `{ response, receipt }` to their own result shape.
 *
 * @packageDocumentation
 */

import {
  type TransactionReceipt,
  type TransactionRequest,
  type TransactionResponse,
  isError,
} from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type EVMChain, isSigner, submitTransaction } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'

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
 * Returns the broadcast `response` and mined `receipt`; callers map these to their
 * own result shape (see {@link EVMOperation.execute}).
 * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
 * @throws {@link CCTTxFailedError} if submission fails before broadcast
 * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
 * @throws {@link CCTTxNotConfirmedError} if broadcast but not confirmed in time
 */
export async function submit(
  chain: EVMChain,
  wallet: unknown,
  unsigned: UnsignedEVMTx,
  operation: string,
): Promise<{ response: TransactionResponse; receipt: TransactionReceipt }> {
  if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)
  const sender = await wallet.getAddress()
  chain.logger.debug(`${operation}: submitting...`)

  let response: TransactionResponse
  let nonceConsumed = false
  try {
    let tx: TransactionRequest = { ...unsigned.transactions[0]! }
    tx.from = undefined // drop any builder-set sender before populate, else ethers throws on a from/signer mismatch
    if (tx.nonce == null) {
      tx.nonce = await chain.nextNonce(sender)
      nonceConsumed = true
    }
    tx = await wallet.populateTransaction(tx)
    tx.from = undefined // some signers reject a pre-populated `from`
    response = await submitTransaction(wallet, tx, chain.provider)
  } catch (error) {
    if (nonceConsumed) chain.rollbackNonce(sender)
    throw new CCTTxFailedError(operation, error instanceof Error ? error.message : String(error), {
      cause: error instanceof Error ? error : undefined,
      isTransient: isTransientError(error),
    })
  }

  chain.logger.debug(`${operation}: waiting for confirmation, tx =`, response.hash)

  let receipt: TransactionReceipt | null
  try {
    receipt = await response.wait(1, CONFIRM_TIMEOUT_MS)
  } catch (error) {
    if (isError(error, 'CALL_EXCEPTION')) {
      // mined revert — permanent; reuse the core revert error so consumers catch
      // one type across core `execute` and CCT ops.
      throw new CCIPExecTxRevertedError(response.hash, { cause: error, context: { operation } })
    }
    // broadcast already succeeded; any non-revert error leaves the tx in an unknown state
    throw new CCTTxNotConfirmedError(operation, response.hash, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (!receipt) throw new CCTTxNotConfirmedError(operation, response.hash)

  chain.logger.info(`${operation}: confirmed, tx =`, response.hash)
  return { response, receipt }
}
