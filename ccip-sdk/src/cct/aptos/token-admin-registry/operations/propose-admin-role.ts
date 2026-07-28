/**
 * Aptos TokenAdminRegistry `proposeAdminRole` operation.
 *
 * On Aptos, the TokenAdminRegistry is a module within the CCIP router package
 * (`routerAddress::token_admin_registry::propose_administrator`).
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

/** Parameters shared by Aptos TokenAdminRegistry `proposeAdminRole` generation and execution. */
type ProposeAdminRoleParams = {
  /** Token address to propose an administrator for. */
  tokenAddress: string
  /** Address of the proposed administrator. */
  administrator: string
  /** CCIP router module address (bundles the TokenAdminRegistry on Aptos). */
  routerAddress: string
}

/** Parameters for unsigned Aptos TokenAdminRegistry `proposeAdminRole` generation. */
export type GenerateProposeAdminRoleParams = AptosGenerateParams<ProposeAdminRoleParams>

/** Unsigned Aptos TokenAdminRegistry `proposeAdminRole` result. */
export type GenerateProposeAdminRoleResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenAdminRegistry `proposeAdminRole`. */
export type ExecuteProposeAdminRoleParams = AptosExecuteParams<ProposeAdminRoleParams>

/** Result of executing Aptos TokenAdminRegistry `proposeAdminRole`. */
export type ExecuteProposeAdminRoleResult = TransactionHash

/** Aptos TokenAdminRegistry `proposeAdminRole` operation. */
export class ProposeAdminRole extends AptosOperation<ProposeAdminRoleParams> {
  readonly name = 'proposeAdminRole'

  /** Validates all params before building the transaction. */
  protected validate(params: GenerateProposeAdminRoleParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    if (!params.administrator || params.administrator.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'administrator', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'routerAddress', 'must be non-empty')
    }
  }

  /** Builds the unsigned Aptos `propose_administrator` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateProposeAdminRoleParams,
  ): Promise<UnsignedAptosTx> {
    const payload = generateTransactionPayloadWithABI({
      function: `${params.routerAddress}::token_admin_registry::propose_administrator`,
      functionArguments: [params.tokenAddress, params.administrator],
      abi: {
        typeParameters: [],
        parameters: [parseTypeTag('address'), parseTypeTag('address')],
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
