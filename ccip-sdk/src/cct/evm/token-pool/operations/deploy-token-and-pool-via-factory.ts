/**
 * deployTokenAndPoolViaFactory — deploys a new `CrossChainToken` **and** its token pool in a
 * single transaction through a `TokenPoolFactory 2.0.0` (CREATE2).
 *
 * The signed `execute` path resolves both addresses by `staticCall`-ing the factory's
 * `deployTokenAndTokenPool(...)` first, then broadcasts the identical call. `futureOwner` is
 * auto-filled from the signer when omitted; the CREATE2 `salt` defaults to a random 32-byte value.
 *
 * The unsigned `generate` path builds only the factory-call tx (to: factory) and requires an
 * explicit `futureOwner` (it is baked into the token's constructor).
 *
 * The factory must be the token's `ccipAdmin` (and, for burn-mint, its burn/mint role admin) to
 * wire the registry, so those are set to the factory address; final ownership of the token + pool
 * goes to `futureOwner`.
 *
 * @packageDocumentation
 */

import { AbiCoder, Contract, ZeroAddress, concat, hexlify, randomBytes } from 'ethers'

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
import { CROSS_CHAIN_TOKEN_BYTECODE } from '../../token/bytecodes/CrossChainToken.ts'
import { BURN_MINT_TOKEN_POOL_BYTECODE } from '../bytecodes/BurnMintTokenPool.ts'
import { LOCK_RELEASE_TOKEN_POOL_BYTECODE } from '../bytecodes/LockReleaseTokenPool.ts'
import {
  FACTORY_POOL_TYPE,
  TOKEN_POOL_FACTORY_ABI,
  tokenPoolFactoryInterface,
} from '../token-pool-factory-abi.ts'
import type { FactoryPoolType } from './deploy-pool-via-factory.ts'

/** Canonical CCT v2.0 constructor tuple for CrossChainToken: `ConstructorParams`. */
const CROSS_CHAIN_TOKEN_PARAMS_TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

/** Parameters for `deployTokenAndPoolViaFactory`. */
export type DeployTokenAndPoolViaFactoryParams = {
  /** The `TokenPoolFactory 2.0.0` address on this chain. */
  factoryAddress: string
  name: string
  symbol: string
  decimals: number
  maxSupply: bigint
  /** Amount pre-minted at deploy. Defaults to `0n`. */
  preMint?: bigint
  /** Recipient of the pre-mint. Defaults to `futureOwner`; ignored when `preMint` is `0n`. */
  preMintRecipient?: string
  poolType: FactoryPoolType
  /** Existing `ERC20LockBox` for lock-release; the factory auto-deploys one when omitted. */
  lockBoxAddress?: string
  /** CREATE2 salt. A random 32-byte value is used when omitted (non-deterministic addresses). */
  salt?: string
  /**
   * Final owner of the token + pool. Required on the unsigned path; auto-filled from the signer
   * on the signed path.
   */
  futureOwner?: string
  sender?: string
}

/** Result of a signed `deployTokenAndPoolViaFactory`: tx hash plus both CREATE2 addresses. */
export type DeployTokenAndPoolViaFactoryResult = TransactionHash & {
  tokenAddress: string
  poolAddress: string
  /**
   * EVM lock-release only: the `ERC20LockBox` bound to the token. Read from
   * `pool.getLockBox()` after the deploy when the caller did not supply one (the factory
   * auto-deploys it). Omitted for burn-mint pools.
   */
  lockBoxAddress?: string
  /**
   * Block-explorer verification handles for every contract the factory deployed (the token,
   * the pool, plus the auto-deployed `ERC20LockBox` for lock-release). The factory creates
   * these in internal CREATE2 calls, so each carries its address alongside its constructor args.
   */
  verifications: DeployVerificationTarget[]
}

/** Deploys a new CrossChainToken and its pool in one tx via `TokenPoolFactory 2.0.0`. */
export class DeployTokenAndPoolViaFactory extends EVMOperation<
  DeployTokenAndPoolViaFactoryParams,
  DeployTokenAndPoolViaFactoryResult
