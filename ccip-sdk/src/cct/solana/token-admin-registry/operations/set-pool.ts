import { Buffer } from 'buffer'

import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { type SolanaGenerateParams, SolanaOperation } from '../../operation.ts'
import {
  createRouterProgram,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { validatePublicKey, validateWritableIndexes } from '../../validate.ts'

/** Standard BurnMint/LockRelease pool ALT writable positions. */
export const DEFAULT_WRITABLE_INDEXES = [3, 4, 7] as const

/** Parameters for Solana TokenAdminRegistry `setPool`. */
export type SetPoolParams = {
  tokenAddress: string
  address: string
  poolLookupTableAddress: string
  writableIndexes?: number[]
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `setPool` generation. */
export type GenerateSetPoolParams = SolanaGenerateParams<SetPoolParams>

/** Solana TokenAdminRegistry `setPool` operation. */
export class SetPool extends SolanaOperation<SetPoolParams> {
  readonly name = 'setPool'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateSetPoolParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'poolLookupTableAddress', params.poolLookupTableAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    validateWritableIndexes(this.name, 'writableIndexes', params.writableIndexes)
  }

  /** Builds the unsigned Solana `setPool` instruction set. */
  protected async encode(
    chain: SolanaChain,
    opts: GenerateSetPoolParams,
  ): Promise<UnsignedSolanaTx> {
    const routerAddress = await chain.getTokenAdminRegistryFor(opts.address)
    const router = new PublicKey(routerAddress)
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const lookupTable = new PublicKey(opts.poolLookupTableAddress)

    const routerProgram = createRouterProgram(chain, router, payer)
    const config = deriveRouterConfigPda(router)
    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, tokenMint)

    const writableIndexes = opts.writableIndexes ?? [...DEFAULT_WRITABLE_INDEXES]
    const instruction = await routerProgram.methods
      .setPool(Buffer.from(writableIndexes))
      .accounts({
        config,
        tokenAdminRegistry,
        mint: tokenMint,
        poolLookuptable: lookupTable,
        authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${tokenMint.toBase58()}, lookupTable = ${lookupTable.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
