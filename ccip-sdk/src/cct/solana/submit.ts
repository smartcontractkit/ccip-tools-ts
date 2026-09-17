/**
 * Shared sign-and-submit pipeline for Solana CCT operations. Maps simulation/program
 * failures to permanent {@link CCTTxFailedError}, pre-broadcast infra failures to
 * transient {@link CCTTxFailedError}, and post-broadcast confirmation failures to
 * {@link CCTTxNotConfirmedError}.
 *
 * @packageDocumentation
 */

import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredNonceInvalidError,
  TransactionExpiredTimeoutError,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { CCIPWalletInvalidError, shouldRetry } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, type Wallet, isWallet } from '../../solana/types.ts'
import { simulateTransaction } from '../../solana/utils.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import type { TransactionResult } from '../operation.ts'

const MAX_COMPUTE_UNITS = 1_400_000

function buildTransaction(
  payer: PublicKey,
  instructions: UnsignedSolanaTx['instructions'],
  lookupTables: UnsignedSolanaTx['lookupTables'],
  computeUnits?: number,
  recentBlockhash = PublicKey.default.toBase58(),
): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash,
      instructions: [
        ...(computeUnits === undefined
          ? []
          : [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })]),
        ...instructions,
      ],
    }).compileToV0Message(lookupTables),
  )
}

function exceedsTransactionSize(tx: VersionedTransaction): boolean {
  try {
    return tx.serialize().length > PACKET_DATA_SIZE
  } catch (error) {
    if (error instanceof Error && error.message.includes('encoding overruns Uint8Array')) {
      return true
    }
    throw error
  }
}

function getTransactionSlice(unsigned: UnsignedSolanaTx, start: number, end: number) {
  const includesMain =
    unsigned.mainIndex != null && start <= unsigned.mainIndex && unsigned.mainIndex < end
  return {
    includesMain,
    instructions: unsigned.instructions.slice(start, end),
    // Lookup tables may be needed by instructions in any slice.
    lookupTables: unsigned.lookupTables,
  }
}

/**
 * Submits CCT instruction slices, splitting only after local size-overflow detection.
 *
 * A simulation failure aborts its slice without submitting it. Confirmed earlier slices are
 * attached as `committedHashes` when a later slice fails. Set `requireSingleTransaction` for
 * operations that must never be split.
 */
async function simulateAndSendCCTTxs(
  chain: SolanaChain,
  wallet: Wallet,
  unsigned: UnsignedSolanaTx,
  operation: string,
  computeUnits?: number,
  requireSingleTransaction = false,
): Promise<string> {
  let mainHash: string | undefined
  const committedHashes: string[] = []
  try {
    for (let start = 0; start < unsigned.instructions.length;) {
      let end = unsigned.instructions.length
      let slice = getTransactionSlice(unsigned, start, end)

      while (
        exceedsTransactionSize(
          buildTransaction(
            wallet.publicKey,
            slice.instructions,
            slice.lookupTables,
            MAX_COMPUTE_UNITS,
          ),
        )
      ) {
        if (requireSingleTransaction || --end === start) {
          throw new CCTTxFailedError(
            operation,
            `transaction exceeds Solana's ${PACKET_DATA_SIZE}-byte limit`,
          )
        }
        slice = getTransactionSlice(unsigned, start, end)
      }

      const simulated = await simulateTransaction(chain, {
        payerKey: wallet.publicKey,
        instructions: slice.instructions,
        addressLookupTableAccounts: slice.lookupTables,
      })
      const units = simulated.unitsConsumed || 0
      const limit = computeUnits ?? (units > 200_000 ? Math.ceil(units * 1.1) : undefined)

      const blockhash = await chain.connection.getLatestBlockhash('confirmed')
      const tx = buildTransaction(
        wallet.publicKey,
        slice.instructions,
        slice.lookupTables,
        limit,
        blockhash.blockhash,
      )
      const signed = await wallet.signTransaction(tx)
      const hash = await chain.connection.sendTransaction(signed)
      await chain.connection.confirmTransaction({ signature: hash, ...blockhash }, 'confirmed')
      committedHashes.push(hash)
      if (slice.includesMain) mainHash = hash
      start = end
    }
    if (!mainHash) throw new CCTTxFailedError(operation, 'transaction has no main instruction')
    return mainHash
  } catch (error) {
    if (!committedHashes.length) throw error
    throw createCCTSubmitError(operation, error, { committedHashes })
  }
}

/**
 * Signs, simulates, sends, and confirms a Solana CCT operation.
 *
 * Oversized instruction lists are split only after a local serialized-size check. Each slice is
 * simulated before submission; program and simulation failures are rethrown without shrinking the
 * slice. When a later slice fails, `CCTTxFailedError.context.committedHashes` lists prior slices
 * that were confirmed.
 *
 * @param requireSingleTransaction Reject an oversized instruction list instead of splitting it.
 * Use this for operations that promise atomicity.
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
  requireSingleTransaction?: boolean,
): Promise<TransactionResult> {
  if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

  try {
    return {
      hash: await simulateAndSendCCTTxs(
        chain,
        wallet,
        unsigned,
        operation,
        computeUnits,
        requireSingleTransaction,
      ),
    }
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
  const signature = getSignature(error)
  if (signature && isNotConfirmedError(error)) {
    return new CCTTxNotConfirmedError(operation, signature, {
      cause: error instanceof Error ? error : undefined,
      context,
    })
  }

  return new CCTTxFailedError(operation, getReason(error), {
    cause: error instanceof Error ? error : undefined,
    isTransient: isTransientSubmitError(error),
    context,
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
