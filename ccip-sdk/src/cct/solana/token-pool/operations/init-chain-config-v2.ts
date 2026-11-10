import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveTokenPoolChainConfigV2Pda } from '../../../../solana/token-pool.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveTokenProgram } from '../../../../solana/utils.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  createTokenPoolV2Program,
  deriveEventAuthorityPda,
  deriveTokenPoolConfigPda,
  deriveTokenPoolFeeVaultPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  resolveExistingPoolProgram,
  validateAuthorityMatchesWallet,
  validatePoolProgramAtLeast2,
} from '../../validate.ts'
import {
  type ChainConfigV2Params,
  type ParsedChainConfigV2Params,
  parseChainConfigV2Params,
  toSetChainConfigV2Args,
} from './chain-config-v2.ts'

/** Parameters for unsigned Solana token pool chain config v2 initialization. */
export type GenerateInitChainConfigV2Params = SolanaGenerateParams<ChainConfigV2Params>

/** Unsigned Solana token pool chain config v2 initialization result. */
export type GenerateInitChainConfigV2Result = UnsignedSolanaTx

/** Parameters for executing Solana token pool chain config v2 initialization. */
export type ExecuteInitChainConfigV2Params = SolanaExecuteParams<ChainConfigV2Params>

/** Result of executing Solana token pool chain config v2 initialization. */
export type ExecuteInitChainConfigV2Result = TransactionResult

/**
 * Creates a CCIP 2.0 token pool's `ChainConfigV2` for a remote chain: the lane's allowed finality,
 * token transfer fees, and CCVs. Also creates, if missing, the fee vault token account where the
 * lane's in-token BPS fee accrues.
 *
 * @remarks `authority` must be the pool owner and pays the rent. The config must not exist yet;
 * replace it with `editChainConfigV2`.
 */
export class InitChainConfigV2 extends SolanaOperation<
  ChainConfigV2Params,
  UnsignedSolanaTx,
  ParsedChainConfigV2Params
> {
  readonly name = 'initChainConfigV2'

  /** Parses and validates the config as the pool program does, before any RPC. */
  protected override prepare(params: GenerateInitChainConfigV2Params): ParsedChainConfigV2Params {
    return parseChainConfigV2Params(this.name, params)
  }

  /** Builds the unsigned Solana `init_chain_config_v2` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedChainConfigV2Params,
  ): Promise<UnsignedSolanaTx> {
    const mint = opts.tokenAddress
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      mint,
      opts.poolProgramAddress,
    )
    await validatePoolProgramAtLeast2(this.name, chain, poolProgram)
    const tokenProgram = await resolveTokenProgram(chain.connection, mint)
    const feeVault = deriveTokenPoolFeeVaultPda(poolProgram, mint)

    const instruction = await createTokenPoolV2Program(chain, poolProgram, opts.payer)
      .methods.initChainConfigV2(toSetChainConfigV2Args(opts))
      .accountsStrict({
        state: deriveTokenPoolConfigPda(poolProgram, mint),
        chainConfigV2: deriveTokenPoolChainConfigV2Pda(poolProgram, opts.remoteChainSelector, mint),
        authority: opts.authority,
        systemProgram: SystemProgram.programId,
        mint,
        feeVault,
        feeVaultTokenAccount: getAssociatedTokenAddressSync(mint, feeVault, true, tokenProgram),
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        eventAuthority: deriveEventAuthorityPda(poolProgram),
        program: poolProgram,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${mint.toBase58()}, poolProgram = ${poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteInitChainConfigV2Params,
  ): Promise<ExecuteInitChainConfigV2Result> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'initChainConfigV2 requires authority to be the executing wallet. Use generateUnsignedInitChainConfigV2 for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
