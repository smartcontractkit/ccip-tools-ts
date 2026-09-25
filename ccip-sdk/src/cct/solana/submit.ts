/**
 * Shared sign-and-submit pipeline for Solana CCT operations. Maps simulation/program
 * failures to permanent {@link CCTTxFailedError}, pre-broadcast infra failures to
 * transient {@link CCTTxFailedError}, and post-broadcast confirmation failures to
 * {@link CCTTxNotConfirmedError}.
 *
 * @packageDocumentation
 */

import {
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredNonceInvalidError,
  TransactionExpiredTimeoutError,
} from '@solana/web3.js'

import {
  CCIPPartialTransactionSubmissionError,
  CCIPWalletInvalidError,
  shouldRetry,
} from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import {
  type SolanaSentSlice,
  type SolanaSplitMode,
  simulateAndSendTxs,
} from '../../solana/utils.ts'
import { jsonStringify } from '../../utils.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import type { TransactionResult } from '../operation.ts'

/**
 * Signs, simulates, sends, and confirms a Solana CCT operation.
 *
 * The split mode controls whether an oversized or over-budget instruction list may be split.
 * Each slice is simulated before submission; a later failure retains confirmed slices in the
 * mapped CCT error context.
 *
 * @param chain Solana connection and logger context.
 * @param wallet Wallet that signs and pays for the transaction.
 * @param unsigned Instructions to submit.
 * @param operation CCT operation name used in mapped errors.
 * @param computeUnits Optional compute-unit limit for the slice containing the main instruction.
 * @param split Controls whether simulation failures may split the transaction.
 * @param includeSlices Include every confirmed slice in the result for resource-splitting operations.
 *
 * @throws {@link CCIPWalletInvalidError} If `wallet` cannot sign Solana transactions.
 * @throws {@link CCTTxFailedError} If size validation, simulation, submission, or confirmation fails.
 * For split operations, its context may include `committedHashes`.
 * @throws {@link CCTTxNotConfirmedError} If a broadcast transaction is not confirmed.
 */
export async function submit(
  chain: SolanaChain,
  wallet: unknown,
  unsigned: UnsignedSolanaTx,
  operation: string,
  computeUnits?: number,
  split: SolanaSplitMode = 'atomic',
  includeSlices = false,
): Promise<TransactionResult & { slices?: SolanaSentSlice[] }> {
  if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

  try {
    const result = await simulateAndSendTxs(chain, wallet, unsigned, {
      computeUnits,
      split,
    })
    return includeSlices ? result : { hash: result.hash }
  } catch (error) {
    if (error instanceof CCTTxFailedError || error instanceof CCTTxNotConfirmedError) throw error
    throw createCCTSubmitError(operation, error)
  }
}

/** Maps Solana submit errors to permanent failed vs transient failed/not-confirmed CCT errors. */
export function createCCTSubmitError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>,
): CCTTxFailedError | CCTTxNotConfirmedError {
  const partial = error instanceof CCIPPartialTransactionSubmissionError ? error : undefined
  const cause = partial?.cause ?? error
  const mergedContext = { ...context, ...partial?.context }
  const pendingSignature = partial?.context.pendingSignature
  if (typeof pendingSignature === 'string') {
    return new CCTTxNotConfirmedError(operation, pendingSignature, {
      cause: cause instanceof Error ? cause : undefined,
      context: mergedContext,
    })
  }

  const signature = getSignature(cause)
  if (signature && isNotConfirmedError(cause)) {
    return new CCTTxNotConfirmedError(operation, signature, {
      cause: cause instanceof Error ? cause : undefined,
      context: mergedContext,
    })
  }

  return new CCTTxFailedError(operation, getReason(cause), {
    cause: cause instanceof Error ? cause : undefined,
    isTransient: isTransientSubmitError(cause),
    context: mergedContext,
  })
}

function isTransientSubmitError(error: unknown): boolean {
  return /blockhash|expired/i.test(getReason(error)) || shouldRetry(error)
}

function isNotConfirmedError(error: unknown): boolean {
  return (
    error instanceof TransactionExpiredBlockheightExceededError ||
    error instanceof TransactionExpiredNonceInvalidError ||
    error instanceof TransactionExpiredTimeoutError ||
    /not confirmed|unknown if it succeeded|block height exceeded/i.test(getReason(error))
  )
}

function getReason(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') return jsonStringify(error)
  return String(error)
}

function getSignature(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('signature' in error)) return undefined
  return typeof error.signature === 'string' && error.signature.length > 0
    ? error.signature
    : undefined
}
