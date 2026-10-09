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
  type BurnMintTokenPoolType,
  type DeployableTokenPoolType,
  type TokenPoolFamily,
  getTokenPoolArtifact,
  getTokenPoolFamily,
  isDeployableTokenPoolType,
} from '../contracts.ts'

/** Deployable pool types + their creation bytecode/artifact live in `../contracts.ts`. */
export type { DeployableTokenPoolType }

/** Fields shared by every deployable token pool: the `TokenPool` base constructor plus `sender`. */
type DeployTokenPoolBaseParams = {
  /** Non-zero address of the token the pool manages. */
  token: string
  /**
   * The token's `decimals` (uint8). Must equal the token's on-chain `decimals()`: the constructor
   * checks it and reverts `InvalidDecimalArgs` on a mismatch.
   */
  localTokenDecimals: number
  /** Non-zero RMN proxy address. */
  rmnProxy: string
  /** Non-zero CCIP router address. */
  router: string
  /**
   * `AdvancedPoolHooks` contract to bind at construction, as returned by
   * `deployAdvancedPoolHooks`. Defaults to the zero address, which leaves the pool enforcing no
   * sender allowlist and no CCV requirements — a v2.0.0 pool holds neither itself.
   * @remarks Re-pointable after deploy with `updateAdvancedPoolHooks`, unlike `lockbox`.
   */
  advancedPoolHooks?: string
  /** Deployer address; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Params for a burn-* mint pool: the `TokenPool` base constructor, unchanged. */
export type DeployBurnMintTokenPoolParams = DeployTokenPoolBaseParams & {
  type: Extract<DeployableTokenPoolType, BurnMintTokenPoolType>
}

/**
 * Params for a `LockReleaseTokenPool`: the `TokenPool` base constructor plus `lockbox`.
 *
 * @remarks `lockbox` must be a pre-deployed `ERC20LockBox` for the *same* `token` (the constructor
 * calls `lockbox.isTokenSupported(token)`). Sequence: deployToken → deployLockbox → deployTokenPool
 * (this) → updateLockboxAuthorizedCallers (`addedCallers: [pool]`, plus whoever funds it) → setPool →
 * configure lanes → depositToLockbox, which a v2.0.0 pool cannot release without.
 */
export type DeployLockReleaseTokenPoolParams = DeployTokenPoolBaseParams & {
  type: 'LockReleaseTokenPool'
  /**
   * Lockbox address; required and must be non-zero — the v2.0.0 constructor reverts on the zero
   * address.
   *
   * @remarks **Permanent.** Stored in `i_lockBox`, `immutable` with no setter: a pool bound to
   * the wrong lockbox must be redeployed and re-registered with `setPool`. Unlike its
   * constructor neighbour `advancedPoolHooks`, which is re-pointable.
   */
  lockbox: string
}

/**
 * Params for a `SiloedLockReleaseTokenPool`: the `TokenPool` base constructor, with no `lockbox`.
 *
 * @remarks Lock/release, but escrows per remote chain: lockboxes are bound after deploy, per lane,
 * by the pool owner's `configureSiloedLockboxes`, each an `ERC20LockBox` for the *same* `token`
 * (it calls `lockBox.isTokenSupported(token)`). Lanes may share a lockbox (shared liquidity) or
 * each get their own (siloed). Sequence: deployToken → deployTokenPool (this) → deployLockbox
 * (one per silo) → updateLockboxAuthorizedCallers on each (`addedCallers: [pool]`, plus whoever
 * funds it) → configureSiloedLockboxes → setPool → configure lanes → depositToLockbox per
 * lockbox. A lane with no lockbox reverts `LockBoxNotConfigured` on every transfer.
 */
export type DeploySiloedLockReleaseTokenPoolParams = DeployTokenPoolBaseParams & {
  type: 'SiloedLockReleaseTokenPool'
}

/**
 * Parameters for {@link DeployTokenPool}, discriminated on `type`: the burn-* variants and
 * `SiloedLockReleaseTokenPool` take the `TokenPool` base constructor; only `LockReleaseTokenPool`
 * takes (and requires) `lockbox`, a compile-time guarantee.
 */
export type DeployTokenPoolParams =
  | DeployBurnMintTokenPoolParams
  | DeployLockReleaseTokenPoolParams
  | DeploySiloedLockReleaseTokenPoolParams

/** Encodes a v2.0.0 pool constructor into init-code args for a given ABI family. */
type TokenPoolConstructorEncoder = (iface: Interface, p: DeployTokenPoolParams) => string

/**
 * The `TokenPool` base constructor, taken as is by the burn-* and siloed pools:
 * `(token, localTokenDecimals, advancedPoolHooks, rmnProxy, router)`.
 */
const encodeBaseTokenPool: TokenPoolConstructorEncoder = (iface, p) =>
  iface.encodeDeploy([
    p.token,
    p.localTokenDecimals,
    p.advancedPoolHooks ?? ZeroAddress,
    p.rmnProxy,
    p.router,
  ])

/** LockRelease constructor: the base args plus `lockbox` (only that variant carries it). */
const encodeLockReleaseTokenPool: TokenPoolConstructorEncoder = (iface, p) =>
  iface.encodeDeploy([
    p.token,
    p.localTokenDecimals,
    p.advancedPoolHooks ?? ZeroAddress,
    p.rmnProxy,
    p.router,
    p.type === 'LockReleaseTokenPool' ? p.lockbox : ZeroAddress,
  ])

/** Deploys a token pool; `execute` resolves to `{ hash, contractAddress, verification }`. */
export class DeployTokenPool extends EVMDeployOperation<DeployTokenPoolParams> {
  readonly name = 'deployTokenPool'

  /**
   * Constructor encoder per ABI {@link TokenPoolFamily}; `type` narrows to its family.
   * `SiloedLockRelease` takes the base constructor (no `lockbox`), as BurnMint does.
   */
  private readonly encoders: Record<TokenPoolFamily, TokenPoolConstructorEncoder> = {
    BurnMint: encodeBaseTokenPool,
    LockRelease: encodeLockReleaseTokenPool,
    SiloedLockRelease: encodeBaseTokenPool,
  }

  /** Validates the constructor params before building init-code. */
  protected override prepare(params: DeployTokenPoolParams): DeployTokenPoolParams {
    if (!isDeployableTokenPoolType(params.type))
      throw new CCTParamsInvalidError(
        this.name,
        'type',
        `unsupported pool type ${String(params.type)}`,
      )
    validateNonZeroAddress(this.name, 'token', params.token)
    validateUint8(this.name, 'localTokenDecimals', params.localTokenDecimals)
    validateNonZeroAddress(this.name, 'rmnProxy', params.rmnProxy)
    validateNonZeroAddress(this.name, 'router', params.router)
    if (params.advancedPoolHooks !== undefined)
      validateAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    if (params.type === 'LockReleaseTokenPool')
      validateNonZeroAddress(this.name, 'lockbox', params.lockbox)
    return params
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
