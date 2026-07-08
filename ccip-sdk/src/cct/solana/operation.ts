/**
 * Solana {@link Operation} lifecycle: validate → encode → submit.
 * Default execution uses wallet.publicKey as payer; use generateUnsigned* for a custom payer.
 *
 * @packageDocumentation
 */

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../solana/types.ts'
import { simulateAndSendTxs } from '../../solana/utils.ts'
import { CCTTxFailedError } from '../errors.ts'
import { type TransactionHash, Operation } from '../operation.ts'

/** Solana CCT write base. Subclasses supply validation and encoding. */
export abstract class SolanaOperation<
  P extends { payer: string },
  Tx extends UnsignedSolanaTx = UnsignedSolanaTx,
> extends Operation<SolanaChain, P, Tx> {
  /** Encode instructions after params have been validated. */
  protected abstract encode(chain: SolanaChain, params: P): Promise<Tx>

  /** Run {@link validate} and {@link encode}; no signing. */
  async generate(chain: SolanaChain, params: P): Promise<Tx> {
    this.validate(params)
    return this.encode(chain, params)
  }

  /** Generate, sign, simulate, send, and confirm with wallet.publicKey as payer. */
  async execute(chain: SolanaChain, params: P & { wallet: unknown }): Promise<TransactionHash> {
    const { wallet } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    params.payer = wallet.publicKey.toBase58()
    const unsigned = await this.generate(chain, params)

    try {
      return { hash: await simulateAndSendTxs(chain, wallet, unsigned) }
    } catch (error) {
      throw new CCTTxFailedError(
        this.name,
        error instanceof Error ? error.message : String(error),
        {
          cause: error instanceof Error ? error : undefined,
        },
      )
    }
  }
}
