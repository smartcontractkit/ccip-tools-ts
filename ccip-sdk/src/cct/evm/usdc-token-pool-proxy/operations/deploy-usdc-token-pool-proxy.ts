/**
 * deployUSDCTokenPoolProxy: deploys a `USDCTokenPoolProxy` (v2.0.0) via raw init-code. The tx has
 * no `to`; `execute` returns the deployed contract address. Mirrors
 * `lockbox/operations/deploy-lockbox.ts`.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import { parseRecord, validateAddress, validateNonZeroAddress } from '../../validate.ts'
import { type USDCTokenPoolProxyPools, getUSDCTokenPoolProxyArtifact } from '../contracts.ts'

/** Parameters for {@link DeployUSDCTokenPoolProxy}: deploys `USDCTokenPoolProxy` (v2.0.0). */
export type DeployUSDCTokenPoolProxyParams = {
  /** USDC token; the constructor reverts `AddressCannotBeZero` on zero. */
  token: string
  /** Child pool per mechanism, all four required; `ZeroAddress` for a mechanism this chain does not use. */
  pools: USDCTokenPoolProxyPools
  /** CCIP router; every `lockOrBurn` / `releaseOrMint` checks the caller is a ramp on it. Non-zero. */
  router: string
  /** CCTP verifier resolver (`ICrossChainVerifierResolver`). Non-zero. */
  cctpVerifier: string
  /** Deployer; sets `tx.from` for offline / multisig signing, and becomes the owner. */
  sender?: string
}

/** Pool slots in `PoolAddresses` struct order, the order {@link DeployUSDCTokenPoolProxy} encodes. */
const POOL_SLOTS = [
  'cctpV1Pool',
  'cctpV2Pool',
  'cctpV2PoolWithCCV',
  'siloedLockReleasePool',
] as const satisfies readonly (keyof USDCTokenPoolProxyPools)[]

/** Deploys a `USDCTokenPoolProxy`; `execute` resolves to `{ hash, contractAddress, verification }`. */
export class DeployUSDCTokenPoolProxy extends EVMDeployOperation<DeployUSDCTokenPoolProxyParams> {
  readonly name = 'deployUSDCTokenPoolProxy'

  /** Validates the constructor params before building init-code. */
  protected override prepare(
    params: DeployUSDCTokenPoolProxyParams,
  ): DeployUSDCTokenPoolProxyParams {
    validateNonZeroAddress(this.name, 'token', params.token)
    validateNonZeroAddress(this.name, 'router', params.router)
    validateNonZeroAddress(this.name, 'cctpVerifier', params.cctpVerifier)
    const pools = parseRecord(this.name, 'pools', params.pools, 'pool address set')
    // zero is allowed: the proxy may sit on a chain that lacks a CCTP version
    for (const slot of POOL_SLOTS) validateAddress(this.name, `pools.${slot}`, pools[slot])
    return params
  }

  /** Deploy artifact for `USDCTokenPoolProxy` (v2.0.0). */
  protected artifact(): DeployArtifact {
    return getUSDCTokenPoolProxyArtifact()
  }

  /** ABI-encodes the `USDCTokenPoolProxy` (v2.0.0) constructor args. */
  protected encode(iface: Interface, p: DeployUSDCTokenPoolProxyParams): string {
    return iface.encodeDeploy([
      p.token,
      POOL_SLOTS.map((slot) => p.pools[slot]),
      p.router,
      p.cctpVerifier,
    ])
  }
}
