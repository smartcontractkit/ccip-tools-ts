/**
 * Aptos TokenAdminRegistry `acceptAdminRole` operation.
 *
 * Called by the pending administrator to complete a two-step admin handoff.
 * Invokes `routerAddress::token_admin_registry::accept_admin_role`.
 *
 * @packageDocumentation
 */

import {
  buildTransaction,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import type { UnsignedAptosTx } from '../../../../aptos/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'

/** Parameters shared by Aptos TokenAdminRegistry `acceptAdminRole` generation and execution. */
type AcceptAdminRoleParams = {
  /** Token address to accept the admin role for. */
  tokenAddress: string
  /** CCIP router module address (bundles the TokenAdminRegistry on Aptos). */
  routerAddress: string
}

/** Parameters for unsigned Aptos TokenAdminRegistry `acceptAdminRole` generation. */
export type GenerateAcceptAdminRoleParams = AptosGenerateParams<AcceptAdminRoleParams>

/** Unsigned Aptos TokenAdminRegistry `acceptAdminRole` result. */
export type GenerateAcceptAdminRoleResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenAdminRegistry `acceptAdminRole`. */
export type ExecuteAcceptAdminRoleParams = AptosExecuteParams<AcceptAdminRoleParams>

/** Result of executing Aptos TokenAdminRegistry `acceptAdminRole`. */
export type ExecuteAcceptAdminRoleResult = TransactionHash

/** Aptos TokenAdminRegistry `acceptAdminRole` operation. */
export class AcceptAdminRole extends AptosOperation<AcceptAdminRoleParams> {
  readonly name = 'acceptAdminRole'

  /** Validates all params before building the transaction. */
  protected validate(params: GenerateAcceptAdminRoleParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'routerAddress', 'must be non-empty')
    }
  }

  /** Builds the unsigned Aptos `accept_admin_role` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateAcceptAdminRoleParams,
  ): Promise<UnsignedAptosTx> {
    const payload = generateTransactionPayloadWithABI({
      function: `${params.routerAddress}::token_admin_registry::accept_admin_role`,
      functionArguments: [params.tokenAddress],
      abi: {
        typeParameters: [],
        parameters: [parseTypeTag('address')],
      },
    })
    const tx = await buildTransaction({
      aptosConfig: chain.provider.config,
      sender: params.sender,
      payload,
    })

    chain.logger.debug(
      `${this.name}: router = ${params.routerAddress}, token = ${params.tokenAddress}`,
    )
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
