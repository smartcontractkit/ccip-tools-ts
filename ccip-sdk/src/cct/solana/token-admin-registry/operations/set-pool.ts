import { Buffer } from 'buffer'

import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { SolanaOperation } from '../../operation.ts'
import {
  createRouterProgram,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { validatePublicKey } from '../../validate.ts'

/** Parameters for Solana TokenAdminRegistry `setPool`. */
export type SetPoolParams = {
  tokenAddress: string
  address: string
  poolLookupTableAddress: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `setPool` generation. */
export type GenerateSetPoolParams = SetPoolParams & {
  payer: string
  authority?: string
}

/** Solana TokenAdminRegistry `setPool` operation. */
export class SetPool extends SolanaOperation<GenerateSetPoolParams> {
  readonly name = 'setPool'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateSetPoolParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'poolLookupTableAddress', params.poolLookupTableAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
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

    const instruction = await routerProgram.methods
      .setPool(Buffer.from([3, 4, 7]))
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

export const setPool = new SetPool()
