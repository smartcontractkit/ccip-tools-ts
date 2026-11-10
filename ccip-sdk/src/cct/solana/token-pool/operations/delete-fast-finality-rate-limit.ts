import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { createTokenPoolV2Program } from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  resolveExistingPoolProgram,
  validateAuthorityMatchesWallet,
  validatePoolProgramAtLeast2,
} from '../../validate.ts'
import {
  type FastFinalityRateLimitRef,
  type ParsedFastFinalityRateLimitRef,
  overrideAccounts,
  parseFastFinalityRateLimitRef,
  toOverrideRefArg,
} from './fast-finality-rate-limit.ts'

/** Parameters shared by FTF rate limit deletion generation and execution. */
type DeleteFastFinalityRateLimitParams = FastFinalityRateLimitRef & {
  /**
   * Pool owner, who receives the override account's rent. Defaults to `payer` for single-signer
   * transactions.
   */
  authority?: string
}

/** Parameters for unsigned Solana token pool FTF rate limit deletion. */
export type GenerateDeleteFastFinalityRateLimitParams =
  SolanaGenerateParams<DeleteFastFinalityRateLimitParams>

/** Unsigned Solana token pool FTF rate limit deletion result. */
export type GenerateDeleteFastFinalityRateLimitResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool FTF rate limit deletion. */
export type ExecuteDeleteFastFinalityRateLimitParams =
  SolanaExecuteParams<DeleteFastFinalityRateLimitParams>

/** Result of executing Solana token pool FTF rate limit deletion. */
export type ExecuteDeleteFastFinalityRateLimitResult = TransactionResult

/**
 * Deletes a CCIP 2.0 token pool's faster-than-finality (FTF) rate limits for a remote chain,
 * closing its FTF `ChainConfigOverride` (`delete_chain_config_override`).
 *
 * @remarks `authority` must be the pool owner and receives the rent.
 */
export class DeleteFastFinalityRateLimit extends SolanaOperation<
  DeleteFastFinalityRateLimitParams,
  UnsignedSolanaTx,
  ParsedFastFinalityRateLimitRef
> {
  readonly name = 'deleteFastFinalityRateLimit'

  /** Parses public keys and defaults authority to payer, before any RPC. */
  protected override prepare(
    params: GenerateDeleteFastFinalityRateLimitParams,
  ): ParsedFastFinalityRateLimitRef {
    return parseFastFinalityRateLimitRef(this.name, params)
  }

  /** Builds the unsigned Solana `delete_chain_config_override` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedFastFinalityRateLimitRef,
  ): Promise<UnsignedSolanaTx> {
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      opts.tokenAddress,
      opts.poolProgramAddress,
    )
    await validatePoolProgramAtLeast2(this.name, chain, poolProgram)

    const instruction = await createTokenPoolV2Program(chain, poolProgram, opts.payer)
      .methods.deleteChainConfigOverride(toOverrideRefArg(opts))
      .accountsStrict(overrideAccounts(poolProgram, opts))
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteDeleteFastFinalityRateLimitParams,
  ): Promise<ExecuteDeleteFastFinalityRateLimitResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'deleteFastFinalityRateLimit requires authority to be the executing wallet. Use generateUnsignedDeleteFastFinalityRateLimit for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
