/**
 * deployPool — deploys a `BurnMintTokenPool` or `LockReleaseTokenPool` via raw init-code,
 * selected by `type` + `version` (default `2.0.0`). The tx has no `to`; `execute` returns
 * the deployed pool address. Mirrors `token/operations/deploy-token.ts`.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { DeployResult } from '../../../operation.ts'
import { EVMOperation, deploymentTx } from '../../operation.ts'
import { submit } from '../../submit.ts'
import { validateAddress, validateUint8 } from '../../validate.ts'
import {
  type DeployablePoolType,
  type DeployablePoolVersion,
  DEFAULT_POOL_VERSION,
  DEPLOYABLE_POOL_VERSIONS,
  TokenPoolVersion,
  poolArtifact,
} from '../version.ts'

/** Parameters for {@link DeployPool}. Version-specific fields are ignored when not part of
 * the selected `type`+`version` constructor. */
export interface DeployPoolParams {
  /** Pool contract to deploy. */
  type: DeployablePoolType
  /** Pool version; defaults to `2.0.0`. */
  version?: DeployablePoolVersion
  /** Address of the token the pool manages. */
  token: string
  /** The token's `decimals` (uint8). */
  localTokenDecimals: number
  /** RMN proxy address. */
  rmnProxy: string
  /** CCIP router address. */
  router: string
  /** Initial allowlist (versions `< 2.0.0`); defaults to `[]`. */
  allowlist?: string[]
  /** LockRelease `1.5.1` only — whether the pool accepts liquidity; defaults to `false`. */
  acceptLiquidity?: boolean
  /** Advanced pool hooks (version `2.0.0`); defaults to the zero address. */
  advancedPoolHooks?: string
  /** LockRelease `2.0.0` only — lock-box address; defaults to the zero address. */
  lockBox?: string
  sender?: string
}

/**
 * Encodes the pool constructor for `type` + `version`. Arg shape varies by version (and, at
 * `1.5.1`, by family for LockRelease's `acceptLiquidity`); `2.0.0` swaps `allowlist` for
 * `advancedPoolHooks` and adds LockRelease's `lockBox`.
 */
function encodePoolConstructor(
  iface: Interface,
  type: DeployablePoolType,
  version: DeployablePoolVersion,
  p: DeployPoolParams,
): string {
  const allowlist = p.allowlist ?? []
  switch (version) {
    case TokenPoolVersion.V1_5_1:
      return type === 'LockReleaseTokenPool'
        ? iface.encodeDeploy([
            p.token,
            p.localTokenDecimals,
            allowlist,
            p.rmnProxy,
            p.acceptLiquidity ?? false,
            p.router,
          ])
        : iface.encodeDeploy([p.token, p.localTokenDecimals, allowlist, p.rmnProxy, p.router])
    case TokenPoolVersion.V1_6_1:
      // Both families share the same shape (no acceptLiquidity).
      return iface.encodeDeploy([p.token, p.localTokenDecimals, allowlist, p.rmnProxy, p.router])
    case TokenPoolVersion.V2_0_0: {
      const hooks = p.advancedPoolHooks ?? ZeroAddress
      return type === 'LockReleaseTokenPool'
        ? iface.encodeDeploy([
            p.token,
            p.localTokenDecimals,
            hooks,
            p.rmnProxy,
            p.router,
            p.lockBox ?? ZeroAddress,
          ])
        : iface.encodeDeploy([p.token, p.localTokenDecimals, hooks, p.rmnProxy, p.router])
    }
    default:
      throw new CCTParamsInvalidError(
        'deployPool',
        'version',
        `unsupported pool version ${String(version)}`,
      )
  }
}

/**
 * Validates the constructor params before building init-code. Rejects unsupported versions
 * and fields that don't apply to the selected `type`+`version` (rather than silently dropping
 * them), so a misconfigured deploy fails fast instead of deploying the wrong constructor.
 */
function validateDeployPoolParams(op: string, p: DeployPoolParams): void {
  if (p.version !== undefined && !DEPLOYABLE_POOL_VERSIONS.includes(p.version))
    throw new CCTParamsInvalidError(op, 'version', `unsupported pool version ${p.version}`)
  const version = p.version ?? DEFAULT_POOL_VERSION
  const isV2 = version === TokenPoolVersion.V2_0_0
  const isLockRelease = p.type === 'LockReleaseTokenPool'

  validateAddress(op, 'token', p.token)
  validateUint8(op, 'localTokenDecimals', p.localTokenDecimals)
  validateAddress(op, 'rmnProxy', p.rmnProxy)
  validateAddress(op, 'router', p.router)
  ;(p.allowlist ?? []).forEach((addr, i) => validateAddress(op, `allowlist[${i}]`, addr))
  if (p.advancedPoolHooks !== undefined)
    validateAddress(op, 'advancedPoolHooks', p.advancedPoolHooks)
  if (p.lockBox !== undefined) validateAddress(op, 'lockBox', p.lockBox)

  // Reject fields that aren't part of the selected constructor.
  if (isV2 && p.allowlist?.length)
    throw new CCTParamsInvalidError(
      op,
      'allowlist',
      'not supported at 2.0.0 — use advancedPoolHooks',
    )
  if (!isV2 && p.advancedPoolHooks !== undefined)
    throw new CCTParamsInvalidError(op, 'advancedPoolHooks', 'only supported at 2.0.0')
  if (p.lockBox !== undefined && !(isV2 && isLockRelease))
    throw new CCTParamsInvalidError(op, 'lockBox', 'only supported for LockReleaseTokenPool 2.0.0')
  if (p.acceptLiquidity !== undefined && !(isLockRelease && version === TokenPoolVersion.V1_5_1))
    throw new CCTParamsInvalidError(
      op,
      'acceptLiquidity',
      'only supported for LockReleaseTokenPool 1.5.1',
    )
}

/** Deploys a token pool (type + version selected); `execute` resolves to `{ hash, address }`. */
export class DeployPool extends EVMOperation<DeployPoolParams> {
  readonly name = 'deployPool'

  /** Validates the constructor params before building init-code. */
  protected validate(params: DeployPoolParams): void {
    validateDeployPoolParams(this.name, params)
  }

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, params: DeployPoolParams): UnsignedEVMTx {
    const version = params.version ?? DEFAULT_POOL_VERSION
    const { iface, bytecode } = poolArtifact(params.type, version)
    return deploymentTx(bytecode, encodePoolConstructor(iface, params.type, version, params))
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly deployed
   * pool address (read from the mined receipt).
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(
    chain: EVMChain,
    params: DeployPoolParams & { wallet: unknown },
  ): Promise<DeployResult> {
    const { response, receipt } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'deployment produced no contract address', {
        context: { txHash: response.hash },
      })
    return { hash: response.hash, address: receipt.contractAddress }
  }
}
