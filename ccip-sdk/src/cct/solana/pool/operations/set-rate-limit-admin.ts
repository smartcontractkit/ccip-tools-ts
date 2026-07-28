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

/** Parameters shared by token-pool `setRateLimitAdmin` generation and execution. */
type SetRateLimitAdminParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** New rate limit admin address (base58). */
  rateLimitAdmin: string
  /** Pool authority (current owner). Defaults to `payer`. */
  authority?: string
}

/** Parameters for unsigned token-pool `setRateLimitAdmin` generation. */
export type GenerateSetRateLimitAdminParams = SolanaGenerateParams<SetRateLimitAdminParams>

/** Unsigned token-pool `setRateLimitAdmin` result. */
export type GenerateSetRateLimitAdminResult = UnsignedSolanaTx

/** Parameters for executing token-pool `setRateLimitAdmin`. */
export type ExecuteSetRateLimitAdminParams = SolanaExecuteParams<SetRateLimitAdminParams>

/** Result of executing token-pool `setRateLimitAdmin`. */
export type ExecuteSetRateLimitAdminResult = TransactionHash

/** Delegates rate-limit management on a token pool to a separate admin address. */
export class SetRateLimitAdmin extends SolanaOperation<SetRateLimitAdminParams> {
  readonly name = 'setRateLimitAdmin'

  /** Validates addresses before any RPC. */
  protected validate(params: GenerateSetRateLimitAdminParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'rateLimitAdmin', params.rateLimitAdmin)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned token-pool `setRateLimitAdmin` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateSetRateLimitAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const newRateLimitAdmin = new PublicKey(opts.rateLimitAdmin)
    const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)

    const state = deriveTokenPoolConfigPda(poolProgramId, mint)
    const program = createTokenPoolProgram(chain, poolProgramId, authority)

    const instruction = await program.methods
      .setRateLimitAdmin(mint, newRateLimitAdmin)
      .accountsStrict({ state, authority })
      .instruction()

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, admin = ${opts.rateLimitAdmin}, poolProgram = ${poolProgramId.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
