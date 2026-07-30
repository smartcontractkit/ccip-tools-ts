import { PublicKey } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../../solana/types.ts'
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
import { validateAuthorityMatchesWallet, validatePublicKey } from '../../validate.ts'

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

/** Unsigned Solana TokenAdminRegistry `transferAdmin` result. */
export type GenerateTransferAdminResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `transferAdmin`. */
export type ExecuteTransferAdminParams = SolanaExecuteParams<TransferAdminParams>

/** Result of executing Solana TokenAdminRegistry `transferAdmin`. */
export type ExecuteTransferAdminResult = TransactionResult

/** Transfers a TokenAdminRegistry administrator role. The proposed admin must accept separately. */
export class TransferAdmin extends SolanaOperation<TransferAdminParams> {
  readonly name = 'transferAdmin'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateTransferAdminParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'newAdmin', params.newAdmin)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned instruction after confirming the caller is the current admin. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateTransferAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const newAdmin = new PublicKey(opts.newAdmin)
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address))
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
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateTransferAdminParams = { ...rest, payer }
    this.validate(generateParams)

    if (params.authority) {
      validateAuthorityMatchesWallet(
        this.name,
        new PublicKey(params.authority),
        wallet.publicKey,
        'transferAdmin requires authority to be the executing wallet. Use generateUnsignedTransferAdmin for externally signed transactions.',
      )
    }

    return submit(
      chain,
      wallet,
      await this.buildUnsigned(chain, generateParams),
      this.name,
      computeUnits,
    )
  }
}
