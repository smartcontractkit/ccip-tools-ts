import { type GenerateSetPoolParams, type SetPoolParams, SetPool } from './operations/set-pool.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../solana/types.ts'
import type { TransactionHash } from '../../operation.ts'
import type { SolanaExecuteParams } from '../operation.ts'

/** TokenAdminRegistry CCT operations for a Solana Router program. */
export class SolanaTokenAdminRegistryClient {
  readonly chain: SolanaChain
  readonly #setPool = new SetPool()

  /** Creates a TokenAdminRegistry client for an existing Solana chain. */
  constructor(chain: SolanaChain) {
    this.chain = chain
  }

  /** Builds unsigned Solana `setPool` instructions. */
  generateUnsignedSetPool(opts: GenerateSetPoolParams): Promise<UnsignedSolanaTx> {
    return this.#setPool.generate(this.chain, opts)
  }

  /** Registers a token pool. */
  setPool(opts: SolanaExecuteParams<SetPoolParams>): Promise<TransactionHash> {
    return this.#setPool.execute(this.chain, opts)
  }
}

export type { GenerateSetPoolParams, SetPoolParams } from './operations/set-pool.ts'
