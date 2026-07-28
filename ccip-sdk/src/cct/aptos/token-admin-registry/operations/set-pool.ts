/**
 * Aptos TokenAdminRegistry `setPool` operation.
 *
 * Registers a token pool in the TokenAdminRegistry. Invokes
 * `routerAddress::token_admin_registry::set_pool`.
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

/** Parameters shared by Aptos TokenAdminRegistry `setPool` generation and execution. */
type SetPoolParams = {
  /** Token address (Aptos hex) to register a pool for. */
  tokenAddress: string
  /** Pool resource address (Aptos hex) to link to the token. */
  poolAddress: string
  /** CCIP router module address (bundles the TokenAdminRegistry on Aptos). */
  routerAddress: string
}

/** Parameters for unsigned Aptos TokenAdminRegistry `setPool` generation. */
export type GenerateSetPoolParams = AptosGenerateParams<SetPoolParams>

/** Unsigned Aptos TokenAdminRegistry `setPool` result. */
export type GenerateSetPoolResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenAdminRegistry `setPool`. */
export type ExecuteSetPoolParams = AptosExecuteParams<SetPoolParams>

/** Result of executing Aptos TokenAdminRegistry `setPool`. */
export type ExecuteSetPoolResult = TransactionHash

/** Aptos TokenAdminRegistry `setPool` operation. */
export class SetPool extends AptosOperation<SetPoolParams> {
  readonly name = 'setPool'

  /** Validates all params before building the transaction. */
  protected validate(params: GenerateSetPoolParams): void {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    }
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'routerAddress', 'must be non-empty')
    }
  }

  /** Builds the unsigned Aptos `set_pool` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateSetPoolParams,
  ): Promise<UnsignedAptosTx> {
    const payload = generateTransactionPayloadWithABI({
      function: `${params.routerAddress}::token_admin_registry::set_pool`,
      functionArguments: [params.tokenAddress, params.poolAddress],
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
      `${this.name}: router = ${params.routerAddress}, token = ${params.tokenAddress}, pool = ${params.poolAddress}`,
    )
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
