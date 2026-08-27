import type { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
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
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
  deriveTokenPoolSignerPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parsePublicKey,
  resolveExistingTokenAccount,
  resolveLockReleasePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateDelegation,
} from '../../validate.ts'

type PoolProgramRef = LockReleasePoolProgramRef | CustomPoolProgramRef

type ProvideLiquidityParams = PoolProgramRef & {
  /** Token mint address managed by the lock-release pool. */
  tokenAddress: string
  /** Amount to deposit in base units. Must be a positive u64. */
  amount: bigint
  /** Pool rebalancer that provides liquidity. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedProvideLiquidityParams = {
  tokenAddress: PublicKey
  amount: bigint
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
}

async function validatePoolLiquidityConfig(
  chain: SolanaChain,
  poolProgram: PublicKey,
  mint: PublicKey,
  authority: PublicKey,
): Promise<void> {
  const state = deriveTokenPoolConfigPda(poolProgram, mint)
  const account = await chain.connection.getAccountInfo(state)
  if (!account) throw new CCIPTokenPoolStateNotFoundError(state.toBase58())

  const { config } = decodeTokenPoolState(account.data, {
    tokenPool: state.toBase58(),
    mint: mint.toBase58(),
    poolProgram: poolProgram.toBase58(),
    accountOwner: account.owner.toBase58(),
  })
  if (!config.rebalancer.equals(authority))
    throw new CCTTxFailedError(
      'provideLiquidity',
      `pool rebalancer is ${config.rebalancer.toBase58()}, not ${authority.toBase58()}; set it with setRebalancer first`,
    )
  if (!config.canAcceptLiquidity)
    throw new CCTTxFailedError(
      'provideLiquidity',
      'pool does not accept liquidity; enable it with setCanAcceptLiquidity(true) first',
    )
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
    }
  }

  /** Builds the unsigned Solana `provideLiquidity` instruction for a lock-release pool. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedProvideLiquidityParams,
  ): Promise<UnsignedSolanaTx> {
    // The caller must be the configured rebalancer and the pool must accept deposits.
    await validatePoolLiquidityConfig(chain, opts.poolProgram, opts.tokenAddress, opts.authority)

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
        `source token account ${remoteTokenAccount.toBase58()} has ${remoteTokenAccountInfo.amount}, but ${opts.amount} is required; mint or transfer tokens first`,
      )

    // The pool signer transfers from the rebalancer ATA as its SPL Token delegate.
    validateDelegation(
      this.name,
      remoteTokenAccount,
      remoteTokenAccountInfo,
      poolSigner,
      opts.amount,
    )

    // The pool vault ATA must have been created during pool initialization.
    const { tokenAccount: poolTokenAccount } = await resolveExistingTokenAccount(
      chain.connection,
      opts.tokenAddress,
      poolSigner,
    )

    const instruction = await createLockReleaseTokenPoolProgram(chain, opts.poolProgram, opts.payer)
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

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}, amount = ${opts.amount}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
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
