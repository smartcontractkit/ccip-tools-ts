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

/** Parameters shared by FTF rate limit update generation and execution. */
type SetFastFinalityRateLimitParams = FastFinalityRateLimitParams & {
  /** Pool owner or rate-limit admin. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

/** Parameters for unsigned Solana token pool FTF rate limit update. */
export type GenerateSetFastFinalityRateLimitParams =
  SolanaGenerateParams<SetFastFinalityRateLimitParams>

/** Unsigned Solana token pool FTF rate limit update result. */
export type GenerateSetFastFinalityRateLimitResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool FTF rate limit update. */
export type ExecuteSetFastFinalityRateLimitParams =
  SolanaExecuteParams<SetFastFinalityRateLimitParams>

/** Result of executing Solana token pool FTF rate limit update. */
export type ExecuteSetFastFinalityRateLimitResult = TransactionResult

/**
 * Sets a CCIP 2.0 token pool's faster-than-finality (FTF) rate limits for a remote chain
 * (`set_chain_config_override_rate_limit`).
 *
 * @remarks `authority` must be the pool owner or rate-limit admin. The FTF override must already
 * exist; create it with `initFastFinalityRateLimit`.
 */
export class SetFastFinalityRateLimit extends SolanaOperation<
  SetFastFinalityRateLimitParams,
  UnsignedSolanaTx,
  ParsedFastFinalityRateLimitParams
> {
  readonly name = 'setFastFinalityRateLimit'

  /** Parses rate limits and defaults authority to payer, before any RPC. */
  protected override prepare(
    params: GenerateSetFastFinalityRateLimitParams,
  ): ParsedFastFinalityRateLimitParams {
    return parseFastFinalityRateLimitParams(this.name, params)
  }

  /** Builds the unsigned Solana `set_chain_config_override_rate_limit` instruction. */
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
      .methods.setChainConfigOverrideRateLimit(toOverrideRateLimitArg(opts))
      .accountsStrict(overrideAccounts(poolProgram, opts))
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner or rate-limit admin wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteSetFastFinalityRateLimitParams,
  ): Promise<ExecuteSetFastFinalityRateLimitResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'setFastFinalityRateLimit requires authority to be the executing wallet. Use generateUnsignedSetFastFinalityRateLimit for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
