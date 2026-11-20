import { SystemProgram } from '@solana/web3.js'

import { CCIPTokenPoolChainConfigNotFoundError } from '../../../../errors/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { deriveTokenPoolChainConfigV2Pda } from '../../../../solana/token-pool.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
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
  type TokenPoolChainConfigV2Fields,
  parseChainConfigV2Params,
  readTokenPoolChainConfigV2,
  toSetChainConfigV2Args,
} from './chain-config-v2.ts'

/** Parameters for unsigned Solana token pool chain config v2 replacement. */
export type GenerateEditChainConfigV2Params = SolanaGenerateParams<ChainConfigV2Params>

/** Unsigned Solana token pool chain config v2 replacement result. */
export type GenerateEditChainConfigV2Result = UnsignedSolanaTx

/** Parameters for executing Solana token pool chain config v2 replacement. */
export type ExecuteEditChainConfigV2Params = SolanaExecuteParams<ChainConfigV2Params>

/** Result of executing Solana token pool chain config v2 replacement. */
export type ExecuteEditChainConfigV2Result = TransactionResult

/** Parsed edit params: config fields are unset when omitted, to be kept from the lane. */
type ParsedEditChainConfigV2Params = Omit<
  ParsedChainConfigV2Params,
  keyof TokenPoolChainConfigV2Fields
> &
  Partial<TokenPoolChainConfigV2Fields>

/** Each config field of the edit params, with the param that sets it. */
const CONFIG_FIELDS = [
  ['allowedFinalityConfig', 'allowedFinality'],
  ['tokenTransferFeeConfig', 'tokenTransferFeeConfig'],
  ['ccvConfig', 'ccvConfig'],
] as const

/** A selector's network name for errors, or the selector itself if the network is unknown. */
function remoteNetworkName(selector: bigint): string {
  try {
    return networkInfo(selector).name
  } catch {
    return selector.toString()
  }
}

/**
 * Edits a CCIP 2.0 token pool's `ChainConfigV2` for a remote chain: the lane's allowed finality,
 * token transfer fees, and CCVs.
 *
 * @remarks Each of `allowedFinality`, `tokenTransferFeeConfig` and `ccvConfig` replaces that part
 * of the config in full when passed, and keeps its current value when omitted: the current config
 * is read when the transaction is built and written back unchanged (`ccvConfig: {}` clears the
 * CCVs). `authority` must be the pool owner and pays for any growth of the account. The config
 * must exist; create it with `initChainConfigV2`.
 */
export class EditChainConfigV2 extends SolanaOperation<
  ChainConfigV2Params,
  UnsignedSolanaTx,
  ParsedEditChainConfigV2Params
> {
  readonly name = 'editChainConfigV2'

  /** Parses and validates the config as the pool program does, before any RPC. */
  protected override prepare(
    params: GenerateEditChainConfigV2Params,
  ): ParsedEditChainConfigV2Params {
    const parsed: ParsedEditChainConfigV2Params = parseChainConfigV2Params(this.name, params)
    for (const [field, param] of CONFIG_FIELDS)
      if (params[param] === undefined) delete parsed[field]
    return parsed
  }

  /**
   * Builds the unsigned Solana `edit_chain_config_v2` instruction, carrying over the lane's current
   * value of each omitted config field.
   * @throws {@link CCIPTokenPoolChainConfigNotFoundError} if a config field was omitted and the lane
   *   has no `ChainConfigV2` to keep it from.
   */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedEditChainConfigV2Params,
  ): Promise<UnsignedSolanaTx> {
    const mint = opts.tokenAddress
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      mint,
      opts.poolProgramAddress,
    )
    await validatePoolProgramAtLeast2(this.name, chain, poolProgram)
    const chainConfigV2 = deriveTokenPoolChainConfigV2Pda(
      poolProgram,
      opts.remoteChainSelector,
      mint,
    )

    const kept = CONFIG_FIELDS.filter(([field]) => !opts[field]).map(([field]) => field)
    let config = opts as ParsedChainConfigV2Params
    if (kept.length) {
      const current = await readTokenPoolChainConfigV2(
        chain,
        poolProgram,
        mint,
        opts.remoteChainSelector,
      )
      if (!current)
        throw new CCIPTokenPoolChainConfigNotFoundError(
          chainConfigV2.toBase58(),
          deriveTokenPoolConfigPda(poolProgram, mint).toBase58(),
          remoteNetworkName(opts.remoteChainSelector),
          { context: { operation: this.name, remoteChainSelector: opts.remoteChainSelector } },
        )
      config = { ...current, ...opts } as ParsedChainConfigV2Params
      chain.logger.debug(`${this.name}: keeping the lane's current ${kept.join(', ')}`)
    }

    const instruction = await createTokenPoolV2Program(chain, poolProgram, opts.payer)
      .methods.editChainConfigV2(toSetChainConfigV2Args(config))
      .accountsStrict({
        state: deriveTokenPoolConfigPda(poolProgram, mint),
        chainConfigV2,
        authority: opts.authority,
        systemProgram: SystemProgram.programId,
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
    params: ExecuteEditChainConfigV2Params,
  ): Promise<ExecuteEditChainConfigV2Result> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'editChainConfigV2 requires authority to be the executing wallet. Use generateUnsignedEditChainConfigV2 for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
