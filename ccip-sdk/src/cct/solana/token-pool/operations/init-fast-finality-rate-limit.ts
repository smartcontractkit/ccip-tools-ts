import { SystemProgram } from '@solana/web3.js'

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
  type FastFinalityRateLimitParams,
  type ParsedFastFinalityRateLimitParams,
  overrideAccounts,
  parseFastFinalityRateLimitParams,
  toOverrideRateLimitArg,
} from './fast-finality-rate-limit.ts'

/** Parameters shared by FTF rate limit initialization generation and execution. */
type InitFastFinalityRateLimitParams = FastFinalityRateLimitParams & {
  /**
   * Pool owner, who also pays the override account's rent. Defaults to `payer` for single-signer
   * transactions.
   */
  authority?: string
}

/** Parameters for unsigned Solana token pool FTF rate limit initialization. */
export type GenerateInitFastFinalityRateLimitParams =
  SolanaGenerateParams<InitFastFinalityRateLimitParams>

/** Unsigned Solana token pool FTF rate limit initialization result. */
export type GenerateInitFastFinalityRateLimitResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool FTF rate limit initialization. */
export type ExecuteInitFastFinalityRateLimitParams =
  SolanaExecuteParams<InitFastFinalityRateLimitParams>

/** Result of executing Solana token pool FTF rate limit initialization. */
export type ExecuteInitFastFinalityRateLimitResult = TransactionResult

/**
 * Creates a CCIP 2.0 token pool's faster-than-finality (FTF) rate limits for a remote chain, held
 * in its FTF `ChainConfigOverride` (`init_chain_config_override`).
 *
 * @remarks `authority` must be the pool owner and pays the rent. The override must not exist yet;
 * change it with `setFastFinalityRateLimit`.
 */
export class InitFastFinalityRateLimit extends SolanaOperation<
  InitFastFinalityRateLimitParams,
  UnsignedSolanaTx,
  ParsedFastFinalityRateLimitParams
> {
  readonly name = 'initFastFinalityRateLimit'

  /** Parses rate limits and defaults authority to payer, before any RPC. */
  protected override prepare(
    params: GenerateInitFastFinalityRateLimitParams,
  ): ParsedFastFinalityRateLimitParams {
    return parseFastFinalityRateLimitParams(this.name, params)
  }

  /** Builds the unsigned Solana `init_chain_config_override` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedFastFinalityRateLimitParams,
  ): Promise<UnsignedSolanaTx> {
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      opts.tokenAddress,
      opts.poolProgramAddress,
    )
    await validatePoolProgramAtLeast2(this.name, chain, poolProgram)

    const instruction = await createTokenPoolV2Program(chain, poolProgram, opts.payer)
      .methods.initChainConfigOverride(toOverrideRateLimitArg(opts))
      .accountsStrict({
        ...overrideAccounts(poolProgram, opts),
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteInitFastFinalityRateLimitParams,
  ): Promise<ExecuteInitFastFinalityRateLimitResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'initFastFinalityRateLimit requires authority to be the executing wallet. Use generateUnsignedInitFastFinalityRateLimit for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
