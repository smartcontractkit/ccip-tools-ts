/**
 * deployTokenPool — deploys a token pool (`type` selects the contract) via raw init-code at
 * v2.0.0. The tx has no `to`; `execute` returns the deployed pool address. Mirrors
 * `token/operations/deploy-token.ts`.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../../artifacts/bytecode/V2_0_0/burn-from-mint-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../../artifacts/bytecode/V2_0_0/burn-with-from-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'
import {
  type DeployResult,
  type EVMExecuteParams,
  EVMOperation,
  deploymentTx,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import { validateAddress, validateUint8 } from '../../validate.ts'
import {
  type TokenPoolFamily,
  type TokenPoolType,
  TokenPoolVersion,
  getTokenPoolFamily,
  getTokenPoolInterface,
} from '../version.ts'

/**
 * Creation bytecode per deployable pool type (2.0.0 only — pre-2.0.0 bytecode is not vendored).
 * The keys define the deployable set ({@link DeployableTokenPoolType} derives from them). The
 * burn-* variants share the `BurnMint` constructor ABI but are distinct contracts with distinct
 * bytecode.
 */
const TOKEN_POOL_BYTECODE: Partial<Record<TokenPoolType, any>> = {
  BurnMintTokenPool: BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  BurnFromMintTokenPool: BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  BurnWithFromMintTokenPool: BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  LockReleaseTokenPool: LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE,
}

/** A pool contract type that can be deployed (has vendored 2.0.0 creation bytecode). */
export type DeployableTokenPoolType = keyof typeof TOKEN_POOL_BYTECODE

/** Fields shared by every deployable token pool. */
interface DeployTokenPoolBase {
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
export interface DeployBurnMintTokenPoolParams extends DeployTokenPoolBase {
  type: Exclude<DeployableTokenPoolType, 'LockReleaseTokenPool'>
}

/** Params for a `LockReleaseTokenPool` — the burn constructor plus `lockBox`. */
export interface DeployLockReleaseTokenPoolParams extends DeployTokenPoolBase {
  type: 'LockReleaseTokenPool'
  /** Lock-box address; defaults to the zero address. */
  lockBox?: string
}

/**
 * Parameters for {@link DeployTokenPool}, discriminated on `type`: the burn-* variants share one
 * constructor; `LockReleaseTokenPool` additionally accepts `lockBox` (a compile-time guarantee).
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

/** LockRelease constructor: the burn-* args plus `lockBox` (only that variant carries it). */
const encodeLockReleaseTokenPool: TokenPoolConstructorEncoder = (iface, p) =>
  iface.encodeDeploy([
    p.token,
    p.localTokenDecimals,
    p.advancedPoolHooks ?? ZeroAddress,
    p.rmnProxy,
    p.router,
    p.type === 'LockReleaseTokenPool' ? (p.lockBox ?? ZeroAddress) : ZeroAddress,
  ])

/** Deploys a token pool; `execute` resolves to `{ hash, contractAddress }`. */
export class DeployTokenPool extends EVMOperation<DeployTokenPoolParams> {
  readonly name = 'deployTokenPool'

  /** Constructor encoder per ABI {@link TokenPoolFamily}; `type` narrows to its family. */
  private readonly encoders: Record<TokenPoolFamily, TokenPoolConstructorEncoder> = {
    BurnMint: encodeBurnMintTokenPool,
    LockRelease: encodeLockReleaseTokenPool,
  }

  /** Validates the constructor params before building init-code. */
  protected validate(params: DeployTokenPoolParams): void {
    if (!Object.hasOwn(TOKEN_POOL_BYTECODE, params.type))
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
    if (params.type === 'LockReleaseTokenPool' && params.lockBox !== undefined)
      validateAddress(this.name, 'lockBox', params.lockBox)
  }

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, params: DeployTokenPoolParams): UnsignedEVMTx {
    const iface = getTokenPoolInterface(params.type, TokenPoolVersion.V2_0_0)
    const encode = this.encoders[getTokenPoolFamily(params.type)]
    return deploymentTx(TOKEN_POOL_BYTECODE[params.type], encode(iface, params))
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly deployed
   * pool address (read from the mined receipt).
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<DeployTokenPoolParams>,
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
    return { hash: response.hash, contractAddress: receipt.contractAddress }
  }
}
