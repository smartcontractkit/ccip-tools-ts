/**
 * Aptos TokenAdminRegistry `transferAdminRole` operation.
 *
 * Called by the current administrator to hand off the admin role to a new
 * address; the new admin must accept it to complete the transfer. Pass `@0x0`
 * as `newAdmin` to cancel a pending transfer. Invokes
 * `routerAddress::token_admin_registry::transfer_admin_role`.
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

/** Parameters shared by Aptos TokenAdminRegistry `transferAdminRole` generation and execution. */
type TransferAdminRoleParams = {
  /** Token address to transfer the admin role for. */
  tokenAddress: string
  /** Address of the new administrator (`@0x0` cancels a pending transfer). */
  newAdmin: string
  /** CCIP router module address (bundles the TokenAdminRegistry on Aptos). */
  routerAddress: string
}

/** Parameters for unsigned Aptos TokenAdminRegistry `transferAdminRole` generation. */
export type GenerateTransferAdminRoleParams = AptosGenerateParams<TransferAdminRoleParams>

/** Unsigned Aptos TokenAdminRegistry `transferAdminRole` result. */
export type GenerateTransferAdminRoleResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenAdminRegistry `transferAdminRole`. */
export type ExecuteTransferAdminRoleParams = AptosExecuteParams<TransferAdminRoleParams>

/** Result of executing Aptos TokenAdminRegistry `transferAdminRole`. */
export type ExecuteTransferAdminRoleResult = TransactionHash

/** Aptos TokenAdminRegistry `transferAdminRole` operation. */
export class TransferAdminRole extends AptosOperation<TransferAdminRoleParams> {
  readonly name = 'transferAdminRole'

  /** Validates all params before building the transaction. */
  protected validate(params: GenerateTransferAdminRoleParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    if (!params.newAdmin || params.newAdmin.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'newAdmin', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'routerAddress', 'must be non-empty')
    }
  }

  /** Builds the unsigned Aptos `transfer_admin_role` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateTransferAdminRoleParams,
  ): Promise<UnsignedAptosTx> {
    const payload = generateTransactionPayloadWithABI({
      function: `${params.routerAddress}::token_admin_registry::transfer_admin_role`,
      functionArguments: [params.tokenAddress, params.newAdmin],
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
      `${this.name}: router = ${params.routerAddress}, token = ${params.tokenAddress}, newAdmin = ${params.newAdmin}`,
    )
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
