import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

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
import {
  deriveTokenPoolChainConfigPda,
  discoverPoolInfo,
  validateDeleteChainConfig,
} from './common.ts'

/** Parameters shared by token-pool `deleteChainConfig` generation and execution. */
type DeleteChainConfigParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Remote chain selector whose config PDA is closed. */
  remoteChainSelector: bigint
  /** Pool authority. Defaults to `payer`; pass a vault/multisig authority explicitly. */
  authority?: string
}

/** Parameters for unsigned token-pool `deleteChainConfig` generation. */
export type GenerateDeleteChainConfigParams = SolanaGenerateParams<DeleteChainConfigParams>

/** Unsigned token-pool `deleteChainConfig` result. */
export type GenerateDeleteChainConfigResult = UnsignedSolanaTx

/** Parameters for executing token-pool `deleteChainConfig`. */
export type ExecuteDeleteChainConfigParams = SolanaExecuteParams<DeleteChainConfigParams>

/** Result of executing token-pool `deleteChainConfig`. */
export type ExecuteDeleteChainConfigResult = TransactionHash

/** Removes an entire remote chain configuration from a token pool. */
export class DeleteChainConfig extends SolanaOperation<DeleteChainConfigParams> {
  readonly name = 'deleteChainConfig'

  /** Validates addresses and selector before any RPC. */
  protected validate(params: GenerateDeleteChainConfigParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    validateDeleteChainConfig(this.name, params.poolAddress, params.remoteChainSelector)
  }

  /** Builds the unsigned token-pool `deleteChainConfig` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateDeleteChainConfigParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)

    const state = deriveTokenPoolConfigPda(poolProgramId, mint)
    const chainConfig = deriveTokenPoolChainConfigPda(poolProgramId, opts.remoteChainSelector, mint)
    const program = createTokenPoolProgram(chain, poolProgramId, authority)

    const instruction = await program.methods
      .deleteChainConfig(new BN(opts.remoteChainSelector.toString()), mint)
      .accountsStrict({ state, chainConfig, authority })
      .instruction()

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, remoteChainSelector = ${opts.remoteChainSelector}, poolProgram = ${poolProgramId.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
