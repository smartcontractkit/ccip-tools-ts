/**
 * deleteChainConfig — removes an entire remote chain configuration from a
 * TokenPool. A removal-only wrapper over `applyChainUpdates`, version-dispatched:
 * - pre-v1.5: `applyChainUpdates([{ remoteChainSelector, allowed: false, ... }])`
 * - v1.5.1+/v2.0: `applyChainUpdates([remoteChainSelector], [])`
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { isLegacyPoolVersion, resolvePoolInterface } from '../apply-chain-updates-utils.ts'

/** Parameters for `deleteChainConfig`. */
export type DeleteChainConfigParams = {
  /** Local pool address. */
  poolAddress: string
  /** Remote chain selector to remove. Must be currently configured. */
  remoteChainSelector: bigint
  sender?: string
}

/** Removes a remote chain config from a TokenPool, version-dispatched. */
export class DeleteChainConfig extends EVMOperation<DeleteChainConfigParams> {
  readonly name = 'deleteChainConfig'

  /** Validates the pool address and remote chain selector before any RPC. */
  protected validate(p: DeleteChainConfigParams): void {
    if (!p.poolAddress || p.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (p.remoteChainSelector == null || p.remoteChainSelector === 0n) {
      throw new CCTParamsInvalidError(this.name, 'remoteChainSelector', 'must be non-zero')
    }
  }

  /** Detects the pool version and builds the removal-only `applyChainUpdates` calldata. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: DeleteChainConfigParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)
    const iface = resolvePoolInterface(version)

    let data: string
    if (isLegacyPoolVersion(version)) {
      // pre-v1.5: applyChainUpdates(ChainUpdate[]) — mark chain as not allowed
      const chains = [
        {
          remoteChainSelector: p.remoteChainSelector,
          allowed: false,
          remotePoolAddress: '0x',
          remoteTokenAddress: '0x',
          outboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
          inboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
        },
      ]
      data = iface.encodeFunctionData('applyChainUpdates', [chains])
    } else {
      // v1.5.1+ and v2.0: applyChainUpdates(uint64[] removes, ChainUpdate[] adds)
      data = iface.encodeFunctionData('applyChainUpdates', [[p.remoteChainSelector], []])
    }

    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
