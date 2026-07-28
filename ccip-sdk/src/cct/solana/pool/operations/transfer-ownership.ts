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

/** Parameters shared by token-pool `transferOwnership` generation and execution. */
type TransferOwnershipParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Proposed new owner address (base58). */
  newOwner: string
  /** Pool authority (current owner). Defaults to `payer`. */
  authority?: string
}

/** Parameters for unsigned token-pool `transferOwnership` generation. */
export type GenerateTransferOwnershipParams = SolanaGenerateParams<TransferOwnershipParams>

/** Unsigned token-pool `transferOwnership` result. */
export type GenerateTransferOwnershipResult = UnsignedSolanaTx

/** Parameters for executing token-pool `transferOwnership`. */
export type ExecuteTransferOwnershipParams = SolanaExecuteParams<TransferOwnershipParams>

/** Result of executing token-pool `transferOwnership`. */
export type ExecuteTransferOwnershipResult = TransactionHash

/** Proposes a new owner for a token pool (step 1 of the 2-step ownership transfer). */
export class TransferOwnership extends SolanaOperation<TransferOwnershipParams> {
  readonly name = 'transferOwnership'

  /** Validates addresses before any RPC. */
  protected validate(params: GenerateTransferOwnershipParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    validatePublicKey(this.name, 'newOwner', params.newOwner)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned token-pool `transferOwnership` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateTransferOwnershipParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const proposedOwner = new PublicKey(opts.newOwner)
    const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)

    const state = deriveTokenPoolConfigPda(poolProgramId, mint)
    const program = createTokenPoolProgram(chain, poolProgramId, authority)

    const instruction = await program.methods
      .transferOwnership(proposedOwner)
      .accountsStrict({ state, mint, authority })
      .instruction()

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, newOwner = ${opts.newOwner}, poolProgram = ${poolProgramId.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
