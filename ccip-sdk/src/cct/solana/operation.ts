/**
 * Solana {@link Operation} lifecycle: validate → encode → submit.
 * Default execution uses wallet.publicKey as payer; use generateUnsigned* for a custom payer.
 *
 * @packageDocumentation
 */

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import { type TransactionHash, Operation } from '../operation.ts'
import { submit } from './submit.ts'

/** Unsigned Solana operation params include an explicit fee payer. */
export type SolanaGenerateParams<P extends object> = P & { payer: string }

/** Signed Solana operation params derive payer from `wallet.publicKey`. */
export type SolanaExecuteParams<P extends object> = P & {
  wallet: unknown
}

function withPayer<P extends object>(
  params: SolanaExecuteParams<P>,
  payer: string,
): SolanaGenerateParams<P> {
  const { wallet: _wallet, ...rest } = params
  return { ...rest, payer } as SolanaGenerateParams<P>
}

/** Solana CCT write base. Subclasses supply validation and encoding. */
export abstract class SolanaOperation<P extends object> extends Operation<
  SolanaChain,
  SolanaGenerateParams<P>,
  UnsignedSolanaTx
> {
  /** Encode instructions after params have been validated. */
  protected abstract encode(
    chain: SolanaChain,
    params: SolanaGenerateParams<P>,
  ): Promise<UnsignedSolanaTx>

  /** Run {@link validate} and {@link encode}; no signing. */
  async generate(chain: SolanaChain, params: SolanaGenerateParams<P>): Promise<UnsignedSolanaTx> {
    this.validate(params)
    return this.encode(chain, params)
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  async execute(chain: SolanaChain, params: SolanaExecuteParams<P>): Promise<TransactionHash> {
    const { wallet } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generate(chain, withPayer(params, wallet.publicKey.toBase58()))
    return submit(chain, wallet, unsigned, this.name)
  }
}
