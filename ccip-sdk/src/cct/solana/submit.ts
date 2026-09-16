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

import { CCIPWalletInvalidError, shouldRetry } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import { simulateAndSendTxs } from '../../solana/utils.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import type { TransactionResult } from '../operation.ts'

/** Signs, simulates, sends, and confirms a Solana CCT transaction. */
export async function submit(
  chain: SolanaChain,
  wallet: unknown,
  unsigned: UnsignedSolanaTx,
  operation: string,
  computeUnits?: number,
): Promise<TransactionResult> {
  if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

  try {
    return { hash: await simulateAndSendTxs(chain, wallet, unsigned, computeUnits) }
  } catch (error) {
    throw createCCTSubmitError(operation, error)
  }
}

/** Maps Solana submit errors to permanent failed vs transient failed/not-confirmed CCT errors. */
export function createCCTSubmitError(
  operation: string,
  error: unknown,
): CCTTxFailedError | CCTTxNotConfirmedError {
  const signature = getSignature(error)
  if (signature && isNotConfirmedError(error)) {
    return new CCTTxNotConfirmedError(operation, signature, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  return new CCTTxFailedError(operation, getReason(error), {
    cause: error instanceof Error ? error : undefined,
    isTransient: isTransientSubmitError(error),
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
  return error instanceof Error ? error.message : String(error)
}

function getSignature(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('signature' in error)) return undefined
  return typeof error.signature === 'string' && error.signature.length > 0
    ? error.signature
    : undefined
}
