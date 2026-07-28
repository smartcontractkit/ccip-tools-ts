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

/** Parameters shared by Solana TokenAdminRegistry `acceptAdminRole` generation and execution. */
type AcceptAdminRoleParams = {
  tokenAddress: string
  routerAddress: string
  /**
   * Token admin authority (the pending administrator). Defaults to `payer` for single-signer
   * transactions. Multisig/Squads flows should pass the pending admin/vault authority explicitly.
   */
  authority?: string
}

/** Parameters for unsigned Solana TokenAdminRegistry `acceptAdminRole` generation. */
export type GenerateAcceptAdminRoleParams = SolanaGenerateParams<AcceptAdminRoleParams>

/** Unsigned Solana TokenAdminRegistry `acceptAdminRole` result. */
export type GenerateAcceptAdminRoleResult = UnsignedSolanaTx

/** Parameters for executing Solana TokenAdminRegistry `acceptAdminRole`. */
export type ExecuteAcceptAdminRoleParams = SolanaExecuteParams<AcceptAdminRoleParams>

/** Result of executing Solana TokenAdminRegistry `acceptAdminRole`. */
export type ExecuteAcceptAdminRoleResult = TransactionHash

/** Solana TokenAdminRegistry `acceptAdminRole` operation. */
export class AcceptAdminRole extends SolanaOperation<AcceptAdminRoleParams> {
  readonly name = 'acceptAdminRole'

  /** Validates all public keys before any RPC. */
  protected validate(params: GenerateAcceptAdminRoleParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    validatePublicKey(this.name, 'routerAddress', params.routerAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
  }

  /** Builds the unsigned Solana `acceptAdminRoleTokenAdminRegistry` instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateAcceptAdminRoleParams,
  ): Promise<UnsignedSolanaTx> {
    const router = new PublicKey(opts.routerAddress)
    const mint = new PublicKey(opts.tokenAddress)
    const payer = new PublicKey(opts.payer)
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const routerProgram = createRouterProgram(chain, router, payer)
    const config = deriveRouterConfigPda(router)
    const tokenAdminRegistry = deriveTokenAdminRegistryPda(router, mint)

    const instruction = await routerProgram.methods
      .acceptAdminRoleTokenAdminRegistry()
      .accountsStrict({
        config,
        tokenAdminRegistry,
        mint,
        authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: router = ${router.toBase58()}, token = ${mint.toBase58()}, authority = ${authority.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }
}
