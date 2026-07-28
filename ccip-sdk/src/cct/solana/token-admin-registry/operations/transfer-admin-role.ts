import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import type { TransactionHash } from '../../../operation.ts'
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
import { validatePublicKey } from '../../validate.ts'

/** Parameters shared by Solana TokenAdminRegistry `transferAdminRole` generation and execution. */
type TransferAdminRoleParams = {
  tokenAddress: string
  newAdmin: string
  routerAddress: string
  /**
   * Token admin authority (the current administrator). Defaults to `payer` for single-signer
   * transactions. Multisig/Squads flows should pass the current admin/vault authority explicitly.
   */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `transferAdminRole` generation. */
export type GenerateTransferAdminRoleParams = SolanaGenerateParams<TransferAdminRoleParams>

/** Unsigned Solana TokenAdminRegistry `transferAdminRole` result. */
export type GenerateTransferAdminRoleResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `transferAdminRole`. */
export type ExecuteTransferAdminRoleParams = SolanaExecuteParams<TransferAdminRoleParams>

/** Result of executing Solana TokenAdminRegistry `transferAdminRole`. */
export type ExecuteTransferAdminRoleResult = TransactionHash

/** Solana TokenAdminRegistry `transferAdminRole` operation. */
export class TransferAdminRole extends SolanaOperation<TransferAdminRoleParams> {
  readonly name = 'transferAdminRole'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateTransferAdminRoleParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'newAdmin', params.newAdmin)
    validatePublicKey(this.name, 'routerAddress', params.routerAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned Solana `transferAdminRoleTokenAdminRegistry` instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateTransferAdminRoleParams,
  ): Promise<UnsignedSolanaTx> {
    const router = new PublicKey(opts.routerAddress)
    const mint = new PublicKey(opts.tokenAddress)
    const newAdmin = new PublicKey(opts.newAdmin)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const routerProgram = createRouterProgram(chain, router, payer)
    const config = deriveRouterConfigPda(router)
    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, mint)

    const instruction = await routerProgram.methods
      .transferAdminRoleTokenAdminRegistry(newAdmin)
      .accountsStrict({
        config,
        tokenAdminRegistry,
        mint,
        authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${mint.toBase58()}, newAdmin = ${newAdmin.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
