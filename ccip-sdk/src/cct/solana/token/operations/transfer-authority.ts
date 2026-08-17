import { AuthorityType, createSetAuthorityInstruction } from '@solana/spl-token'
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
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'

/** SPL Token authority roles that can be transferred. */
export const TOKEN_AUTHORITY_TYPES = {
  MINT: 'mint',
  FREEZE: 'freeze',
} as const

/** SPL Token authority role that can be transferred. */
export type TokenAuthorityType = (typeof TOKEN_AUTHORITY_TYPES)[keyof typeof TOKEN_AUTHORITY_TYPES]

type TransferAuthorityParams = {
  /** SPL token mint address. */
  tokenAddress: string
  /** Address to receive the selected authority roles, or null to revoke them permanently. */
  newAuthority: string | null
  /** Current authority. Defaults to `payer` for single-signer transactions. */
  authority?: string
  /** SPL Token multisig member addresses. Required when authority is an SPL Token multisig. */
  multisigSigners?: string[]
  /** Authority roles to transfer. */
  authorityTypes: TokenAuthorityType[]
}

type ParsedTransferAuthorityParams = {
  tokenAddress: PublicKey
  newAuthority: PublicKey | null
  authority: PublicKey
  multisigSigners: PublicKey[]
  authorityTypes: TokenAuthorityType[]
}

/** Parameters for unsigned Solana SPL Token authority transfer. */
export type GenerateTransferAuthorityParams = SolanaGenerateParams<TransferAuthorityParams>

/** Unsigned Solana SPL Token authority transfer result. */
export type GenerateTransferAuthorityResult = UnsignedSolanaTx

/** Parameters for executing Solana SPL Token authority transfer. */
export type ExecuteTransferAuthorityParams = SolanaExecuteParams<TransferAuthorityParams>

/** Result of executing Solana SPL Token authority transfer. */
export type ExecuteTransferAuthorityResult = TransactionResult

const SPL_AUTHORITY_TYPES: Record<TokenAuthorityType, AuthorityType> = {
  mint: AuthorityType.MintTokens,
  freeze: AuthorityType.FreezeAccount,
}

/**
 * Immediately transfers mint authority, freeze authority, or both for an SPL Token mint; there is
 * no propose-and-accept step.
 *
 * @remarks
 * Once confirmed, the current authority loses the selected roles. All selected roles must have the
 * same current authority. Supply `multisigSigners` when that authority is an SPL Token multisig. Set
 * `newAuthority` to null to revoke the selected roles permanently; a revoked mint or freeze
 * authority cannot be transferred. The instructions share one atomic Solana transaction, so no role
 * changes if any selected transfer fails.
 */
export class TransferAuthority extends SolanaOperation<
  TransferAuthorityParams,
  UnsignedSolanaTx,
  ParsedTransferAuthorityParams
> {
  readonly name = 'transferAuthority'

  /** Parses public keys and validates the selected authority roles. */
  protected override parse(params: GenerateTransferAuthorityParams): ParsedTransferAuthorityParams {
    const authorityTypes = params.authorityTypes
    if (!Array.isArray(authorityTypes)) {
      throw new CCTParamsInvalidError(this.name, 'authorityTypes', 'must be an array')
    }
    if (authorityTypes.length === 0) {
      throw new CCTParamsInvalidError(this.name, 'authorityTypes', 'must not be empty')
    }
    if (new Set(authorityTypes).size !== authorityTypes.length) {
      throw new CCTParamsInvalidError(this.name, 'authorityTypes', 'must not contain duplicates')
    }
    if (authorityTypes.some((type) => !Object.values(TOKEN_AUTHORITY_TYPES).includes(type))) {
      throw new CCTParamsInvalidError(
        this.name,
        'authorityTypes',
        'must contain only mint and/or freeze',
      )
    }

    if (params.multisigSigners !== undefined && !Array.isArray(params.multisigSigners)) {
      throw new CCTParamsInvalidError(this.name, 'multisigSigners', 'must be an array')
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      newAuthority:
        params.newAuthority === null
          ? null
          : parsePublicKey(this.name, 'newAuthority', params.newAuthority),
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      multisigSigners: (params.multisigSigners ?? []).map((signer, i) =>
        parsePublicKey(this.name, `multisigSigners[${i}]`, signer),
      ),
      authorityTypes,
    }
  }

  /** Builds one SPL Token `SetAuthority` instruction for each selected authority role. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedTransferAuthorityParams,
  ): Promise<UnsignedSolanaTx> {
    const tokenProgram = await resolveTokenProgram(chain.connection, opts.tokenAddress)
    const instructions: TransactionInstruction[] = opts.authorityTypes.map((authorityType) =>
      createSetAuthorityInstruction(
        opts.tokenAddress,
        opts.authority,
        SPL_AUTHORITY_TYPES[authorityType],
        opts.newAuthority,
        opts.multisigSigners,
        tokenProgram,
      ),
    )

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, authorityTypes = ${opts.authorityTypes.join(',')}, newAuthority = ${opts.newAuthority?.toBase58() ?? 'revoked'}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the current authority wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteTransferAuthorityParams,
  ): Promise<ExecuteTransferAuthorityResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (parsed.multisigSigners.length > 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'multisigSigners',
        'requires externally signed transactions; use generateUnsignedTransferAuthority',
      )
    }

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'transferAuthority requires authority to be the executing wallet. Use generateUnsignedTransferAuthority for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
