/**
 * getTokenPoolState — reads a token pool's admin state (v1.5.0–v2.0.0): the owner and admin roles
 * CCT writes are gated on, which {@link EVMChain.getTokenPoolConfig} (a transfer-flow read) does
 * not return. One reader per version generation, since the getters differ.
 *
 * @packageDocumentation
 */

import { getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../../evm/index.ts'
import { resultToObject } from '../../../../evm/types.ts'
import { decodeFinalityAllowed } from '../../../../extra-args.ts'
import { CCTContractTypeInvalidError } from '../../../errors.ts'
import BURN_MINT_TOKEN_POOL_V1_5_0_ABI from '../../artifacts/abi/V1_5_0/burn-mint-token-pool-and-proxy.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/lock-release-token-pool.ts'
import { EVMQuery, getTypedContract } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  type BurnMintTokenPoolType,
  type LockReleaseTokenPoolType,
  type TokenPoolType,
  TokenPoolVersion,
  isLockReleaseTokenPoolType,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetTokenPoolState}. */
export interface GetTokenPoolStateParams {
  /** Token pool contract address to read. */
  poolAddress: string
}

/** Admin state every supported pool version reports, however each spells the call. */
type TokenPoolStateCore = {
  /** Address read, checksummed. */
  poolAddress: string
  /** Token this pool manages. */
  token: string
  /** Local decimals of {@link TokenPoolStateCore.token}. */
  tokenDecimals: number
  /** Router the pool accepts ramp calls from. */
  router: string
  /** Current pool owner — the signer every CCT pool write is gated on. */
  owner: string
  /** RMN proxy the pool checks for curses. */
  rmnProxy: string
  /** Address that may change rate limits besides the owner. */
  rateLimitAdmin: string
  /** Remote chain selectors configured on the pool. */
  supportedChains: bigint[]
}

/**
 * State of a pre-v2.0.0 pool (v1.5.0–v1.6.1), of any supported type: no fee admin, finality
 * window, or lockbox, none of which exist before v2.0.0.
 * @remarks A legacy pool's `allowList` and (lock/release) `rebalancer` are transfer-flow and
 * liquidity concerns, not admin ones; read those via `cct.chain.getTokenPoolConfig()`.
 */
export type LegacyTokenPoolState = TokenPoolStateCore & {
  version: Exclude<TokenPoolVersion, typeof TokenPoolVersion.V2_0_0>
  type: TokenPoolType
}

/** Admin state v2.0.0 adds to {@link TokenPoolStateCore}: the fee role and the finality window. */
type TokenPoolStateCoreV2_0_0 = TokenPoolStateCore & {
  version: typeof TokenPoolVersion.V2_0_0
  /** Address that may change token transfer fee config besides the owner. */
  feeAdmin: string
  /** Min block confirmations the pool allows for Faster-Than-Finality; `0` when FTF is off. */
  finalityDepth: number
  /** Whether the pool allows "safe" finality (FCR). */
  finalitySafe: boolean
}

/** State of a v2.0.0 burn-* mint pool, which mints/burns the token directly. */
export type BurnMintTokenPoolStateV2_0_0 = TokenPoolStateCoreV2_0_0 & {
  type: BurnMintTokenPoolType
}

/** State of a v2.0.0 lock/release pool, whose liquidity is escrowed in a single lockbox. */
export type LockReleaseTokenPoolStateV2_0_0 = TokenPoolStateCoreV2_0_0 & {
  type: 'LockReleaseTokenPool'
  /** Lockbox escrowing this pool's liquidity. */
  lockBox: string
}

/**
 * State of a v2.0.0 pool: `type === 'LockReleaseTokenPool'` adds the `lockBox`, the one field the
 * two families do not share.
 */
export type TokenPoolStateV2_0_0 = BurnMintTokenPoolStateV2_0_0 | LockReleaseTokenPoolStateV2_0_0

/**
 * Admin state of a token pool: `version === '2.0.0'` gates the roles and finality window that
 * version added, and `type === 'LockReleaseTokenPool'` gates its `lockBox`.
 */
export type GetTokenPoolStateResult = LegacyTokenPoolState | TokenPoolStateV2_0_0

/** The pre-v2.0.0 getters every legacy version declares in both families. */
type LegacyTokenPoolGetters = Pick<
  TypedContract<typeof BURN_MINT_TOKEN_POOL_V1_5_0_ABI>,
  'getToken' | 'owner' | 'getRouter' | 'getRmnProxy' | 'getRateLimitAdmin' | 'getSupportedChains'
>

/**
 * The v2.0.0 getters both families declare identically: a lock/release handle satisfies this too,
 * while `getLockBox` stays out of reach of {@link readTokenPoolV2_0_0}.
 */
type TokenPoolGettersV2_0_0 = Pick<
  TypedContract<typeof BURN_MINT_TOKEN_POOL_V2_0_0_ABI>,
  | 'getToken'
  | 'owner'
  | 'getRmnProxy'
  | 'getTokenDecimals'
  | 'getSupportedChains'
  | 'getDynamicConfig'
  | 'getAllowedFinalityConfig'
>

/**
 * Reads a pre-v2.0.0 pool, where `router` and the rate-limit role have their own getters.
 * @remarks v1.5.0 has no `getTokenDecimals`, so decimals come from the token — the one source
 * every legacy version shares.
 */
