/**
 * applyChainUpdates — (re)configures remote chains on a TokenPool: adds remote
 * chain configs (remote pool addresses, remote token, rate limits) and/or removes
 * remote chain selectors. Encoding is version-dispatched off the pool's
 * `typeAndVersion`:
 * - pre-v1.5: `applyChainUpdates(ChainUpdate[])` (single pool address, `allowed` flag)
 * - v1.5.1+/v2.0: `applyChainUpdates(uint64[] removes, ChainUpdate[] adds)`
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import {
  type RateLimiterConfig,
  encodeRemoteAddress,
  isLegacyPoolVersion,
  resolvePoolInterface,
} from '../apply-chain-updates-utils.ts'

export type { RateLimiterConfig } from '../apply-chain-updates-utils.ts'

/** Configuration for a single remote chain to add to a pool. Addresses are in native format. */
export type RemoteChainConfig = {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /** Remote pool address(es) in native format. At least one required. */
  remotePoolAddresses: string[]
  /** Remote token address in native format. */
  remoteTokenAddress: string
  /** Outbound rate limiter (local → remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote → local). */
  inboundRateLimiterConfig: RateLimiterConfig
}

/** Parameters for `applyChainUpdates`. */
export type ApplyChainUpdatesParams = {
  /** Local pool address. */
  poolAddress: string
  /** Remote chain selectors to remove (can be empty). */
  remoteChainSelectorsToRemove: bigint[]
  /** Remote chain configurations to add (can be empty). */
  chainsToAdd: RemoteChainConfig[]
  sender?: string
}

/** Adds and/or removes remote chain configs on a TokenPool, version-dispatched. */
export class ApplyChainUpdates extends EVMOperation<ApplyChainUpdatesParams> {
  readonly name = 'applyChainUpdates'

  /** Validates the pool address and each remote-chain config before any RPC. */
  protected validate(p: ApplyChainUpdatesParams): void {
    if (!p.poolAddress || p.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    for (const [i, chain] of p.chainsToAdd.entries()) {
      if (chain.remoteChainSelector == null || chain.remoteChainSelector === 0n) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remoteChainSelector`,
          'must be non-zero',
        )
      }
      if (chain.remotePoolAddresses.length === 0) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remotePoolAddresses`,
          'must have at least one address',
        )
      }
      if (!chain.remoteTokenAddress || chain.remoteTokenAddress.trim().length === 0) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remoteTokenAddress`,
          'must be non-empty',
        )
      }
    }
  }

  /** Detects the pool version and builds the matching `applyChainUpdates` calldata. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: ApplyChainUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)
    const iface = resolvePoolInterface(version)

    let data: string
    if (isLegacyPoolVersion(version)) {
      // pre-v1.5: applyChainUpdates(ChainUpdate[]) — single pool address, `allowed` field
      const chains = [
        ...p.chainsToAdd.map((c) => ({
          remoteChainSelector: c.remoteChainSelector,
          allowed: true,
          remotePoolAddress: encodeRemoteAddress(this.#firstPoolAddress(c.remotePoolAddresses)),
          remoteTokenAddress: encodeRemoteAddress(c.remoteTokenAddress),
          outboundRateLimiterConfig: {
            isEnabled: c.outboundRateLimiterConfig.isEnabled,
            capacity: BigInt(c.outboundRateLimiterConfig.capacity),
            rate: BigInt(c.outboundRateLimiterConfig.rate),
          },
          inboundRateLimiterConfig: {
            isEnabled: c.inboundRateLimiterConfig.isEnabled,
            capacity: BigInt(c.inboundRateLimiterConfig.capacity),
            rate: BigInt(c.inboundRateLimiterConfig.rate),
          },
        })),
        ...p.remoteChainSelectorsToRemove.map((s) => ({
          remoteChainSelector: BigInt(s),
          allowed: false,
          remotePoolAddress: '0x',
          remoteTokenAddress: '0x',
          outboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
          inboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
        })),
      ]
      data = iface.encodeFunctionData('applyChainUpdates', [chains])
    } else {
      // v1.5.1+ and v2.0: applyChainUpdates(uint64[] removes, ChainUpdate[] adds)
      const chainsToAdd = p.chainsToAdd.map((c) => ({
        remoteChainSelector: c.remoteChainSelector,
        remotePoolAddresses: c.remotePoolAddresses.map((addr) => encodeRemoteAddress(addr)),
        remoteTokenAddress: encodeRemoteAddress(c.remoteTokenAddress),
        outboundRateLimiterConfig: {
          isEnabled: c.outboundRateLimiterConfig.isEnabled,
          capacity: BigInt(c.outboundRateLimiterConfig.capacity),
          rate: BigInt(c.outboundRateLimiterConfig.rate),
        },
        inboundRateLimiterConfig: {
          isEnabled: c.inboundRateLimiterConfig.isEnabled,
          capacity: BigInt(c.inboundRateLimiterConfig.capacity),
          rate: BigInt(c.inboundRateLimiterConfig.rate),
        },
      }))
      const remoteChainSelectorsToRemove = p.remoteChainSelectorsToRemove.map((s) => BigInt(s))
      data = iface.encodeFunctionData('applyChainUpdates', [
        remoteChainSelectorsToRemove,
        chainsToAdd,
      ])
    }

    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }

  /** First remote pool address; validate() guarantees the array is non-empty. */
  #firstPoolAddress(addresses: string[]): string {
    const first = addresses[0]
    if (first == null) {
      throw new CCTParamsInvalidError(
        this.name,
        'chainsToAdd[].remotePoolAddresses',
        'must have at least one address',
      )
    }
    return first
  }
}
