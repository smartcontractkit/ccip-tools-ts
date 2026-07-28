/**
 * deployLockbox — deploys an `ERC20LockBox` (v2.0.0) via raw init-code. The tx has no
 * `to`; `execute` returns the deployed contract address. A lockbox escrows a single token
 * for `LockReleaseTokenPool`s; deploy it before the pool, then authorize the pool on it via
 * {@link AuthorizeLockboxCallers}. Mirrors `token-pool/operations/deploy-token-pool.ts`.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { getLockboxArtifact } from '../contracts.ts'

/** Parameters for {@link DeployLockbox} — deploys `ERC20LockBox` (v2.0.0). */
export interface DeployLockboxParams {
  /** Address of the token the lockbox escrows; the v2.0.0 constructor reverts on the zero address. */
  token: string
  /** Deployer address; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Deploys an `ERC20LockBox`; `execute` resolves to `{ hash, contractAddress }`. */
export class DeployLockbox extends EVMDeployOperation<DeployLockboxParams> {
  readonly name = 'deployLockbox'

  /** Validates the constructor params before building init-code. */
  protected validate(params: DeployLockboxParams): void {
    validateNonZeroAddress(this.name, 'token', params.token)
  }

  /** Deploy artifact for `ERC20LockBox` (v2.0.0). */
  protected artifact(): DeployArtifact {
    return getLockboxArtifact()
  }

  /** ABI-encodes the `ERC20LockBox` (v2.0.0) constructor args. */
  protected encode(iface: Interface, p: DeployLockboxParams): string {
    return iface.encodeDeploy([p.token])
  }
}
