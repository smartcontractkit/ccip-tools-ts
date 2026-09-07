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
  type CustomPoolProgramRef,
  type LockReleasePoolProgramRef,
  createLockReleaseTokenPoolProgram,
  deriveTokenPoolConfigPda,
  deriveTokenPoolSignerPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import { ApproveToken } from '../../token/operations/approve-token.ts'
import {
  U64_MAX,
  parsePublicKey,
  resolveExistingTokenAccount,
  resolveLockReleasePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateDelegation,
  validatePoolLiquidityConfig,
} from '../../validate.ts'

type PoolProgramRef = LockReleasePoolProgramRef | CustomPoolProgramRef

type ProvideLiquidityParams = PoolProgramRef & {
  /** Token mint address managed by the lock-release pool. */
  tokenAddress: string
  /** Amount to deposit in base units. Must be a positive u64. */
  amount: bigint
  /** Pool rebalancer whose ATA for `tokenAddress` must hold `amount`. Defaults to `payer`. */
  authority?: string
  /** Add an SPL Token approval for the pool signer before providing liquidity in the same transaction. */
  includeApproval?: boolean
}

type ParsedProvideLiquidityParams = {
  tokenAddress: PublicKey
  amount: bigint
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
  includeApproval: boolean
}

/** Parameters for unsigned Solana lock-release pool liquidity provision. */
export type GenerateProvideLiquidityParams = SolanaGenerateParams<ProvideLiquidityParams>

/** Unsigned Solana lock-release pool liquidity provision result. */
export type GenerateProvideLiquidityResult = UnsignedSolanaTx

/** Parameters for providing Solana lock-release pool liquidity. */
export type ExecuteProvideLiquidityParams = SolanaExecuteParams<ProvideLiquidityParams>

/** Result of providing Solana lock-release pool liquidity. */
export type ExecuteProvideLiquidityResult = TransactionResult

/** Deposits tokens from a rebalancer's associated token account into a lock-release pool. */
export class ProvideLiquidity extends SolanaOperation<
  ProvideLiquidityParams,
  UnsignedSolanaTx,
  ParsedProvideLiquidityParams
> {
  readonly name = 'provideLiquidity'

  /** Parses public keys, validates amount, and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateProvideLiquidityParams): ParsedProvideLiquidityParams {
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
      includeApproval: params.includeApproval ?? false,
    }
  }

  /** Builds the unsigned Solana `provideLiquidity` instruction for a lock-release pool. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedProvideLiquidityParams,
  ): Promise<UnsignedSolanaTx> {
    // The caller must be the configured rebalancer and the pool must accept deposits.
    await validatePoolLiquidityConfig(
      this.name,
      chain,
      opts.poolProgram,
      opts.tokenAddress,
      opts.authority,
    )

    // The rebalancer's source ATA must exist.
    const {
      tokenAccount: remoteTokenAccount,
      tokenProgram,
      account: remoteTokenAccountInfo,
    } = await resolveExistingTokenAccount(chain.connection, opts.tokenAddress, opts.authority)
    const poolSigner = deriveTokenPoolSignerPda(opts.poolProgram, opts.tokenAddress)

    // Avoid an opaque SPL Token insufficient-funds failure.
    if (remoteTokenAccountInfo.amount < opts.amount)
      throw new CCTTxFailedError(
        this.name,
        `source token account ${remoteTokenAccount.toBase58()} has ${
          remoteTokenAccountInfo.amount
        }, but ${opts.amount} is required; mint or transfer tokens first`,
      )

    // The pool signer transfers from the rebalancer ATA as its SPL Token delegate.
    if (!opts.includeApproval) {
      validateDelegation(
        this.name,
        remoteTokenAccount,
        remoteTokenAccountInfo,
        poolSigner,
        opts.amount,
      )
    }

    // The pool vault ATA must have been created during pool initialization.
    const { tokenAccount: poolTokenAccount } = await resolveExistingTokenAccount(
      chain.connection,
      opts.tokenAddress,
      poolSigner,
    )

    const provideLiquidityInstruction = await createLockReleaseTokenPoolProgram(
      chain,
      opts.poolProgram,
      opts.payer,
    )
      .methods.provideLiquidity(new BN(opts.amount.toString()))
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

    const approval = opts.includeApproval
      ? await new ApproveToken().generate(chain, {
          payer: opts.payer.toBase58(),
          tokenAddress: opts.tokenAddress.toBase58(),
          delegate: poolSigner.toBase58(),
          amount: opts.amount,
          authority: opts.authority.toBase58(),
        })
      : undefined

    chain.logger.debug(
      `${
        this.name
      }: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}, amount = ${
        opts.amount
      }`,
    )

    return {
      family: ChainFamily.Solana,
      instructions: [...(approval?.instructions ?? []), provideLiquidityInstruction],
      mainIndex: approval ? 1 : 0,
    }
  }

  /** Generate, sign, simulate, send, and confirm with the rebalancer wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteProvideLiquidityParams,
  ): Promise<ExecuteProvideLiquidityResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'provideLiquidity requires authority to be the executing wallet. Use generateUnsignedProvideLiquidity for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
