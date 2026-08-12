/**
 * Solana {@link Operation} lifecycle: prepare (validate → parse) → build unsigned tx → submit.
 * Default execution uses wallet.publicKey as payer; use generateUnsigned* for a custom payer.
 *
 * @packageDocumentation
 */

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import { type TransactionResult, Operation } from '../operation.ts'
import { submit } from './submit.ts'

/** Unsigned Solana operation params include an explicit fee payer. */
export type SolanaGenerateParams<P extends object> = P & { payer: string }

/** Signed Solana operation params derive payer from `wallet.publicKey`. */
export type SolanaExecuteParams<P extends object> = P & {
  wallet: unknown
  computeUnits?: number
}

/**
 * Solana CCT write base. Subclasses supply {@link parse} and {@link buildUnsigned}.
 *
 * Override {@link parse} for validation, defaults, or conversion; it must be overridden whenever
 * `Parsed` differs from `SolanaGenerateParams<P>`.
 */
export abstract class SolanaOperation<
  P extends object,
  Tx extends UnsignedSolanaTx = UnsignedSolanaTx,
  Parsed = SolanaGenerateParams<P>,
> extends Operation<SolanaChain, SolanaGenerateParams<P>, Tx, TransactionResult> {
  /**
   * Optional validation hook required by the shared CCT operation contract.
   *
   * The default performs no validation. Prefer {@link parse} for Solana operation validation and
   * normalization; override this only when parsing is unnecessary.
   */
  protected validate(_params: SolanaGenerateParams<P>): void {}

  /**
   * Normalize params without mutating the caller's input.
   *
   * The default returns params unchanged. Override this method whenever `Parsed` differs from
   * `SolanaGenerateParams<P>`, for example to apply defaults, convert values, or validate fields.
   */
  protected parse(params: SolanaGenerateParams<P>): Parsed {
    return params as Parsed
  }

  /** Validates and normalizes params for generation or custom execution flows. */
  protected prepare(params: SolanaGenerateParams<P>): Parsed {
    this.validate(params)
    return this.parse(params)
  }

  /** Build instructions from validated, parsed params. */
  protected abstract buildUnsigned(chain: SolanaChain, params: Parsed): Promise<Tx>

  /** Run {@link prepare} and {@link buildUnsigned}; no signing. */
  async generate(chain: SolanaChain, params: SolanaGenerateParams<P>): Promise<Tx> {
    return this.buildUnsigned(chain, this.prepare(params))
  }

  /** Validates the wallet and prepares signed execution parameters with it as payer. */
  protected prepareWalletExecution(params: SolanaExecuteParams<P>) {
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
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