async function readLegacyTokenPool(
  chain: EVMChain,
  poolAddress: string,
  type: TokenPoolType,
  version: LegacyTokenPoolState['version'],
): Promise<LegacyTokenPoolState> {
  const pool: LegacyTokenPoolGetters = getTypedContract(
    chain,
    poolAddress,
    BURN_MINT_TOKEN_POOL_V1_5_0_ABI,
  )

  const [token, owner, router, rmnProxy, rateLimitAdmin, supportedChains] = await Promise.all([
    resultToObject(pool.getToken()),
    resultToObject(pool.owner()),
    resultToObject(pool.getRouter()),
    resultToObject(pool.getRmnProxy()),
    resultToObject(pool.getRateLimitAdmin()),
    pool.getSupportedChains(),
  ])
  const { decimals } = await chain.getTokenInfo(token)

  return {
    poolAddress: getAddress(poolAddress),
    version,
    type,
    token,
    tokenDecimals: decimals,
    router,
    owner,
    rmnProxy,
    rateLimitAdmin,
    supportedChains: [...supportedChains],
  }
}

/** Reads the v2.0.0 getters both families share, leaving each caller to add its own type field. */
async function readTokenPoolV2_0_0(
  pool: TokenPoolGettersV2_0_0,
  poolAddress: string,
): Promise<TokenPoolStateCoreV2_0_0> {
  const [token, owner, rmnProxy, tokenDecimals, supportedChains, dynamicConfig, allowedFinality] =
    await Promise.all([
      resultToObject(pool.getToken()),
      resultToObject(pool.owner()),
      resultToObject(pool.getRmnProxy()),
      pool.getTokenDecimals(),
      pool.getSupportedChains(),
      // left raw: `resultToObject` turns a named Result into an object, breaking this destructure
      pool.getDynamicConfig(),
      pool.getAllowedFinalityConfig(),
    ])
  const [router, rateLimitAdmin, feeAdmin] = dynamicConfig
  // `allowedFinality` is a bytes4 packing the FCR flag above the 16-bit FTF depth
  const { finalityDepth, finalitySafe } = decodeFinalityAllowed(allowedFinality)

  return {
    poolAddress: getAddress(poolAddress),
    version: TokenPoolVersion.V2_0_0,
    token,
    owner,
    rmnProxy,
    router: resultToObject(router),
    rateLimitAdmin: resultToObject(rateLimitAdmin),
    feeAdmin: resultToObject(feeAdmin),
    // ethers decodes every integer type as bigint, including this `uint8`
    tokenDecimals: Number(tokenDecimals),
    supportedChains: [...supportedChains],
    finalityDepth,
    finalitySafe: !!finalitySafe,
  }
}

/** Reads a v2.0.0 burn-* mint pool: the shared state, with no escrow to report. */
async function readBurnMintTokenPoolV2_0_0(
  chain: EVMChain,
  poolAddress: string,
  type: BurnMintTokenPoolType,
): Promise<BurnMintTokenPoolStateV2_0_0> {
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
  return { ...(await readTokenPoolV2_0_0(pool, poolAddress)), type }
}

/**
 * Reads a v2.0.0 lock/release pool: the shared state plus the lockbox escrowing its liquidity.
 * @throws {@link CCTContractTypeInvalidError} for a siloed pool — it escrows per remote chain
 * (`getLockBox(uint64)`), so no single `lockBox` describes it
 */
async function readLockReleaseTokenPoolV2_0_0(
  chain: EVMChain,
  poolAddress: string,
  type: LockReleaseTokenPoolType,
): Promise<LockReleaseTokenPoolStateV2_0_0> {
  if (type !== 'LockReleaseTokenPool')
    throw new CCTContractTypeInvalidError(poolAddress, 'LockReleaseTokenPool', type)

  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI)
  const [state, lockBox] = await Promise.all([
    readTokenPoolV2_0_0(pool, poolAddress),
    resultToObject(pool.getLockBox()),
  ])
  return { ...state, type, lockBox }
}

/**
 * Reads a token pool's admin state — `owner`, the rate-limit role, token/router/lanes, plus
 * v2.0.0's `feeAdmin`, finality window and `lockBox` — through the vendored ABI of the pool's
 * own version.
 */
export class GetTokenPoolState extends EVMQuery<GetTokenPoolStateParams, GetTokenPoolStateResult> {
  readonly name = 'getTokenPoolState'

  /** Validates the pool address; nothing to convert for {@link read}. */
  protected prepare(params: GetTokenPoolStateParams): GetTokenPoolStateParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type + version, then reads it through the getters that version has.
   * @remarks Dispatch is explicit, not floor-matched like the write ops' encoders: a read's shape
   * is bound to the ABI it decodes through, so adding a pool version has to fail to compile here
   * rather than silently inherit a reader.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a v2.0.0 lock/release variant other
   * than `LockReleaseTokenPool` — a siloed pool escrows per remote chain (`getLockBox(uint64)`),
   * so no single `lockBox` describes it
   * @throws {@link CCTContractVersionUnsupportedError} if the reported version is not a known one
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetTokenPoolStateParams,
  ): Promise<GetTokenPoolStateResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)

    // pre-v2.0.0 has no lockbox at all, so both families read the same way
    if (version !== TokenPoolVersion.V2_0_0)
      return readLegacyTokenPool(chain, poolAddress, type, version)

    return isLockReleaseTokenPoolType(type)
      ? readLockReleaseTokenPoolV2_0_0(chain, poolAddress, type)
      : readBurnMintTokenPoolV2_0_0(chain, poolAddress, type)
  }
}
