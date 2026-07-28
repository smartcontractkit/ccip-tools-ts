/**
 * Aptos {@link Operation} lifecycle: validate → build unsigned tx → submit.
 * Generation needs an explicit `sender` address; execution derives it from
 * `wallet.accountAddress`. Mirrors the Solana operation base.
 *
 * @packageDocumentation
 */

import type { AptosChain } from '../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../aptos/types.ts'
import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { type TransactionHash, Operation } from '../operation.ts'
import { submit } from './submit.ts'

/** Unsigned Aptos operation params carry the sender address explicitly. */
export type AptosGenerateParams<P extends object> = P & { sender: string }

/** Signed Aptos operation params derive the sender from `wallet.accountAddress`. */
export type AptosExecuteParams<P extends object> = P & { wallet: unknown }

function withSender<P extends object>(
  params: AptosExecuteParams<P>,
  sender: string,
): AptosGenerateParams<P> {
  const { wallet: _wallet, ...rest } = params
  return { ...rest, sender } as AptosGenerateParams<P>
}

/** Aptos CCT write base. Subclasses supply {@link validate} and {@link buildUnsigned}. */
export abstract class AptosOperation<
  P extends object,
  Tx extends UnsignedAptosTx = UnsignedAptosTx,
  Result = TransactionHash,
> extends Operation<AptosChain, AptosGenerateParams<P>, Tx, Result> {
  /** Build the unsigned transaction(s) after params have been validated. */
  protected abstract buildUnsigned(chain: AptosChain, params: AptosGenerateParams<P>): Promise<Tx>

  /** Map the confirmed hash to the op's result; deploy ops override to add addresses. */
  protected resultFromGenerated(hash: TransactionHash, _tx: Tx): Result {
    return hash as Result
  }

  /** Run {@link validate} and {@link buildUnsigned}; no signing. */
  async generate(chain: AptosChain, params: AptosGenerateParams<P>): Promise<Tx> {
    this.validate(params)
    return this.buildUnsigned(chain, params)
  }

  /** Generate with the wallet's address as sender, then sign, submit, and confirm. */
  async execute(chain: AptosChain, params: AptosExecuteParams<P>): Promise<Result> {
    const { wallet } = params
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const tx = await this.generate(chain, withSender(params, wallet.accountAddress.toString()))
    const hash = await submit(chain, wallet, tx.transactions, this.name)
    return this.resultFromGenerated(hash, tx)
  }
}
