/**
 * deployTokenPool — deploys a token pool (`type` selects the contract) via raw init-code at
 * v2.0.0. The tx has no `to`; `execute` returns the deployed pool address. Mirrors
 * `token/operations/deploy-token.ts`.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import { CCTParamsInvalidError } from '../../../errors.ts'
import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress, validateUint8 } from '../../validate.ts'
import {
  type DeployableTokenPoolType,
  type TokenPoolFamily,
  getTokenPoolArtifact,
  getTokenPoolFamily,
  isDeployableTokenPoolType,
} from '../contracts.ts'

/** Deployable pool types + their creation bytecode/artifact live in `../contracts.ts`. */
export type { DeployableTokenPoolType }

/** Fields shared by every deployable token pool. */
interface DeployTokenPoolBaseParams {
  /** Address of the token the pool manages. */
  token: string
  /** The token's `decimals` (uint8). */
  localTokenDecimals: number
  /** RMN proxy address. */
  rmnProxy: string
  /** CCIP router address. */
  router: string
  /** Advanced pool hooks; defaults to the zero address. */
  advancedPoolHooks?: string
  /** Deployer address; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Params for a burn-* mint pool — the burn family shares one constructor shape. */
export interface DeployBurnMintTokenPoolParams extends DeployTokenPoolBaseParams {
  type: Exclude<DeployableTokenPoolType, 'LockReleaseTokenPool'>
}

/**
 * Params for a `LockReleaseTokenPool` — the burn constructor plus `lockbox`.
 *
 * @remarks `lockbox` must be a pre-deployed `ERC20LockBox` for the *same* `token` (the constructor
 * calls `lockbox.isTokenSupported(token)`). Sequence: deployToken → deployLockbox → deployTokenPool
 * (this) → authorizeLockboxCallers (`addedCallers: [pool]`) → setPool → configure lanes.
 */
export interface DeployLockReleaseTokenPoolParams extends DeployTokenPoolBaseParams {
  type: 'LockReleaseTokenPool'
  /** Lockbox address; required and must be non-zero — the v2.0.0 constructor reverts on the zero address. */
  lockbox: string
}

/**
 * Parameters for {@link DeployTokenPool}, discriminated on `type`: the burn-* variants share one
 * constructor; `LockReleaseTokenPool` additionally requires `lockbox` (a compile-time guarantee).
 */
export type DeployTokenPoolParams = DeployBurnMintTokenPoolParams | DeployLockReleaseTokenPoolParams

/** Encodes a v2.0.0 pool constructor into init-code args for a given ABI family. */
type TokenPoolConstructorEncoder = (iface: Interface, p: DeployTokenPoolParams) => string

/** Burn-* family constructor: `(token, localTokenDecimals, advancedPoolHooks, rmnProxy, router)`. */
const encodeBurnMintTokenPool: TokenPoolConstructorEncoder = (iface, p) =>
  iface.encodeDeploy([
    p.token,
    p.localTokenDecimals,
    p.advancedPoolHooks ?? ZeroAddress,
    p.rmnProxy,
    p.router,
  ])

/** LockRelease constructor: the burn-* args plus `lockbox` (only that variant carries it). */
const encodeLockReleaseTokenPool: TokenPoolConstructorEncoder = (iface, p) =>
  iface.encodeDeploy([
    p.token,
    p.localTokenDecimals,
    p.advancedPoolHooks ?? ZeroAddress,
    p.rmnProxy,
    p.router,
    p.type === 'LockReleaseTokenPool' ? p.lockbox : ZeroAddress,
  ])

/** Deploys a token pool; `execute` resolves to `{ hash, contractAddress }`. */
export class DeployTokenPool extends EVMDeployOperation<DeployTokenPoolParams> {
  readonly name = 'deployTokenPool'

  /** Constructor encoder per ABI {@link TokenPoolFamily}; `type` narrows to its family. */
  private readonly encoders: Record<TokenPoolFamily, TokenPoolConstructorEncoder> = {
    BurnMint: encodeBurnMintTokenPool,
    LockRelease: encodeLockReleaseTokenPool,
  }

  /** Validates the constructor params before building init-code. */
  protected validate(params: DeployTokenPoolParams): void {
    if (!isDeployableTokenPoolType(params.type))
      throw new CCTParamsInvalidError(
        this.name,
        'type',
        `unsupported pool type ${String(params.type)}`,
      )
    validateAddress(this.name, 'token', params.token)
    validateUint8(this.name, 'localTokenDecimals', params.localTokenDecimals)
    validateAddress(this.name, 'rmnProxy', params.rmnProxy)
    validateAddress(this.name, 'router', params.router)
    if (params.advancedPoolHooks !== undefined)
      validateAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    if (params.type === 'LockReleaseTokenPool')
      validateNonZeroAddress(this.name, 'lockbox', params.lockbox)
  }

  /** Deploy artifact for the selected pool `type` (v2.0.0): name + ctor interface + bytecode. */
  protected artifact(p: DeployTokenPoolParams): DeployArtifact {
    return getTokenPoolArtifact(p.type)
  }

  /** ABI-encodes the pool constructor args via the encoder for the type's ABI family. */
  protected encode(iface: Interface, p: DeployTokenPoolParams): string {
    return this.encoders[getTokenPoolFamily(p.type)](iface, p)
  }
}
