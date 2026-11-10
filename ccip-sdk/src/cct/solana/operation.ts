/**
 * Solana {@link Operation} lifecycle: prepare → build unsigned tx → submit.
 * Default execution uses wallet.publicKey as payer; use generateUnsigned* for a custom payer.
 *
 * @packageDocumentation
 */

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import type { SolanaSplitMode } from '../../solana/utils.ts'
import { type TransactionResult, Operation } from '../operation.ts'
import { submit } from './submit.ts'

/**
 * Drops {@link SolanaChain}'s short-lived `getAccountInfo` memo, so a CCT operation validates
 * against the state earlier operations left, including transactions signed outside the SDK.
 * Consecutive onboarding steps otherwise land within the memo window and read stale accounts.
 */
export function refreshAccountState(chain: SolanaChain): void {
  const connection = chain.connection as
    | { getAccountInfo?: { cache?: { clear(): void } } }
    | undefined
  connection?.getAccountInfo?.cache?.clear()
}

/** Unsigned Solana operation params include an explicit fee payer. */
export type SolanaGenerateParams<P extends object> = P & { payer: string }

/** Signed Solana operation params derive payer from `wallet.publicKey`. */
export type SolanaExecuteParams<P extends object> = P & {
  wallet: unknown
  computeUnits?: number
}

/**
 * Solana CCT write base. Subclasses supply {@link prepare} and {@link buildUnsigned}.
 *
 * Override {@link prepare} for validation, defaults, or conversion; it must be overridden whenever
 * `Parsed` differs from `SolanaGenerateParams<P>`.
 */
export abstract class SolanaOperation<
  P extends object,
  Tx extends UnsignedSolanaTx = UnsignedSolanaTx,
  Parsed = SolanaGenerateParams<P>,
> extends Operation<SolanaChain, SolanaGenerateParams<P>, Tx, TransactionResult, Parsed> {
  /** Multi-transaction safety policy; resource splitting requires an operation-specific audit. */
  protected readonly splitMode: SolanaSplitMode = 'atomic'

  /** Build instructions from validated, parsed params. */
  protected abstract buildUnsigned(chain: SolanaChain, params: Parsed): Promise<Tx>

  /** Run {@link prepare} and {@link buildUnsigned}; no signing. */
  async generate(chain: SolanaChain, params: SolanaGenerateParams<P>): Promise<Tx> {
    refreshAccountState(chain)
    return this.buildUnsigned(chain, this.prepare(params))
  }

  /** Validates the wallet and prepares signed execution parameters with it as payer. */
  protected prepareWalletExecution(chain: SolanaChain, params: SolanaExecuteParams<P>) {
    refreshAccountState(chain)
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey
    return {
      wallet,
      payer,
      computeUnits,
      parsed: this.prepare({ ...rest, payer: payer.toBase58() } as SolanaGenerateParams<P>),
    }
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  async execute(chain: SolanaChain, params: SolanaExecuteParams<P>): Promise<TransactionResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    return submit(
      chain,
      wallet,
      await this.buildUnsigned(chain, parsed),
      this.name,
      computeUnits,
      this.splitMode,
    )
  }
}
