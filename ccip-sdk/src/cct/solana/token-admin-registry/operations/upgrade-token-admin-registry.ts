import { PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  createRouterTokenAdminRegistryV2Program,
  deriveRouterConfigPda,
  deriveTokenAdminRegistryPda,
} from '../../programs/router.ts'
import { submit } from '../../submit.ts'
import { parsePublicKey, validateAuthorityMatchesWallet } from '../../validate.ts'

/** Parameters shared by Solana TokenAdminRegistry `upgradeTokenAdminRegistry`. */
type UpgradeTokenAdminRegistryParams = {
  tokenAddress: string
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp address
   * works.
   */
  address: string
  /**
   * Signer paying for the registry account's growth; anyone may upgrade a registry. Defaults to
   * `payer`.
   */
  authority?: string
}

type ParsedUpgradeTokenAdminRegistryParams = {
  tokenAddress: PublicKey
  address: PublicKey
  payer: PublicKey
  authority: PublicKey
}

/** Parameters for unsigned Solana TokenAdminRegistry `upgradeTokenAdminRegistry`. */
export type GenerateUpgradeTokenAdminRegistryParams =
  SolanaGenerateParams<UpgradeTokenAdminRegistryParams>

/** Unsigned Solana TokenAdminRegistry `upgradeTokenAdminRegistry` result. */
export type GenerateUpgradeTokenAdminRegistryResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `upgradeTokenAdminRegistry`. */
export type ExecuteUpgradeTokenAdminRegistryParams =
  SolanaExecuteParams<UpgradeTokenAdminRegistryParams>

/** Result of executing Solana TokenAdminRegistry `upgradeTokenAdminRegistry`. */
export type ExecuteUpgradeTokenAdminRegistryResult = TransactionResult

/**
 * Migrates a token's TokenAdminRegistry account from an older layout to the CCIP 2.0 Router's
 * latest, keeping its administrator, pool, and account resolution. `setPoolInterfaceImplementation`
 * requires the latest layout.
 *
 * @remarks Permissionless: `authority` only pays for the account's growth. The Router rejects a
 * registry that is already at the latest layout.
 */
export class UpgradeTokenAdminRegistry extends SolanaOperation<
  UpgradeTokenAdminRegistryParams,
  UnsignedSolanaTx,
  ParsedUpgradeTokenAdminRegistryParams
> {
  readonly name = 'upgradeTokenAdminRegistry'

  /** Parses public keys and defaults authority to payer without mutating caller params. */
  protected override prepare(
    params: GenerateUpgradeTokenAdminRegistryParams,
  ): ParsedUpgradeTokenAdminRegistryParams {
    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      address: parsePublicKey(this.name, 'address', params.address),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
    }
  }

  /** Builds the unsigned Solana `upgrade_token_admin_registry` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedUpgradeTokenAdminRegistryParams,
  ): Promise<UnsignedSolanaTx> {
    const { tokenAddress: mint, payer, authority } = opts
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(opts.address.toBase58()))

    // The instruction kept the discriminator of its earlier name, which the IDL is generated under
    const instruction = await createRouterTokenAdminRegistryV2Program(chain, router, payer)
      .methods.upgradeTokenAdminRegistryFromV1()
      .accountsStrict({
        config: deriveRouterConfigPda(router),
        tokenAdminRegistry: deriveTokenAdminRegistryPda(router, mint),
        mint,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(`${this.name}: router = ${router.toBase58()}, token = ${mint.toBase58()}`)
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the wallet paying for the upgrade. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteUpgradeTokenAdminRegistryParams,
  ): Promise<ExecuteUpgradeTokenAdminRegistryResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(chain, params)
    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'upgradeTokenAdminRegistry requires authority to be the executing wallet. Use generateUnsignedUpgradeTokenAdminRegistry for externally signed transactions.',
      )
    }
    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
