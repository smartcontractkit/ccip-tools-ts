/**
 * deployPoolViaFactory — deploys a CCIP token pool for an **existing** token through a
 * `TokenPoolFactory 2.0.0` (CREATE2).
 *
 * The signed `execute` path resolves the pool address by `staticCall`-ing the factory's
 * `deployTokenPoolWithExistingToken(...)` first, then broadcasts the identical call; the
 * pool address is therefore known before the tx is mined. `futureOwner` is auto-filled from
 * the signer when omitted, and the CREATE2 `salt` defaults to a random 32-byte value.
 *
 * The unsigned `generate` path builds only the factory-call tx (to: factory) and requires an
 * explicit `futureOwner` (there is no signer to derive it from).
 *
 * Unlike a token+pool factory deploy, the factory is not the token's `ccipAdmin` here, so the
 * caller must wire the TokenAdminRegistry (propose/accept-admin, set-pool) and, for burn-mint,
 * grant the pool mint/burn roles separately.
 *
 * @packageDocumentation
 */

import { Contract, ZeroAddress, hexlify, randomBytes } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import { type EVMChain, isSigner } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type DeployVerificationTarget,
  buildFactoryPoolVerification,
} from '../../deploy-verification.ts'
import { EVMOperation } from '../../operation.ts'
import { submitForReceipt } from '../../submit.ts'
import { BURN_MINT_TOKEN_POOL_BYTECODE } from '../bytecodes/BurnMintTokenPool.ts'
import { LOCK_RELEASE_TOKEN_POOL_BYTECODE } from '../bytecodes/LockReleaseTokenPool.ts'
import {
  FACTORY_POOL_TYPE,
  TOKEN_POOL_FACTORY_ABI,
  tokenPoolFactoryInterface,
} from '../token-pool-factory-abi.ts'

/** Which pool contract the factory should deploy. */
export type FactoryPoolType = 'burn-mint' | 'lock-release'

/** Parameters for `deployPoolViaFactory`. */
export type DeployPoolViaFactoryParams = {
  /** The `TokenPoolFactory 2.0.0` address on this chain. */
  factoryAddress: string
  /** The existing token the pool will serve. */
  tokenAddress: string
  /** Token decimals on this chain (must match the deployed token). */
  decimals: number
  poolType: FactoryPoolType
  /** Existing `ERC20LockBox` for lock-release; the factory auto-deploys one when omitted. */
  lockBoxAddress?: string
  /** CREATE2 salt. A random 32-byte value is used when omitted (non-deterministic address). */
  salt?: string
  /**
   * Final owner of the pool. Required on the unsigned path; auto-filled from the signer on
   * the signed path.
   */
  futureOwner?: string
  sender?: string
}

/** Result of a signed `deployPoolViaFactory`: tx hash plus the CREATE2 pool address. */
export type DeployPoolViaFactoryResult = TransactionHash & {
  poolAddress: string
  /**
   * EVM lock-release only: the `ERC20LockBox` bound to the token. Read from
   * `pool.getLockBox()` after the deploy when the caller did not supply one (the factory
   * auto-deploys it). Omitted for burn-mint pools.
   */
  lockBoxAddress?: string
  /**
   * Block-explorer verification handles for every contract the factory deployed (the pool,
   * plus the auto-deployed `ERC20LockBox` for lock-release). The factory creates these in
   * internal CREATE2 calls, so each carries its address alongside its constructor args.
   */
  verifications: DeployVerificationTarget[]
}

/** Deploys a CCIP token pool for an existing token via `TokenPoolFactory 2.0.0`. */
export class DeployPoolViaFactory extends EVMOperation<
  DeployPoolViaFactoryParams,
  DeployPoolViaFactoryResult
