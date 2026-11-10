import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
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
  type PoolProgramRef,
  createTokenPoolV2Program,
  deriveTokenPoolConfigPda,
  deriveTokenPoolFeeVaultPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validatePoolProgramAtLeast2,
} from '../../validate.ts'

/** Parameters shared by Solana token pool fee withdrawal generation and execution. */
type WithdrawFeeTokensParams = PoolProgramRef & {
  /** Token mint address managed by the pool whose fees to withdraw. */
  tokenAddress: string
  /**
   * Mint of the fee token to withdraw: the token senders paid the pool's fees in, such as LINK or
   * wrapped SOL, or `tokenAddress` itself for the in-token BPS fee. The pool keeps one balance per
   * fee token.
   */
  feeTokenAddress: string
  /**
   * Owner of the account that receives the fees: a wallet or vault address. Its associated token
   * account for `feeTokenAddress` is created first if missing, with `payer` paying the rent.
   */
  recipient: string
  /** Amount to withdraw in the fee token's base units (`u64`). Defaults to the whole balance. */
  amount?: bigint
  /** Pool owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedWithdrawFeeTokensParams = {
  tokenAddress: PublicKey
  poolProgramAddress?: PublicKey
  feeTokenAddress: PublicKey
  recipient: PublicKey
  amount?: bigint
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana token pool fee withdrawal. */
export type GenerateWithdrawFeeTokensParams = SolanaGenerateParams<WithdrawFeeTokensParams>

/** Unsigned Solana token pool fee withdrawal result. */
export type GenerateWithdrawFeeTokensResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool fee withdrawal. */
export type ExecuteWithdrawFeeTokensParams = SolanaExecuteParams<WithdrawFeeTokensParams>

/** Result of executing Solana token pool fee withdrawal. */
export type ExecuteWithdrawFeeTokensResult = TransactionResult

/**
 * Withdraws the fees a CCIP 2.0 token pool accrued in one fee token while serving a mint.
 *
 * @remarks `authority` must be the pool owner. The pool's balance in the fee token must be
 * positive and at least `amount`.
 */
export class WithdrawFeeTokens extends SolanaOperation<
  WithdrawFeeTokensParams,
  UnsignedSolanaTx,
  ParsedWithdrawFeeTokensParams
> {
  readonly name = 'withdrawFeeTokens'

  /** Parses public keys and the amount, and defaults authority to payer, before any RPC. */
  protected override prepare(
    params: GenerateWithdrawFeeTokensParams,
  ): ParsedWithdrawFeeTokensParams {
    if (params.amount !== undefined) validateBigInt(this.name, 'amount', params.amount, 1n, U64_MAX)
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgramAddress: parseOptionalPublicKey(
        this.name,
        'poolProgramAddress',
        params.poolProgramAddress,
      ),
      feeTokenAddress: parsePublicKey(this.name, 'feeTokenAddress', params.feeTokenAddress),
      recipient: parsePublicKey(this.name, 'recipient', params.recipient),
      amount: params.amount,
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the recipient token account creation and the `withdraw_fee_tokens` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedWithdrawFeeTokensParams,
  ): Promise<UnsignedSolanaTx> {
    const { tokenAddress: mint, feeTokenAddress: feeMint } = opts
    const poolProgram = await resolveExistingPoolProgram(
      this.name,
      chain,
      mint,
      opts.poolProgramAddress,
    )
    await validatePoolProgramAtLeast2(this.name, chain, poolProgram)
    const { ata: recipient, tokenProgram: feeTokenProgram } = await resolveATA(
      chain.connection,
      feeMint,
      opts.recipient,
    )
    const feeVault = deriveTokenPoolFeeVaultPda(poolProgram, mint)

    const instructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        opts.payer,
        recipient,
        opts.recipient,
        feeMint,
        feeTokenProgram,
      ),
      await createTokenPoolV2Program(chain, poolProgram, opts.payer)
        .methods.withdrawFeeTokens(
          opts.amount === undefined ? null : new BN(opts.amount.toString()),
        )
        .accountsStrict({
          state: deriveTokenPoolConfigPda(poolProgram, mint),
          mint,
          feeVault,
          feeVaultTokenAccount: getAssociatedTokenAddressSync(
            feeMint,
            feeVault,
            true,
            feeTokenProgram,
          ),
          recipient,
          feeTokenMint: feeMint,
          feeTokenProgram,
          authority: opts.authority,
        })
        .instruction(),
    ]

    chain.logger.debug(
      `${this.name}: token = ${mint.toBase58()}, poolProgram = ${poolProgram.toBase58()}, feeToken = ${feeMint.toBase58()}, recipient = ${recipient.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 1 }
  }

  /** Generate, sign, simulate, send, and confirm with the pool owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteWithdrawFeeTokensParams,
  ): Promise<ExecuteWithdrawFeeTokensResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'withdrawFeeTokens requires authority to be the executing wallet. Use generateUnsignedWithdrawFeeTokens for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