> {
  readonly name = 'deployTokenAndPoolViaFactory'

  /** Validates factory-deploy params (`futureOwner` required on the unsigned path). */
  protected validate(p: DeployTokenAndPoolViaFactoryParams): void {
    if (p.poolType !== 'burn-mint' && p.poolType !== 'lock-release')
      throw new CCTParamsInvalidError(
        this.name,
        'poolType',
        "must be 'burn-mint' or 'lock-release'",
      )
    if (!p.factoryAddress || p.factoryAddress.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'factoryAddress', 'must be non-empty')
    if (!p.name || p.name.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'name', 'must be non-empty')
    if (!p.symbol || p.symbol.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'symbol', 'must be non-empty')
    if (p.decimals < 0 || p.decimals > 255)
      throw new CCTParamsInvalidError(this.name, 'decimals', 'must be 0-255')
    if (p.maxSupply < 0n)
      throw new CCTParamsInvalidError(this.name, 'maxSupply', 'must be non-negative')
    if (p.preMint !== undefined && p.preMint < 0n)
      throw new CCTParamsInvalidError(this.name, 'preMint', 'must be non-negative')
    if (p.maxSupply > 0n && p.preMint !== undefined && p.preMint > p.maxSupply)
      throw new CCTParamsInvalidError(this.name, 'preMint', 'exceeds maxSupply')
    if (!p.futureOwner || p.futureOwner.trim().length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'futureOwner',
        'required (the signed deployTokenAndPoolViaFactory path auto-fills it from the signer)',
      )
  }

  /**
   * Assembles the `deployTokenAndTokenPool` argument tuple. The factory is set as the token's
   * `ccipAdmin` (and burn/mint role admin for burn-mint) so it can wire the registry; final
   * ownership goes to `futureOwner`. `salt` defaults to a fresh random value when omitted.
   */
  private assembleArgs(p: DeployTokenAndPoolViaFactoryParams): {
    deployArgs: unknown[]
    tokenArgs: string
  } {
    const futureOwner = p.futureOwner!
    const preMint = p.preMint ?? 0n
    // CrossChainToken reverts unless preMintRecipient is zero exactly when preMint is zero.
    const preMintRecipient = preMint > 0n ? (p.preMintRecipient ?? futureOwner) : ZeroAddress
    const burnMintRoleAdmin = p.poolType === 'burn-mint' ? p.factoryAddress : futureOwner

    const tokenArgs = AbiCoder.defaultAbiCoder().encode(
      [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address'],
      [
        {
          name: p.name,
          symbol: p.symbol,
          maxSupply: p.maxSupply,
          preMint,
          preMintRecipient,
          decimals: p.decimals,
          ccipAdmin: p.factoryAddress,
        },
        burnMintRoleAdmin,
        futureOwner,
      ],
    )
    const tokenInitCode = concat([CROSS_CHAIN_TOKEN_BYTECODE, tokenArgs])
    const poolBytecode =
      p.poolType === 'burn-mint' ? BURN_MINT_TOKEN_POOL_BYTECODE : LOCK_RELEASE_TOKEN_POOL_BYTECODE
    return {
      deployArgs: [
        [],
        p.decimals,
        FACTORY_POOL_TYPE[p.poolType],
        tokenInitCode,
        poolBytecode,
        p.lockBoxAddress ?? ZeroAddress,
        p.salt ?? hexlify(randomBytes(32)),
        futureOwner,
      ],
      tokenArgs,
    }
  }

  /** Builds the factory-call tx (`to: factory`, `data: deployTokenAndTokenPool(...)`). */
  protected buildUnsigned(_chain: EVMChain, p: DeployTokenAndPoolViaFactoryParams): UnsignedEVMTx {
    const data = tokenPoolFactoryInterface.encodeFunctionData(
      'deployTokenAndTokenPool',
      this.assembleArgs(p).deployArgs,
    )
    return { family: ChainFamily.EVM, transactions: [{ to: p.factoryAddress, data }] }
  }

  /**
   * Signed factory deploy: auto-fills `futureOwner` from the signer, fixes the CREATE2 salt,
   * `staticCall`s the factory to resolve token + pool addresses, then broadcasts the same call.
   */
  override async execute(
    chain: EVMChain,
    params: DeployTokenAndPoolViaFactoryParams & { wallet: unknown },
  ): Promise<DeployTokenAndPoolViaFactoryResult> {
    const { wallet } = params
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    // Resolve owner + salt once so the staticCall and the broadcast deploy to the same addresses.
    const futureOwner = params.futureOwner ?? (await wallet.getAddress())
    const effective: DeployTokenAndPoolViaFactoryParams = {
      ...params,
      futureOwner,
      salt: params.salt ?? hexlify(randomBytes(32)),
    }
    const { deployArgs, tokenArgs } = this.assembleArgs(effective)

    const factory = new Contract(effective.factoryAddress, TOKEN_POOL_FACTORY_ABI, wallet)
    const deployFn = factory.getFunction('deployTokenAndTokenPool')
    chain.logger.debug(`${this.name}: simulating to resolve addresses...`)
    const [tokenAddress, poolAddress] = (await deployFn.staticCall(...deployArgs)) as [
      string,
      string,
    ]

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
            token: tokenAddress,
            decimals: params.decimals,
            rmnProxy,
            router: ccipRouter,
            poolAddress,
            lockBoxAddress: lockBoxAddress!,
          }
        : {
            poolType: 'burn-mint',
            token: tokenAddress,
            decimals: params.decimals,
            rmnProxy,
            router: ccipRouter,
            poolAddress,
          },
    )
    const verifications: DeployVerificationTarget[] = [
      { contract: 'CrossChainToken', address: tokenAddress, encodedConstructorArgs: tokenArgs },
      poolVerification,
      ...(lockBoxVerification ? [lockBoxVerification] : []),
    ]
    return {
      hash,
      tokenAddress,
      poolAddress,
      ...(lockBoxAddress ? { lockBoxAddress } : {}),
      verifications,
    }
  }
}
