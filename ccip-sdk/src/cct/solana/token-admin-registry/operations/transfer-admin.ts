import { PublicKey } from '@solana/web3.js'

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
  createRouterProgram,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'

/** Parameters shared by Solana TokenAdminRegistry `transferAdmin` generation and execution. */
type TransferAdminParams = {
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp
   * address works.
   */
  address: string
  /** The administrator proposed to accept the token's registry admin role. */
  newAdmin: string
  /** Current token admin. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `transferAdmin` generation. */
export type GenerateTransferAdminParams = SolanaGenerateParams<TransferAdminParams>

type ParsedTransferAdminParams = {
  tokenMint: PublicKey
  address: PublicKey
  newAdmin: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Unsigned Solana TokenAdminRegistry `transferAdmin` result. */
export type GenerateTransferAdminResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `transferAdmin`. */
export type ExecuteTransferAdminParams = SolanaExecuteParams<TransferAdminParams>

/** Result of executing Solana TokenAdminRegistry `transferAdmin`. */
export type ExecuteTransferAdminResult = TransactionResult

/** Transfers a TokenAdminRegistry administrator role. The proposed admin must accept separately. */
export class TransferAdmin extends SolanaOperation<
  TransferAdminParams,
  UnsignedSolanaTx,
  ParsedTransferAdminParams
> {
  readonly name = 'transferAdmin'

  /** Parses all public keys before any RPC. */
  protected override parse(params: GenerateTransferAdminParams): ParsedTransferAdminParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenMint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      address: parsePublicKey(this.name, 'address', params.address),
      newAdmin: parsePublicKey(this.name, 'newAdmin', params.newAdmin),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned instruction after confirming the caller is the current admin. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedTransferAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const { tokenMint, payer, authority, newAdmin } = opts
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address.toBase58()))
    const tokenConfig = await chain.getRegistryTokenConfig(router.toBase58(), tokenMint.toBase58())

    if (!new PublicKey(tokenConfig.administrator).equals(authority)) {
      const pending = tokenConfig.pendingAdministrator
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        PublicKey.default.toBase58() === tokenConfig.administrator && pending
          ? `registration for this token is still pending acceptance by ${pending}; the pending administrator must accept the admin role first — this operation only transfers an accepted role`
          : `must be the current token administrator (${tokenConfig.administrator})`,
      )
    }

    const instruction = await createRouterProgram(chain, router, payer)
      .methods.transferAdminRoleTokenAdminRegistry(newAdmin)
      .accounts({
        config: deriveRouterConfigPda(router),
        tokenAdminRegistry: deriveTokenAdminRegistryPda(router, tokenMint),
        mint: tokenMint,
        authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${tokenMint.toBase58()}, newAdmin = ${newAdmin.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the current admin wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteTransferAdminParams,
  ): Promise<ExecuteTransferAdminResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'transferAdmin requires authority to be the executing wallet. Use generateUnsignedTransferAdmin for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
