/**
 * Aptos TokenPool `deleteChainConfig` operation.
 *
 * Removes an entire remote chain configuration from a token pool by calling
 * `apply_chain_updates` with only the removal selector and empty add arrays.
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

/** Parameters shared by Aptos TokenPool `deleteChainConfig` generation and execution. */
type DeleteChainConfigParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
  /** Remote chain selector to remove (must be currently configured). */
  remoteChainSelector: bigint
}

/** Parameters for unsigned Aptos TokenPool `deleteChainConfig` generation. */
export type GenerateDeleteChainConfigParams = AptosGenerateParams<DeleteChainConfigParams>

/** Unsigned Aptos TokenPool `deleteChainConfig` result. */
export type GenerateDeleteChainConfigResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `deleteChainConfig`. */
export type ExecuteDeleteChainConfigParams = AptosExecuteParams<DeleteChainConfigParams>

/** Result of executing Aptos TokenPool `deleteChainConfig`. */
export type ExecuteDeleteChainConfigResult = TransactionHash

/** Aptos TokenPool `deleteChainConfig` operation. */
export class DeleteChainConfig extends AptosOperation<DeleteChainConfigParams> {
  readonly name = 'deleteChainConfig'

  /** Validates the pool address and selector before any RPC. */
  protected validate(params: GenerateDeleteChainConfigParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (params.remoteChainSelector === 0n) {
      throw new CCTParamsInvalidError(this.name, 'remoteChainSelector', 'must be non-zero')
    }
  }

  /** Discovers the pool module and builds an `apply_chain_updates` removal-only transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateDeleteChainConfigParams,
  ): Promise<UnsignedAptosTx> {
    const poolModule = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, poolModule)

    const applyTx = await chain.provider.transaction.build.simple({
      sender: AccountAddress.from(params.sender),
      data: {
        function: `${params.poolAddress}::${poolModule}::apply_chain_updates`,
        functionArguments: [
          [params.remoteChainSelector], // remoteChainSelectorsToRemove
          [], // remoteChainSelectorsToAdd
          [], // remotePoolAddressesToAdd
          [], // remoteTokenAddressesToAdd
        ],
      },
    })

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, module = ${poolModule}, remoteChainSelector = ${params.remoteChainSelector}`,
    )
    return { family: ChainFamily.Aptos, transactions: [applyTx.bcsToBytes()] }
  }
}
