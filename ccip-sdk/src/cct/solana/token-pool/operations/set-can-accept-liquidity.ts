import type { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type CustomPoolProgramRef,
  type LockReleasePoolProgramRef,
  createLockReleaseTokenPoolProgram,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolveLockReleasePoolProgram,
  validateAuthorityMatchesWallet,
} from '../../validate.ts'

/** Parameters shared by Solana lock-release pool liquidity-acceptance generation and execution. */
type SetCanAcceptLiquidityParams = (LockReleasePoolProgramRef | CustomPoolProgramRef) & {
  /** Token mint address managed by the pool. */
  tokenAddress: string
  /** Whether to enable liquidity provision and withdrawal. */
  allow: boolean
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedSetCanAcceptLiquidityParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  allow: boolean
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana lock-release pool liquidity-acceptance configuration. */
export type GenerateSetCanAcceptLiquidityParams = SolanaGenerateParams<SetCanAcceptLiquidityParams>

/** Unsigned Solana lock-release pool liquidity-acceptance configuration result. */
export type GenerateSetCanAcceptLiquidityResult = UnsignedSolanaTx

/** Parameters for executing Solana lock-release pool liquidity-acceptance configuration. */
export type ExecuteSetCanAcceptLiquidityParams = SolanaExecuteParams<SetCanAcceptLiquidityParams>

/** Result of executing Solana lock-release pool liquidity-acceptance configuration. */
export type ExecuteSetCanAcceptLiquidityResult = TransactionResult

/** Sets whether a Solana lock-release token pool accepts liquidity. */
export class SetCanAcceptLiquidity extends SolanaOperation<
  SetCanAcceptLiquidityParams,
  UnsignedSolanaTx,
  ParsedSetCanAcceptLiquidityParams
> {
  readonly name = 'setCanAcceptLiquidity'

  /** Parses public keys, validates `allow`, and defaults authority to payer. */
  protected override parse(
    params: GenerateSetCanAcceptLiquidityParams,
  ): ParsedSetCanAcceptLiquidityParams {
    if (typeof params.allow !== 'boolean') {
      throw new CCTParamsInvalidError(this.name, 'allow', 'must be a boolean')
    }

    const poolProgram = resolveLockReleasePoolProgram(this.name, params)
    const payer = parsePublicKey(this.name, 'payer', params.payer)

    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram,
      allow: params.allow,
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `setCanAcceptLiquidity` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedSetCanAcceptLiquidityParams,
  ): Promise<UnsignedSolanaTx> {
    const instruction = await createLockReleaseTokenPoolProgram(chain, opts.poolProgram, opts.payer)
      .methods.setCanAcceptLiquidity(opts.allow)
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        mint: opts.tokenAddress,
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteSetCanAcceptLiquidityParams,
  ): Promise<ExecuteSetCanAcceptLiquidityResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'setCanAcceptLiquidity requires authority to be the executing wallet. Use generateUnsignedSetCanAcceptLiquidity for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
