import { createApproveInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import type { PublicKey, TransactionInstruction } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveTokenProgram } from '../../../../solana/utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parsePublicKey,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'

type ApproveTokenParams = {
  /** SPL token mint address. */
  tokenAddress: string
  /** Token account to approve from. Defaults to the authority's associated token account. */
  tokenAccount?: string
  /** Delegate address authorized to transfer tokens. */
  delegate: string
  /**
   * Allowance in base units (not human-readable tokens).
   * E.g., 1_000_000n with 6 decimals = 1 token.
   * Maximum u64: 2^64 - 1.
   */
  amount: bigint
  /** Token account owner. Defaults to `payer` for single-signer transactions. */
  authority?: string
  /** SPL Token multisig member addresses. Required when authority is an SPL Token multisig. */
  multisigSigners?: string[]
}

type ParsedApproveTokenParams = {
  tokenAddress: PublicKey
  tokenAccount?: PublicKey
  delegate: PublicKey
  amount: bigint
  authority: PublicKey
  multisigSigners: PublicKey[]
}

/** Parameters for unsigned Solana SPL Token delegate approval. */
export type GenerateApproveTokenParams = SolanaGenerateParams<ApproveTokenParams>

/** Unsigned Solana SPL Token delegate approval result. */
export type GenerateApproveTokenResult = UnsignedSolanaTx

/** Parameters for executing Solana SPL Token delegate approval. */
export type ExecuteApproveTokenParams = SolanaExecuteParams<ApproveTokenParams>

/** Result of executing Solana SPL Token delegate approval. */
export type ExecuteApproveTokenResult = TransactionResult

/** Approves a delegate to transfer up to an allowance from an SPL token account. */
export class ApproveToken extends SolanaOperation<
  ApproveTokenParams,
  UnsignedSolanaTx,
  ParsedApproveTokenParams
> {
  readonly name = 'approveToken'

  /** Parses public keys, allowance, and optional SPL Token multisig signers. */
  protected override parse(params: GenerateApproveTokenParams): ParsedApproveTokenParams {
    validateBigInt(this.name, 'amount', params.amount, 1n, U64_MAX)
    if (params.multisigSigners !== undefined && !Array.isArray(params.multisigSigners)) {
      throw new CCTParamsInvalidError(this.name, 'multisigSigners', 'must be an array')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      tokenAccount:
        params.tokenAccount === undefined
          ? undefined
          : parsePublicKey(this.name, 'tokenAccount', params.tokenAccount),
      delegate: parsePublicKey(this.name, 'delegate', params.delegate),
      amount: params.amount,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      multisigSigners: (params.multisigSigners ?? []).map((signer, i) =>
        parsePublicKey(this.name, `multisigSigners[${i}]`, signer),
      ),
    }
  }

  /** Builds an SPL Token `Approve` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedApproveTokenParams,
  ): Promise<UnsignedSolanaTx> {
    const tokenProgram = await resolveTokenProgram(chain.connection, opts.tokenAddress)
    const tokenAccount =
      opts.tokenAccount ??
      getAssociatedTokenAddressSync(opts.tokenAddress, opts.authority, true, tokenProgram)

    const instructions: TransactionInstruction[] = [
      createApproveInstruction(
        tokenAccount,
        opts.delegate,
        opts.authority,
        opts.amount,
        opts.multisigSigners,
        tokenProgram,
      ),
    ]

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, tokenAccount = ${tokenAccount.toBase58()}, delegate = ${opts.delegate.toBase58()}, amount = ${opts.amount}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the token account owner wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteApproveTokenParams,
  ): Promise<ExecuteApproveTokenResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (parsed.multisigSigners.length > 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'multisigSigners',
        'requires externally signed transactions; use generateUnsignedApproveToken',
      )
    }

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'approveToken requires authority to be the executing wallet. Use generateUnsignedApproveToken for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
