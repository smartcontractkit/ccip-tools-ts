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

/** Parameters shared by Solana TokenAdminRegistry `acceptAdmin` generation and execution. */
type AcceptAdminParams = {
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp
   * address works.
   */
  address: string
  /** Pending token admin. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `acceptAdmin` generation. */
export type GenerateAcceptAdminParams = SolanaGenerateParams<AcceptAdminParams>

/** Unsigned Solana TokenAdminRegistry `acceptAdmin` result. */
export type GenerateAcceptAdminResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `acceptAdmin`. */
export type ExecuteAcceptAdminParams = SolanaExecuteParams<AcceptAdminParams>

/** Result of executing Solana TokenAdminRegistry `acceptAdmin`. */
export type ExecuteAcceptAdminResult = TransactionResult

/** Accepts a pending TokenAdminRegistry administrator role. */
export class AcceptAdmin extends SolanaOperation<AcceptAdminParams> {
  readonly name = 'acceptAdmin'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateAcceptAdminParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'address', params.address)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned instruction after confirming the caller is the pending admin. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateAcceptAdminParams,
  ): Promise<UnsignedSolanaTx> {
    const tokenMint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address))
    const tokenConfig = await chain.getRegistryTokenConfig(router.toBase58(), tokenMint.toBase58())

    if (!tokenConfig.pendingAdministrator) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        `no administrator is pending for this token (current administrator: ${tokenConfig.administrator}) — nothing to accept`,
      )
    }
    if (!new PublicKey(tokenConfig.pendingAdministrator).equals(authority)) {
      throw new CCTParamsInvalidError(
        this.name,
        'authority',
        'must be the pending token administrator',
      )
    }

    const instruction = await createRouterProgram(chain, router, payer)
      .methods.acceptAdminRoleTokenAdminRegistry()
      .accounts({
        config: deriveRouterConfigPda(router),
        tokenAdminRegistry: deriveTokenAdminRegistryPda(router, tokenMint),
        mint: tokenMint,
        authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${tokenMint.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the pending admin wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteAcceptAdminParams,
  ): Promise<ExecuteAcceptAdminResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const payer = wallet.publicKey.toBase58()
    const generateParams: GenerateAcceptAdminParams = { ...rest, payer }
    this.validate(generateParams)

    if (params.authority) {
      validateAuthorityMatchesWallet(
        this.name,
        new PublicKey(params.authority),
        wallet.publicKey,
        'acceptAdmin requires authority to be the executing wallet. Use generateUnsignedAcceptAdmin for externally signed transactions.',
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
