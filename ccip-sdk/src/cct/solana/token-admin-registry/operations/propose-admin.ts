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

/** Parameters shared by Solana TokenAdminRegistry `proposeAdmin` generation and execution. */
type ProposeAdminParams = {
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — the registry itself,
   * a Router, OnRamp, OffRamp, or TokenPool address all work.
   */
  address: string
  /** The administrator proposed to accept the token's registry admin role. */
  newAdmin: string
  /** Current token admin. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `proposeAdmin` generation. */
export type GenerateProposeAdminParams = SolanaGenerateParams<ProposeAdminParams>

/** Unsigned Solana TokenAdminRegistry `proposeAdmin` result. */
export type GenerateProposeAdminResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `proposeAdmin`. */
export type ExecuteProposeAdminParams = SolanaExecuteParams<ProposeAdminParams>

/** Result of executing Solana TokenAdminRegistry `proposeAdmin`. */
export type ExecuteProposeAdminResult = TransactionResult

/** Proposes a new TokenAdminRegistry administrator. The proposed admin must accept separately. */
export class ProposeAdmin extends SolanaOperation<ProposeAdminParams> {
  readonly name = 'proposeAdmin'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateProposeAdminParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'newAdmin', params.newAdmin)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned instruction after confirming the caller is the current admin. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateProposeAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const newAdmin = new PublicKey(opts.newAdmin)
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address))
    const tokenConfig = await chain.getRegistryTokenConfig(router.toBase58(), tokenMint.toBase58())

    if (!new PublicKey(tokenConfig.administrator).equals(authority)) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'must be the current token administrator',
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
    params: ExecuteProposeAdminParams,
  ): Promise<ExecuteProposeAdminResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateProposeAdminParams = { ...rest, payer }
    this.validate(generateParams)

    if (params.authority) {
      validateAuthorityMatchesWallet(
        this.name,
        new PublicKey(params.authority),
        wallet.publicKey,
        'proposeAdmin requires authority to be the executing wallet. Use generateUnsignedProposeAdmin for externally signed transactions.',
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
