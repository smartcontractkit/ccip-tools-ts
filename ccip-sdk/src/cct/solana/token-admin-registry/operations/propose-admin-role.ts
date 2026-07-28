import { PublicKey, SystemProgram } from '@solana/web3.js'

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

/** Parameters shared by Solana TokenAdminRegistry `proposeAdminRole` generation and execution. */
type ProposeAdminRoleParams = {
  tokenAddress: string
  administrator: string
  routerAddress: string
  /**
   * Token admin authority (the current mint authority). Defaults to `payer` for single-signer
   * transactions. Multisig/Squads flows should pass the mint/vault authority explicitly.
   */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `proposeAdminRole` generation. */
export type GenerateProposeAdminRoleParams = SolanaGenerateParams<ProposeAdminRoleParams>

/** Unsigned Solana TokenAdminRegistry `proposeAdminRole` result. */
export type GenerateProposeAdminRoleResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `proposeAdminRole`. */
export type ExecuteProposeAdminRoleParams = SolanaExecuteParams<ProposeAdminRoleParams>

/** Result of executing Solana TokenAdminRegistry `proposeAdminRole`. */
export type ExecuteProposeAdminRoleResult = TransactionHash

/** Solana TokenAdminRegistry `proposeAdminRole` operation. */
export class ProposeAdminRole extends SolanaOperation<ProposeAdminRoleParams> {
  readonly name = 'proposeAdminRole'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateProposeAdminRoleParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'administrator', params.administrator)
    validatePublicKey(this.name, 'routerAddress', params.routerAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned Solana `ownerProposeAdministrator` instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateProposeAdminRoleParams,
  ): Promise<UnsignedSolanaTx> {
    const router = new PublicKey(opts.routerAddress)
    const mint = new PublicKey(opts.tokenAddress)
    const administrator = new PublicKey(opts.administrator)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const routerProgram = createRouterProgram(chain, router, payer)
    const config = deriveRouterConfigPda(router)
    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, mint)

    const instruction = await routerProgram.methods
      .ownerProposeAdministrator(administrator)
      .accountsStrict({
        config,
        tokenAdminRegistry,
        mint,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${mint.toBase58()}, administrator = ${administrator.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
