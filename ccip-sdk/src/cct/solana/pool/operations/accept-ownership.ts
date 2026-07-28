import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { createTokenPoolProgram, deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { validatePublicKey } from '../../validate.ts'
import { discoverPoolInfo } from './common.ts'

/** Parameters shared by token-pool `acceptOwnership` generation and execution. */
type AcceptOwnershipParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Pool authority (proposed owner). Defaults to `payer`. */
  authority?: string
}

/** Parameters for unsigned token-pool `acceptOwnership` generation. */
export type GenerateAcceptOwnershipParams = SolanaGenerateParams<AcceptOwnershipParams>

/** Unsigned token-pool `acceptOwnership` result. */
export type GenerateAcceptOwnershipResult = UnsignedSolanaTx

/** Parameters for executing token-pool `acceptOwnership`. */
export type ExecuteAcceptOwnershipParams = SolanaExecuteParams<AcceptOwnershipParams>

/** Result of executing token-pool `acceptOwnership`. */
export type ExecuteAcceptOwnershipResult = TransactionHash

/** Accepts a proposed ownership transfer on a token pool (step 2 of the 2-step transfer). */
export class AcceptOwnership extends SolanaOperation<AcceptOwnershipParams> {
  readonly name = 'acceptOwnership'

  /** Validates addresses before any RPC. */
  protected validate(params: GenerateAcceptOwnershipParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned token-pool `acceptOwnership` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateAcceptOwnershipParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)

    const state = deriveTokenPoolConfigPda(poolProgramId, mint)
    const program = createTokenPoolProgram(chain, poolProgramId, authority)

    const instruction = await program.methods
      .acceptOwnership()
      .accountsStrict({ state, mint, authority })
      .instruction()

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, poolProgram = ${poolProgramId.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