> {
  readonly name = 'deployPoolViaFactory'

  /** Validates factory-deploy params (`futureOwner` required on the unsigned path). */
  protected validate(p: DeployPoolViaFactoryParams): void {
    if (p.poolType !== 'burn-mint' && p.poolType !== 'lock-release')
      throw new CCTParamsInvalidError(
        this.name,
        'poolType',
        "must be 'burn-mint' or 'lock-release'",
      )
    if (!p.factoryAddress || p.factoryAddress.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'factoryAddress', 'must be non-empty')
    if (!p.tokenAddress || p.tokenAddress.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    if (p.decimals < 0 || p.decimals > 255)
      throw new CCTParamsInvalidError(this.name, 'decimals', 'must be 0-255')
    if (!p.futureOwner || p.futureOwner.trim().length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'futureOwner',
        'required (the signed deployPoolViaFactory path auto-fills it from the signer)',
      )
  }

  /**
   * Assembles the `deployTokenPoolWithExistingToken` argument tuple. `futureOwner` and `salt`
   * are read from `p` (already resolved by {@link execute} on the signed path; supplied by the
   * caller on the unsigned path, where `salt` defaults to a fresh random value).
   */
  private assembleArgs(p: DeployPoolViaFactoryParams): unknown[] {
    const poolBytecode =
      p.poolType === 'burn-mint' ? BURN_MINT_TOKEN_POOL_BYTECODE : LOCK_RELEASE_TOKEN_POOL_BYTECODE
    return [
      p.tokenAddress,
      p.decimals,
      FACTORY_POOL_TYPE[p.poolType],
      [],
      poolBytecode,
      p.lockBoxAddress ?? ZeroAddress,
      p.salt ?? hexlify(randomBytes(32)),
      p.futureOwner!,
    ]
  }

  /** Builds the factory-call tx (`to: factory`, `data: deployTokenPoolWithExistingToken(...)`). */
  protected buildUnsigned(_chain: EVMChain, p: DeployPoolViaFactoryParams): UnsignedEVMTx {
    const data = tokenPoolFactoryInterface.encodeFunctionData(
      'deployTokenPoolWithExistingToken',
      this.assembleArgs(p),
    )
    return { family: ChainFamily.EVM, transactions: [{ to: p.factoryAddress, data }] }
  }

  /**
   * Signed factory deploy: auto-fills `futureOwner` from the signer, fixes the CREATE2 salt,
   * `staticCall`s the factory to resolve the pool address, then broadcasts the identical call.
   */
  override async execute(
    chain: EVMChain,
    params: DeployPoolViaFactoryParams & { wallet: unknown },
  ): Promise<DeployPoolViaFactoryResult> {
    const { wallet } = params
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    // Resolve owner + salt once so the staticCall and the broadcast deploy to the same address.
    const futureOwner = params.futureOwner ?? (await wallet.getAddress())
    const effective: DeployPoolViaFactoryParams = {
      ...params,
      futureOwner,
      salt: params.salt ?? hexlify(randomBytes(32)),
    }
    const deployArgs = this.assembleArgs(effective)

    const factory = new Contract(effective.factoryAddress, TOKEN_POOL_FACTORY_ABI, wallet)
    const deployFn = factory.getFunction('deployTokenPoolWithExistingToken')
    chain.logger.debug(`${this.name}: simulating to resolve pool address...`)
    const poolAddress = (await deployFn.staticCall(...deployArgs)) as string

    // The factory appends the pool ctor args from its own immutables; read them to rebuild
    // the verification handles.
    const { rmnProxy, ccipRouter } = (await factory.getFunction('getStaticConfig')()) as {
      rmnProxy: string
      ccipRouter: string
    }

    const unsigned = await this.generate(chain, effective)
    const { hash } = await submitForReceipt(chain, wallet, unsigned, this.name)

    // lock-release without a supplied lockbox: the factory auto-deploys one; surface it.
    let lockBoxAddress = params.lockBoxAddress
    if (params.poolType === 'lock-release' && !lockBoxAddress) {
      const pool = new Contract(poolAddress, interfaces.TokenPool_v2_0, chain.provider)
      lockBoxAddress = (await pool.getFunction('getLockBox')()) as string
    }

    const { poolVerification, lockBoxVerification } = buildFactoryPoolVerification(
      params.poolType === 'lock-release'
        ? {
            poolType: 'lock-release',
            token: params.tokenAddress,
            decimals: params.decimals,
            rmnProxy,
            router: ccipRouter,
            poolAddress,
            lockBoxAddress: lockBoxAddress!,
          }
        : {
            poolType: 'burn-mint',
            token: params.tokenAddress,
            decimals: params.decimals,
            rmnProxy,
            router: ccipRouter,
            poolAddress,
          },
    )
    return {
      hash,
      poolAddress,
      ...(lockBoxAddress ? { lockBoxAddress } : {}),
      verifications: [poolVerification, ...(lockBoxVerification ? [lockBoxVerification] : [])],
    }
  }
}
