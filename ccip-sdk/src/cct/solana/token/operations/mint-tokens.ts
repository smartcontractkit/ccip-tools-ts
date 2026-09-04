import { createMintToInstruction } from '@solana/spl-token'
import { type TransactionInstruction, PublicKey } from '@solana/web3.js'

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
import { submit } from '../../submit.ts'
import {
  U64_MAX,
  parsePublicKey,
  resolveExistingTokenAccount,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'
import { CreateTokenAccount } from './create-token-account.ts'

type MintTokensParams = {
  /** SPL token mint address. */
  tokenAddress: string
  /** Recipient owner address; its ATA must exist unless `createRecipientATA` is set. */
  recipient: string
  /**
   * Amount to mint in base units (not human-readable tokens).
   * E.g., 1_000_000n with 6 decimals = 1 token.
   * Maximum u64: 2^64 - 1.
   */
  amount: bigint
  /** Create the recipient ATA idempotently before minting. Defaults to false. */
  createRecipientATA?: boolean
  /** Mint authority. Defaults to `payer` for single-signer transactions. */
  authority?: string
  /** SPL Token multisig member addresses. Required when authority is an SPL Token multisig. */
  multisigSigners?: string[]
}

type ParsedMintTokensParams = {
  payer: PublicKey
  tokenAddress: PublicKey
  recipient: PublicKey
  amount: bigint
  createRecipientATA: boolean
  authority: PublicKey
  multisigSigners: PublicKey[]
}

/** Parameters for unsigned Solana SPL token minting. */
export type GenerateMintTokensParams = SolanaGenerateParams<MintTokensParams>

/** Unsigned Solana SPL token minting result. */
export type GenerateMintTokensResult = UnsignedSolanaTx

/** Parameters for executing Solana SPL token minting. */
export type ExecuteMintTokensParams = SolanaExecuteParams<MintTokensParams>

/** Result of executing Solana SPL token minting. */
export type ExecuteMintTokensResult = TransactionResult

/** Mints SPL tokens to a recipient's associated token account. */
export class MintTokens extends SolanaOperation<
  MintTokensParams,
  UnsignedSolanaTx,
  ParsedMintTokensParams
> {
  readonly name = 'mintTokens'

  /** Parses public keys, amount, and optional SPL Token multisig signers. */
  protected override parse(params: GenerateMintTokensParams): ParsedMintTokensParams {
    validateBigInt(this.name, 'amount', params.amount, 1n, U64_MAX)
    if (params.multisigSigners !== undefined && !Array.isArray(params.multisigSigners)) {
      throw new CCTParamsInvalidError(this.name, 'multisigSigners', 'must be an array')
    }
    if (params.createRecipientATA !== undefined && typeof params.createRecipientATA !== 'boolean') {
      throw new CCTParamsInvalidError(this.name, 'createRecipientATA', 'must be a boolean')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      payer,
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      recipient: parsePublicKey(this.name, 'recipient', params.recipient),
      amount: params.amount,
      createRecipientATA: params.createRecipientATA ?? false,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      multisigSigners: (params.multisigSigners ?? []).map((signer, i) =>
        parsePublicKey(this.name, `multisigSigners[${i}]`, signer),
      ),
    }
  }

  /** Builds recipient ATA creation, when requested, followed by an SPL Token `MintTo` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedMintTokensParams,
  ): Promise<UnsignedSolanaTx> {
    const createRecipientATA = opts.createRecipientATA
      ? await new CreateTokenAccount().generate(chain, {
          payer: opts.payer.toBase58(),
          tokenAddress: opts.tokenAddress.toBase58(),
          ownerAddress: opts.recipient.toBase58(),
        })
      : undefined

    const existingTokenAccount = opts.createRecipientATA
      ? undefined
      : await resolveExistingTokenAccount(chain.connection, opts.tokenAddress, opts.recipient)

    const tokenAccount = createRecipientATA
      ? new PublicKey(createRecipientATA.tokenAccountAddress)
      : existingTokenAccount!.tokenAccount

    const tokenProgram = createRecipientATA
      ? createRecipientATA.instructions[0]!.keys.at(-1)!.pubkey
      : existingTokenAccount!.tokenProgram

    const instructions: TransactionInstruction[] = [
      ...(createRecipientATA?.instructions ?? []),
      createMintToInstruction(
        opts.tokenAddress,
        tokenAccount,
        opts.authority,
        opts.amount,
        opts.multisigSigners,
        tokenProgram,
      ),
    ]

    chain.logger.debug(
      `${
        this.name
      }: token = ${opts.tokenAddress.toBase58()}, recipient = ${opts.recipient.toBase58()}, amount = ${
        opts.amount
      }`,
    )
    return {
      family: ChainFamily.Solana,
      instructions,
      mainIndex: createRecipientATA ? 1 : 0,
    }
  }

  /** Generate, sign, simulate, send, and confirm with the mint authority wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteMintTokensParams,
  ): Promise<ExecuteMintTokensResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (parsed.multisigSigners.length > 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'multisigSigners',
        'requires externally signed transactions; use generateUnsignedMintTokens',
      )
    }

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'mintTokens requires authority to be the executing wallet. Use generateUnsignedMintTokens for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
