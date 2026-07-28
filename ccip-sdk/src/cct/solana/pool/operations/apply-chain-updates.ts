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
import { validatePublicKey } from '../../validate.ts'
import {
  type RemoteChainConfig,
  buildApplyChainUpdatesInstructions,
  validateApplyChainUpdates,
} from './common.ts'

/** Parameters shared by token-pool `applyChainUpdates` generation and execution. */
type ApplyChainUpdatesParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Remote chain selectors to remove (can be empty). */
  remoteChainSelectorsToRemove: bigint[]
  /** Remote chain configurations to add (can be empty). */
  chainsToAdd: RemoteChainConfig[]
  /** Pool authority. Defaults to `payer`; pass a vault/multisig authority explicitly. */
  authority?: string
}

/** Parameters for unsigned token-pool `applyChainUpdates` generation. */
export type GenerateApplyChainUpdatesParams = SolanaGenerateParams<ApplyChainUpdatesParams>

/** Unsigned token-pool `applyChainUpdates` result. */
export type GenerateApplyChainUpdatesResult = UnsignedSolanaTx

/** Parameters for executing token-pool `applyChainUpdates`. */
export type ExecuteApplyChainUpdatesParams = SolanaExecuteParams<ApplyChainUpdatesParams>

/** Result of executing token-pool `applyChainUpdates`. */
export type ExecuteApplyChainUpdatesResult = TransactionHash

/** Configures remote chains on a burn-mint/lock-release token pool. */
export class ApplyChainUpdates extends SolanaOperation<ApplyChainUpdatesParams> {
  readonly name = 'applyChainUpdates'

  /** Validates addresses and update fields before any RPC. */
  protected validate(params: GenerateApplyChainUpdatesParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    validateApplyChainUpdates(this.name, params.poolAddress, params.chainsToAdd)
  }

  /** Builds the unsigned token-pool `applyChainUpdates` instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateApplyChainUpdatesParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const { instructions, poolProgramId } = await buildApplyChainUpdatesInstructions(chain, {
      operation: this.name,
      poolAddress: opts.poolAddress,
      authority,
      remoteChainSelectorsToRemove: opts.remoteChainSelectorsToRemove,
      chainsToAdd: opts.chainsToAdd,
    })

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, poolProgram = ${poolProgramId.toBase58()}, instructions = ${instructions.length}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }
}
