import {
  type CreateLookupTableResult,
  type GenerateCreateLookupTableParams,
  type GenerateCreateLookupTableResult,
  CreateLookupTable,
} from './operations/create-lookup-table.ts'
import { type GenerateSetPoolParams, SetPool } from './operations/set-pool.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../solana/types.ts'
import type { TransactionHash } from '../../operation.ts'

/** Solana TokenAdminRegistry CCT operations. */
export class SolanaTokenAdminRegistryClient {
  readonly chain: SolanaChain
  readonly #createLookupTable = new CreateLookupTable()
  readonly #setPool = new SetPool()

  /** Creates a TokenAdminRegistry client for an existing Solana chain. */
  constructor(chain: SolanaChain) {
    this.chain = chain
  }

  /** Builds unsigned Solana pool lookup table create+extend instructions. */
  generateUnsignedCreateLookupTable(
    opts: GenerateCreateLookupTableParams,
  ): Promise<GenerateCreateLookupTableResult> {
    return this.#createLookupTable.generate(this.chain, opts)
  }

  /** Creates and extends a Solana pool lookup table. */
  createLookupTable(
    opts: GenerateCreateLookupTableParams & { wallet: unknown },
  ): Promise<CreateLookupTableResult> {
    return this.#createLookupTable.execute(this.chain, opts)
  }

  /** Builds unsigned Solana `setPool` instructions. */
  generateUnsignedSetPool(opts: GenerateSetPoolParams): Promise<UnsignedSolanaTx> {
    return this.#setPool.generate(this.chain, opts)
  }

  /** Registers a token pool. */
  setPool(opts: GenerateSetPoolParams & { wallet: unknown }): Promise<TransactionHash> {
    return this.#setPool.execute(this.chain, opts)
  }
}

export type {
  CreateLookupTableParams,
  CreateLookupTableResult,
  GenerateCreateLookupTableParams,
  GenerateCreateLookupTableResult,
} from './operations/create-lookup-table.ts'
export type { GenerateSetPoolParams, SetPoolParams } from './operations/set-pool.ts'
