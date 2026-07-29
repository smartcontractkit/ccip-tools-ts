import { Buffer } from 'buffer'

import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  createRouterProgram,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { validatePublicKey, validateWritableIndexes } from '../../validate.ts'

/** Standard BurnMint/LockRelease pool ALT writable positions. */
export const DEFAULT_WRITABLE_INDEXES = [3, 4, 7] as const

/** Parameters shared by Solana TokenAdminRegistry `setPool` generation and execution. */
type SetPoolParams = {
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — the registry itself,
   * a Router, OnRamp, OffRamp, or TokenPool address all work.
   */
  address: string
  /** The pool's Address Lookup Table address, produced by the `createLookupTable` op. */
  poolLookupTableAddress: string
  /**
   * Positions in the pool's own Address Lookup Table the Router marks writable during a
   * transfer. Defaults to {@link DEFAULT_WRITABLE_INDEXES} for standard BurnMint/LockRelease
   * pools; custom pools with extra accounts MUST extend this or the pool CPI gets wrong
   * write-permissions and fails at execution. Each entry is a byte (0–255).
   */
  writableIndexes?: number[]
  /**
   * Token admin authority. Defaults to `payer` for single-signer transactions.
   * Multisig/Squads flows should pass the admin/vault authority explicitly.
   */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `setPool` generation. */
export type GenerateSetPoolParams = SolanaGenerateParams<SetPoolParams>

/** Unsigned Solana TokenAdminRegistry `setPool` result. */
export type GenerateSetPoolResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `setPool`. */
export type ExecuteSetPoolParams = SolanaExecuteParams<SetPoolParams>

/** Result of executing Solana TokenAdminRegistry `setPool`. */
export type ExecuteSetPoolResult = TransactionResult

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
  protected async buildUnsigned(
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
