/**
 * Aptos TokenPool `acceptOwnership` operation.
 *
 * Signals acceptance of a proposed pool ownership transfer (step 2 of the Aptos
 * 3-step ownership transfer) via `poolAddress::moduleName::accept_ownership()`.
 * Auto-discovers the pool module from the pool address.
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

/** Parameters shared by Aptos TokenPool `acceptOwnership` generation and execution. */
type AcceptOwnershipParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
}

/** Parameters for unsigned Aptos TokenPool `acceptOwnership` generation. */
export type GenerateAcceptOwnershipParams = AptosGenerateParams<AcceptOwnershipParams>

/** Unsigned Aptos TokenPool `acceptOwnership` result. */
export type GenerateAcceptOwnershipResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `acceptOwnership`. */
export type ExecuteAcceptOwnershipParams = AptosExecuteParams<AcceptOwnershipParams>

/** Result of executing Aptos TokenPool `acceptOwnership`. */
export type ExecuteAcceptOwnershipResult = TransactionHash

/** Aptos TokenPool `acceptOwnership` operation. */
export class AcceptOwnership extends AptosOperation<AcceptOwnershipParams> {
  readonly name = 'acceptOwnership'

  /** Validates the pool address before any RPC. */
  protected validate(params: GenerateAcceptOwnershipParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
  }

  /** Discovers the pool module and builds an `accept_ownership` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateAcceptOwnershipParams,
  ): Promise<UnsignedAptosTx> {
    const moduleName = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, moduleName)

    const tx = await chain.provider.transaction.build.simple({
      sender: AccountAddress.from(params.sender),
      data: {
        function: `${params.poolAddress}::${moduleName}::accept_ownership`,
        functionArguments: [],
      },
    })

    chain.logger.debug(`${this.name}: pool = ${params.poolAddress}, module = ${moduleName}`)
    return { family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] }
  }
}
