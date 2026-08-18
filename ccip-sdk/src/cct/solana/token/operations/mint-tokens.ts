import { TokenAccountNotFoundError, createMintToInstruction, getAccount } from '@solana/spl-token'
import type { PublicKey, TransactionInstruction } from '@solana/web3.js'

import { CCIPTokenAccountNotFoundError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { resolveATA } from '../../../../solana/utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'

type MintTokensParams = {
  /** SPL token mint address. */
  tokenAddress: string
  /** Wallet or PDA owner of the recipient associated token account. */
  recipient: string
  /** Amount to mint in base units. Must be a positive bigint. */
  amount: bigint
  /** Mint authority. Defaults to `payer` for single-signer transactions. */
  authority?: string
  /** SPL Token multisig member addresses. Required when authority is an SPL Token multisig. */
  multisigSigners?: string[]
}

type ParsedMintTokensParams = {
  tokenAddress: PublicKey
  recipient: PublicKey
  amount: bigint
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

/** Mints SPL tokens to a recipient's existing associated token account. */
export class MintTokens extends SolanaOperation<
  MintTokensParams,
  UnsignedSolanaTx,
  ParsedMintTokensParams
> {
  readonly name = 'mintTokens'

  /** Parses public keys, amount, and optional SPL Token multisig signers. */
  protected override parse(params: GenerateMintTokensParams): ParsedMintTokensParams {
    if (typeof params.amount !== 'bigint' || params.amount <= 0n) {
      throw new CCTParamsInvalidError(this.name, 'amount', 'must be a positive bigint')
    }
    if (params.multisigSigners !== undefined && !Array.isArray(params.multisigSigners)) {
      throw new CCTParamsInvalidError(this.name, 'multisigSigners', 'must be an array')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      recipient: parsePublicKey(this.name, 'recipient', params.recipient),
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

  /** Builds an SPL Token `MintTo` instruction for the recipient's associated token account. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedMintTokensParams,
  ): Promise<UnsignedSolanaTx> {
    const { ata, tokenProgram } = await resolveATA(
      chain.connection,
      opts.tokenAddress,
      opts.recipient,
    )
    try {
      await getAccount(chain.connection, ata, undefined, tokenProgram)
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError) {
        throw new CCIPTokenAccountNotFoundError(
          opts.tokenAddress.toBase58(),
          opts.recipient.toBase58(),
        )
      }
      throw error
    }

    const instructions: TransactionInstruction[] = [
      createMintToInstruction(
        opts.tokenAddress,
        ata,
        opts.authority,
        opts.amount,
        opts.multisigSigners,
        tokenProgram,
      ),
    ]

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, recipient = ${opts.recipient.toBase58()}, amount = ${opts.amount}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
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
