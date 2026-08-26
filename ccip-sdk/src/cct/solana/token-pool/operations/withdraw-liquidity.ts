import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import type { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveATA } from '../../../../solana/utils.ts'
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
  deriveTokenPoolSignerPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parsePublicKey,
  resolveLockReleasePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'

type PoolProgramRef = LockReleasePoolProgramRef | CustomPoolProgramRef

type WithdrawLiquidityParams = PoolProgramRef & {
  /** Token mint address managed by the lock-release pool. */
  tokenAddress: string
  /** Amount to withdraw in base units. Must be a positive u64. */
  amount: bigint
  /** Pool rebalancer that withdraws liquidity. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedWithdrawLiquidityParams = {
  tokenAddress: PublicKey
  amount: bigint
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana lock-release pool liquidity withdrawal. */
export type GenerateWithdrawLiquidityParams = SolanaGenerateParams<WithdrawLiquidityParams>

/** Unsigned Solana lock-release pool liquidity withdrawal result. */
export type GenerateWithdrawLiquidityResult = UnsignedSolanaTx

/** Parameters for withdrawing Solana lock-release pool liquidity. */
export type ExecuteWithdrawLiquidityParams = SolanaExecuteParams<WithdrawLiquidityParams>

/** Result of withdrawing Solana lock-release pool liquidity. */
export type ExecuteWithdrawLiquidityResult = TransactionResult

/** Withdraws tokens from a lock-release pool into a rebalancer's associated token account. */
export class WithdrawLiquidity extends SolanaOperation<
  WithdrawLiquidityParams,
  UnsignedSolanaTx,
  ParsedWithdrawLiquidityParams
> {
  readonly name = 'withdrawLiquidity'

  /** Parses public keys, validates amount, and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateWithdrawLiquidityParams): ParsedWithdrawLiquidityParams {
    validateBigInt(this.name, 'amount', params.amount, 1n, U64_MAX)

    const poolProgram = resolveLockReleasePoolProgram(this.name, params)
    const payer = parsePublicKey(this.name, 'payer', params.payer)

    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      amount: params.amount,
      poolProgram,
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `withdrawLiquidity` instruction for a lock-release pool. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedWithdrawLiquidityParams,
  ): Promise<UnsignedSolanaTx> {
    const { ata: remoteTokenAccount, tokenProgram } = await resolveATA(
      chain.connection,
      opts.tokenAddress,
      opts.authority,
    )
    const poolSigner = deriveTokenPoolSignerPda(opts.poolProgram, opts.tokenAddress)
    const poolTokenAccount = getAssociatedTokenAddressSync(
      opts.tokenAddress,
      poolSigner,
      true,
      tokenProgram,
    )
    const instruction = await createLockReleaseTokenPoolProgram(chain, opts.poolProgram, opts.payer)
      .methods.withdrawLiquidity(new BN(opts.amount.toString()))
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        tokenProgram,
        mint: opts.tokenAddress,
        poolSigner,
        poolTokenAccount,
        remoteTokenAccount,
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}, amount = ${opts.amount}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the rebalancer wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteWithdrawLiquidityParams,
  ): Promise<ExecuteWithdrawLiquidityResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'withdrawLiquidity requires authority to be the executing wallet. Use generateUnsignedWithdrawLiquidity for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
