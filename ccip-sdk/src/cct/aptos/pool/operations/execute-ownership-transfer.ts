/**
 * Aptos TokenPool `executeOwnershipTransfer` operation.
 *
 * The Aptos-only 3rd step of ownership transfer: the **current owner** finalizes
 * the AptosFramework object transfer after the proposed owner has accepted, via
 * `poolAddress::moduleName::execute_ownership_transfer(newOwner)`.
 *
 * Aptos 3-step ownership transfer:
 * 1. `transfer_ownership(newOwner)` — current owner proposes.
 * 2. `accept_ownership()` — proposed owner signals acceptance.
 * 3. `execute_ownership_transfer(newOwner)` — current owner finalizes.
 *
 * @packageDocumentation
 */

import { AccountAddress } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import type { UnsignedAptosTx } from '../../../../aptos/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { discoverPoolModule, ensurePoolInitialized } from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'

/** Parameters shared by Aptos TokenPool `executeOwnershipTransfer` generation and execution. */
type ExecuteOwnershipTransferParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
  /** New owner address — must match the address that called acceptOwnership. */
  newOwner: string
}

/** Parameters for unsigned Aptos TokenPool `executeOwnershipTransfer` generation. */
export type GenerateExecuteOwnershipTransferParams =
  AptosGenerateParams<ExecuteOwnershipTransferParams>

/** Unsigned Aptos TokenPool `executeOwnershipTransfer` result. */
export type GenerateExecuteOwnershipTransferResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `executeOwnershipTransfer`. */
export type ExecuteExecuteOwnershipTransferParams =
  AptosExecuteParams<ExecuteOwnershipTransferParams>

/** Result of executing Aptos TokenPool `executeOwnershipTransfer`. */
export type ExecuteExecuteOwnershipTransferResult = TransactionHash

/** Aptos TokenPool `executeOwnershipTransfer` operation (Aptos-only 3rd step). */
export class ExecuteOwnershipTransfer extends AptosOperation<ExecuteOwnershipTransferParams> {
  readonly name = 'executeOwnershipTransfer'

  /** Validates the pool address and new owner before any RPC. */
  protected validate(params: GenerateExecuteOwnershipTransferParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (!params.newOwner || params.newOwner.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'newOwner', 'must be non-empty')
    }
  }

  /** Discovers the pool module and builds an `execute_ownership_transfer` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateExecuteOwnershipTransferParams,
  ): Promise<UnsignedAptosTx> {
    const moduleName = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, moduleName)

    const tx = await chain.provider.transaction.build.simple({
      sender: AccountAddress.from(params.sender),
      data: {
        function: `${params.poolAddress}::${moduleName}::execute_ownership_transfer`,
        functionArguments: [params.newOwner],
      },
    })

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, module = ${moduleName}, newOwner = ${params.newOwner}`,
    )
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
