import type { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTTxFailedError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type PoolProgramRef,
  createLockReleaseTokenPoolProgram,
  deriveTokenPoolSignerPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolConfig,
  resolveExistingTokenAccount,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateLockReleasePoolProgram,
  validatePoolLiquidityConfig,
} from '../../validate.ts'

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
  poolProgramAddress?: PublicKey
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

    const payer = parsePublicKey(this.name, 'payer', params.payer)

    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      amount: params.amount,
      poolProgramAddress: parseOptionalPublicKey(
        this.name,
        'poolProgramAddress',
        params.poolProgramAddress,
      ),
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
    // One pool state read resolves the program and yields the liquidity config.
    const { poolProgram, state, config } = await resolveExistingPoolConfig(
      this.name,
      chain,
      opts.tokenAddress,
      opts.poolProgramAddress,
    )
    await validateLockReleasePoolProgram(this.name, chain, poolProgram, opts.poolProgramAddress)
    // The caller must be the configured rebalancer and the pool must accept withdrawals.
    validatePoolLiquidityConfig(this.name, config, opts.authority)

    // The rebalancer's destination ATA must exist.
    const { tokenAccount: remoteTokenAccount, tokenProgram } = await resolveExistingTokenAccount(
      chain.connection,
      opts.tokenAddress,
      opts.authority,
    )
    const poolSigner = deriveTokenPoolSignerPda(poolProgram, opts.tokenAddress)

    // The pool vault ATA must have been created during pool initialization and hold the withdrawal.
    const { tokenAccount: poolTokenAccount, account: poolTokenAccountInfo } =
      await resolveExistingTokenAccount(chain.connection, opts.tokenAddress, poolSigner)

    // Avoid an opaque SPL Token insufficient-funds failure.
    if (poolTokenAccountInfo.amount < opts.amount) {
      throw new CCTTxFailedError(
        this.name,
        `pool token account ${poolTokenAccount.toBase58()} has ${poolTokenAccountInfo.amount}, but ${opts.amount} is required`,
      )
    }

    const instruction = await createLockReleaseTokenPoolProgram(chain, poolProgram, opts.payer)
      .methods.withdrawLiquidity(new BN(opts.amount.toString()))
      .accountsStrict({
        state,
        tokenProgram,
        mint: opts.tokenAddress,
        poolSigner,
        poolTokenAccount,
        remoteTokenAccount,
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${poolProgram.toBase58()}, amount = ${opts.amount}`,
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
