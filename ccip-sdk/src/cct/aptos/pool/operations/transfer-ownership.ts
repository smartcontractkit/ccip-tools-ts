/**
 * Aptos TokenPool `transferOwnership` operation.
 *
 * Proposes a new pool owner (step 1 of the Aptos 3-step ownership transfer) via
 * `poolAddress::moduleName::transfer_ownership(newOwner)`. Auto-discovers the
 * pool module from the pool address.
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

/** Parameters shared by Aptos TokenPool `transferOwnership` generation and execution. */
type TransferOwnershipParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
  /** New owner address to propose. */
  newOwner: string
}

/** Parameters for unsigned Aptos TokenPool `transferOwnership` generation. */
export type GenerateTransferOwnershipParams = AptosGenerateParams<TransferOwnershipParams>

/** Unsigned Aptos TokenPool `transferOwnership` result. */
export type GenerateTransferOwnershipResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `transferOwnership`. */
export type ExecuteTransferOwnershipParams = AptosExecuteParams<TransferOwnershipParams>

/** Result of executing Aptos TokenPool `transferOwnership`. */
export type ExecuteTransferOwnershipResult = TransactionHash

/** Aptos TokenPool `transferOwnership` operation. */
export class TransferOwnership extends AptosOperation<TransferOwnershipParams> {
  readonly name = 'transferOwnership'

  /** Validates the pool address and proposed owner before any RPC. */
  protected validate(params: GenerateTransferOwnershipParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (!params.newOwner || params.newOwner.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'newOwner', 'must be non-empty')
    }
  }

  /** Discovers the pool module and builds a `transfer_ownership` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateTransferOwnershipParams,
  ): Promise<UnsignedAptosTx> {
    const moduleName = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, moduleName)

    const tx = await chain.provider.transaction.build.simple({
      sender: AccountAddress.from(params.sender),
      data: {
        function: `${params.poolAddress}::${moduleName}::transfer_ownership`,
        functionArguments: [params.newOwner],
      },
    })

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, module = ${moduleName}, newOwner = ${params.newOwner}`,
    )
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
