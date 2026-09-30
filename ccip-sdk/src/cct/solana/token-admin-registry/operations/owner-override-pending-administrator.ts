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

/** Parameters shared by owner override pending administrator generation and execution. */
type OwnerOverridePendingAdministratorParams = {
  /** Token mint whose pending registry administrator is being replaced. */
  tokenAddress: string
  /** CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp works. */
  address: string
  /** Administrator to propose as the replacement pending administrator. */
  newAdmin: string
  /** Mint authority. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

/** Parameters for unsigned Solana owner override pending administrator generation. */
export type GenerateOwnerOverridePendingAdministratorParams =
  SolanaGenerateParams<OwnerOverridePendingAdministratorParams>

/** Unsigned Solana owner override pending administrator result. */
export type GenerateOwnerOverridePendingAdministratorResult = UnsignedSolanaTx

/** Parameters for executing Solana owner override pending administrator. */
export type ExecuteOwnerOverridePendingAdministratorParams =
  SolanaExecuteParams<OwnerOverridePendingAdministratorParams>

/** Result of executing Solana owner override pending administrator. */
export type ExecuteOwnerOverridePendingAdministratorResult = TransactionResult

type ParsedOwnerOverridePendingAdministratorParams = {
  tokenMint: PublicKey
  address: PublicKey
  newAdmin: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Replaces an initial pending TokenAdminRegistry administrator using the mint authority. */
export class OwnerOverridePendingAdministrator extends SolanaOperation<
  OwnerOverridePendingAdministratorParams,
  UnsignedSolanaTx,
  ParsedOwnerOverridePendingAdministratorParams
> {
  readonly name = 'ownerOverridePendingAdministrator'

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override parse(
    params: GenerateOwnerOverridePendingAdministratorParams,
  ): ParsedOwnerOverridePendingAdministratorParams {
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

  /** Builds the override instruction. The Router verifies the mint authority and initial state on-chain. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedOwnerOverridePendingAdministratorParams,
  ): Promise<UnsignedSolanaTx> {
    const { tokenMint, payer, authority, newAdmin } = opts
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address.toBase58()))
    const tokenConfig = await chain.getRegistryTokenConfig(router.toBase58(), tokenMint.toBase58())
    if (!new PublicKey(tokenConfig.administrator).equals(PublicKey.default)) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        `cannot override the pending administrator because ${tokenConfig.administrator} has already accepted the role; only initial registrations can be overridden. The current administrator must use transferAdmin instead.`,
      )
    }

    const instruction = await createRouterProgram(chain, router, payer)
      .methods.ownerOverridePendingAdministrator(newAdmin)
      .accounts({
        config: deriveRouterConfigPda(router),
        tokenAdminRegistry: deriveTokenAdminRegistryPda(router, tokenMint),
        mint: tokenMint,
        authority,
      })
      .instruction()

    chain.logger.debug(
      `${
        this.name
      }: router = ${router.toBase58()}, token = ${tokenMint.toBase58()}, newAdmin = ${newAdmin.toBase58()}`,
    )
    return {
      family: ChainFamily.Solana,
      instructions: [instruction],
      mainIndex: 0,
    }
  }

  /** Generate, sign, simulate, send, and confirm with the mint authority wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteOwnerOverridePendingAdministratorParams,
  ): Promise<ExecuteOwnerOverridePendingAdministratorResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'ownerOverridePendingAdministrator requires authority to be the executing wallet. Use generateUnsignedOwnerOverridePendingAdministrator for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
