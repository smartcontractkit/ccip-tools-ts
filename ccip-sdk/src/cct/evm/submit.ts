/**
 * Shared EVM submit pipeline for CCT ops. Distinguishes three outcomes: a
 * pre-broadcast failure ({@link CCIPCctTxFailedError}, transient when the cause
 * is network-related), a submitted-but-unconfirmed tx
 * ({@link CCIPCctTxNotConfirmedError}, transient, keeps the hash), and a revert
 * ({@link CCIPCctTxFailedError}).
 *
 * @packageDocumentation
 */

import { type TransactionRequest, type TransactionResponse, isError } from 'ethers'

import {
  CCIPCctTxFailedError,
  CCIPCctTxNotConfirmedError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type EVMChain, isSigner, submitTransaction } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import type { CctTxResult } from '../token-manager.ts'

const CONFIRM_TIMEOUT_MS = 60_000

/** True for ethers infra failures that are worth retrying (vs a real revert). */
function isTransientError(error: unknown): boolean {
  return (
    isError(error, 'TIMEOUT') || isError(error, 'NETWORK_ERROR') || isError(error, 'SERVER_ERROR')
  )
}

/**
 * Signs + submits a single-transaction CCT op and waits for it to mine. The
 * `operation` label is carried into logs and every error's `context.operation`.
 * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
 * @throws {@link CCIPCctTxNotConfirmedError} if submitted but not confirmed in time
 * @throws {@link CCIPCctTxFailedError} if submission fails or the tx reverts
 */
export async function submit(
  chain: EVMChain,
  wallet: unknown,
  unsigned: UnsignedEVMTx,
  operation: string,
): Promise<CctTxResult> {
  if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

  chain.logger.debug(`${operation}: submitting...`)

  let response: TransactionResponse
  try {
    let tx: TransactionRequest = { ...unsigned.transactions[0]! }
    tx = await wallet.populateTransaction(tx)
    tx.from = undefined // some signers reject a pre-populated `from`
    response = await submitTransaction(wallet, tx, chain.provider)
  } catch (error) {
    // Never broadcast — signing/RPC failure; retriable when network-related.
    throw new CCIPCctTxFailedError(
      operation,
      error instanceof Error ? error.message : String(error),
      {
        cause: error instanceof Error ? error : undefined,
        isTransient: isTransientError(error),
      },
    )
  }

  chain.logger.debug(`${operation}: waiting for confirmation, tx =`, response.hash)

  let receipt
  try {
    receipt = await response.wait(1, CONFIRM_TIMEOUT_MS)
  } catch (error) {
    // Broadcast but not confirmed in time — may still mine; keep the hash.
    throw new CCIPCctTxNotConfirmedError(operation, response.hash, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (!receipt) throw new CCIPCctTxNotConfirmedError(operation, response.hash)
  if (receipt.status === 0) {
    throw new CCIPCctTxFailedError(operation, 'transaction reverted', {
      context: { txHash: response.hash },
    })
  }

  chain.logger.info(`${operation}: confirmed, tx =`, response.hash)
  return { txHash: response.hash }
}
