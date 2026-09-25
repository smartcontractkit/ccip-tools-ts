/**
 * {@link deployTokenAndTokenPoolViaFactory} / {@link deployTokenPoolWithExistingTokenViaFactory} —
 * build the unsigned `TokenPoolFactory` (v2.0.0) deploy calls and return them alongside the
 * addresses they will create, known before signing. Mirrors `createx/deploy.ts`.
 *
 * @remarks **Unsigned-only, by design (TOB-CLCCT-9/#5).** These return an `UnsignedEVMTx` plus the
 * predicted addresses; there is no `execute`. The factory salt is `keccak256(abi.encodePacked(salt,
 * msg.sender))`, so **whoever sends the transaction (`sender`) is baked into the salt and therefore
 * into the deployed address** — sending it from any other account deploys elsewhere and can
 * misassign ownership. Sign it with a wallet whose address equals `sender` (typically a Safe).
 *
 * @remarks **RPC-trust caveat (TOB-CLCCT-7/#4 hybrid).** Unlike CreateX, where the init code is
 * fully caller-supplied, the *pool* address here depends on `rmnProxy`/`ccipRouter` the factory
 * builds into the pool constructor — read from the factory's `getStaticConfig()` over RPC. So the
 * predicted pool address is only as trustworthy as that read. Pass `expectedStaticConfig` to pin it
 * to values you trust; the checked functions then assert the on-chain config matches and throw on
 * divergence. The returned addresses are always the **locally-predicted** CREATE2 addresses, never
 * an RPC-returned value.
 *
 * @packageDocumentation
 */

import { ZeroAddress, concat, getAddress } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../evm/types.ts'
import { ChainFamily } from '../../../networks.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import {
  type DeployableTokenPoolType,
  getTokenPoolArtifact,
  getTokenPoolFamily,
} from '../token-pool/contracts.ts'
import { TokenVersion, getTokenArtifact } from '../token/contracts.ts'
import {
  parseHexBytes,
  validateAddress,
  validateNonZeroAddress,
  validateUint8,
} from '../validate.ts'
import {
  type FactoryStaticConfig,
  FACTORY_POOL_TYPE,
  TOKEN_POOL_FACTORY_INTERFACE,
  assertTokenPoolFactory,
  readFactoryStaticConfig,
} from './contracts.ts'
import {
  type FactoryPoolFamily,
  assertNonEmptyInitCode,
  buildPoolInitArgs,
  guardFactorySalt,
  normalizeFactorySalt,
  predictFactoryLockBox,
  predictFactoryPool,
  predictFactoryToken,
} from './predict.ts'

/** Pool types the factory supports: the two whose constructor shape its init-arg encoding matches. */
export type FactoryTokenPoolType = Extract<
  DeployableTokenPoolType,
  'BurnMintTokenPool' | 'LockReleaseTokenPool'
>

/** Per-remote-chain addressing the factory needs to configure or predict the remote pool. */
export type FactoryRemoteChainConfig = {
  remotePoolFactory: string
  remoteRouter: string
  remoteRMNProxy: string
  /** Remote lockbox for LOCK_RELEASE remotes; zero otherwise. */
  remoteLockBox: string
  remoteTokenDecimals: number
}

/** Token-pool rate limit applied to inbound and outbound messages on the configured lane. */
export type FactoryRateLimiterConfig = {
  isEnabled: boolean
  capacity: bigint
  rate: bigint
}

/**
 * One remote token pool to wire into the new pool's `applyChainUpdates`.
 *
 * @remarks `remotePoolAddress`/`remoteTokenAddress` are the *remote* chain's addresses as the
 * `bytes` the pool stores and matches against at `releaseOrMint` — **not** a plain EVM address.
 * For an EVM remote this is `abi.encode(address)` (a 32-byte left-padded word), which the shared
 * {@link encodeAddressToAny} produces from an address; a raw 20-byte address would misconfigure
 * the lane and revert `InvalidSourcePoolAddress` on the destination. This mirrors how
 * `applyChainUpdates`/`addRemotePool` take these fields (validated via `parseHexBytes`, never
 * auto-encoded). Leave empty (`0x`, the default) to have the factory predict the remote address
 * on-chain.
 */
export type FactoryRemoteTokenPool = {
  remoteChainSelector: bigint
  /** Remote pool address as pre-encoded `bytes` (EVM: `abi.encode(address)`), or `0x` to have the factory predict it. */
  remotePoolAddress?: string
  remotePoolInitCode?: string
  remoteChainConfig: FactoryRemoteChainConfig
  poolType: FactoryPoolFamily
  /** Remote token address as pre-encoded `bytes` (EVM: `abi.encode(address)`), or `0x` to have the factory predict it. */
  remoteTokenAddress?: string
  remoteTokenInitCode?: string
  rateLimiterConfig?: FactoryRateLimiterConfig
}

/** Common options for both factory deploy builders. */
export type FactoryDeployCommon = {
  /** The `TokenPoolFactory` (v2.0.0) to call. */
  factory: string
  /**
   * Whoever will send the resulting transaction — typically a Safe. Baked into the salt and thus
   * the deployed address; a transaction from anyone else deploys elsewhere.
   */
  sender: string
  /** 32-byte hex salt, or a non-empty label hashed into one — see {@link normalizeFactorySalt}. */
  salt: string
  /** Address the deployed token/pool ownership is *proposed* to (Ownable2Step). Zero → the factory uses `sender`. */
  futureOwner?: string
  /** Remote pools to configure at deploy time; defaults to none. */
  remoteTokenPools?: FactoryRemoteTokenPool[]
  /**
   * Trusted `rmnProxy`/`ccipRouter` to pin the RPC-read static config against. When set, the
   * checked builders assert the factory's `getStaticConfig()` matches and throw on divergence.
   */
  expectedStaticConfig?: { rmnProxy: string; router: string }
}

/** Parameters for {@link deployTokenAndTokenPoolViaFactory}. */
export type DeployTokenAndTokenPoolViaFactoryParams = FactoryDeployCommon & {
  /** Local pool type; `BurnMintTokenPool` or `LockReleaseTokenPool`. */
  type: FactoryTokenPoolType
  /** CrossChainToken constructor inputs; `ccipAdmin` and `burnMintRoleAdmin` are forced to the factory. */
  token: {
    name: string
    symbol: string
    decimals: number
    maxSupply: bigint
    preMint?: bigint
    preMintRecipient?: string
    /** DEFAULT_ADMIN of the token; defaults to `futureOwner` (or `sender`). */
    owner?: string
  }
  /** Existing lockbox for a LockRelease pool; omit to have the factory deploy (and return) one. */
  lockBox?: string
}

/** Parameters for {@link deployTokenPoolWithExistingTokenViaFactory}. */
export type DeployTokenPoolWithExistingTokenViaFactoryParams = FactoryDeployCommon & {
  type: FactoryTokenPoolType
  /** The already-deployed token the pool serves. */
  token: string
  localTokenDecimals: number
  /** Existing lockbox for a LockRelease pool; omit to have the factory deploy (and return) one. */
  lockBox?: string
}

/** A factory deployment: the unsigned tx plus the addresses it will create, all locally predicted. */
export type FactoryDeploy = {
  /** Predicted token address — only for {@link deployTokenAndTokenPoolViaFactory}. */
  token?: string
  /** Predicted pool address. */
  pool: string
  /** Predicted address of a lockbox the factory auto-deploys (LockRelease with no `lockBox`). */
  lockBox?: string
  /** The call to the factory to send from `sender`. */
  transaction: UnsignedEVMTx
}

const NAME_DEPLOY_BOTH = 'deployTokenAndTokenPoolViaFactory'
const NAME_DEPLOY_POOL = 'deployTokenPoolWithExistingTokenViaFactory'

/**
 * Validates a remote pool/token address the caller supplies as `bytes` for the lane, the same way
 * `applyChainUpdates`/`addRemotePool` do (`parseHexBytes`: non-empty whole-byte hex, normalised to
 * lowercase `0x`). It is **not** auto-encoded from an EVM address — an EVM remote must already be
 * `abi.encode(address)`, e.g. via the shared {@link encodeAddressToAny}. `undefined`/`0x` means
 * "let the factory predict it" and passes through as `0x`.
 * @throws {@link CCTParamsInvalidError} if `value` is a non-empty value that is not whole-byte hex
 */
function parseRemoteAddress(operation: string, param: string, value: string | undefined): string {
  if (value === undefined || value === '0x') return '0x'
  return parseHexBytes(operation, param, value)
}

/** Maps a remote-pool input to the ABI tuple shape, applying `0x`/disabled defaults. */
function toAbiRemote(operation: string, r: FactoryRemoteTokenPool) {
  return {
    remoteChainSelector: r.remoteChainSelector,
    remotePoolAddress: parseRemoteAddress(operation, 'remotePoolAddress', r.remotePoolAddress),
    remotePoolInitCode: r.remotePoolInitCode ?? '0x',
    remoteChainConfig: {
      remotePoolFactory: r.remoteChainConfig.remotePoolFactory,
      remoteRouter: r.remoteChainConfig.remoteRouter,
      remoteRMNProxy: r.remoteChainConfig.remoteRMNProxy,
      remoteLockBox: r.remoteChainConfig.remoteLockBox,
      remoteTokenDecimals: r.remoteChainConfig.remoteTokenDecimals,
    },
    poolType: FACTORY_POOL_TYPE[r.poolType],
    remoteTokenAddress: parseRemoteAddress(operation, 'remoteTokenAddress', r.remoteTokenAddress),
    remoteTokenInitCode: r.remoteTokenInitCode ?? '0x',
    rateLimiterConfig: r.rateLimiterConfig ?? {
      isEnabled: false,
      capacity: 0n,
      rate: 0n,
    },
  }
}

/** Builds the CrossChainToken creation code with `ccipAdmin`/`burnMintRoleAdmin` forced to the factory. */
function buildFactoryTokenInitCode(
  factory: string,
  owner: string,
  token: DeployTokenAndTokenPoolViaFactoryParams['token'],
): string {
  const { iface, bytecode } = getTokenArtifact(TokenVersion.V2_0_0)
  const ctor = iface.encodeDeploy([
    [
      token.name,
      token.symbol,
      token.maxSupply,
      token.preMint ?? 0n,
      token.preMintRecipient ?? ZeroAddress,
      token.decimals,
      factory, // ccipAdmin — required by the factory
    ],
    factory, // burnMintRoleAdmin — required by the factory for BurnMint pools
    owner,
  ])
  return concat([bytecode, ctor])
}

/** Resolves the pool's lockbox (given or factory-predicted) for a LockRelease deploy; undefined for BurnMint. */
function resolveLockBox(
  family: FactoryPoolFamily,
  lockBox: string | undefined,
  factory: string,
  guardedSalt: string,
  token: string,
): { forCall: string; predicted?: string; forInitArgs?: string } {
  if (family !== 'LockRelease') return { forCall: ZeroAddress }
  if (lockBox !== undefined && lockBox !== ZeroAddress)
    return { forCall: lockBox, forInitArgs: lockBox }
  const predicted = predictFactoryLockBox(factory, guardedSalt, token)
  return { forCall: ZeroAddress, predicted, forInitArgs: predicted }
}

/**
 * Builds {@link deployTokenAndTokenPoolViaFactory} with a caller-supplied static config, without any
 * RPC. Prefer the checked variant, which reads and (optionally) pins the config and checks occupancy.
 * @throws {@link CCTParamsInvalidError} on a bad address, empty init code, or bad salt/decimals
 */
export function deployTokenAndTokenPoolViaFactoryUnchecked(
  params: DeployTokenAndTokenPoolViaFactoryParams,
  staticConfig: { rmnProxy: string; router: string },
): FactoryDeploy {
  validateNonZeroAddress(NAME_DEPLOY_BOTH, 'factory', params.factory)
  validateAddress(NAME_DEPLOY_BOTH, 'sender', params.sender)
  validateUint8(NAME_DEPLOY_BOTH, 'token.decimals', params.token.decimals)

  const family = getTokenPoolFamily(params.type)
  const owner = params.token.owner ?? params.futureOwner ?? params.sender
  const tokenInitCode = buildFactoryTokenInitCode(params.factory, owner, params.token)
  const tokenPoolInitCode = getTokenPoolArtifact(params.type).bytecode
  assertNonEmptyInitCode(NAME_DEPLOY_BOTH, 'tokenInitCode', tokenInitCode)
  assertNonEmptyInitCode(NAME_DEPLOY_BOTH, 'tokenPoolInitCode', tokenPoolInitCode)

  const userSalt = normalizeFactorySalt(NAME_DEPLOY_BOTH, params.salt)
  const guardedSalt = guardFactorySalt(userSalt, params.sender)
  const token = predictFactoryToken(params.factory, guardedSalt, tokenInitCode)
  const lb = resolveLockBox(family, params.lockBox, params.factory, guardedSalt, token)
  const poolInitArgs = buildPoolInitArgs(family, {
    token,
    decimals: params.token.decimals,
    rmnProxy: staticConfig.rmnProxy,
    router: staticConfig.router,
    lockBox: lb.forInitArgs,
  })
  const pool = predictFactoryPool(params.factory, guardedSalt, tokenPoolInitCode, poolInitArgs)

  const data = TOKEN_POOL_FACTORY_INTERFACE.encodeFunctionData('deployTokenAndTokenPool', [
    (params.remoteTokenPools ?? []).map((r) => toAbiRemote(NAME_DEPLOY_BOTH, r)),
    params.token.decimals,
    FACTORY_POOL_TYPE[family],
    tokenInitCode,
    tokenPoolInitCode,
    lb.forCall,
    userSalt,
    params.futureOwner ?? ZeroAddress,
  ])
  return {
    token,
    pool,
    ...(lb.predicted !== undefined && { lockBox: lb.predicted }),
    transaction: {
      family: ChainFamily.EVM,
      transactions: [{ from: params.sender, to: params.factory, data }],
    },
  }
}

/**
 * Builds {@link deployTokenPoolWithExistingTokenViaFactory} with a caller-supplied static config,
 * without any RPC.
 * @throws {@link CCTParamsInvalidError} on a bad address, empty init code, or bad salt/decimals
 */
export function deployTokenPoolWithExistingTokenViaFactoryUnchecked(
  params: DeployTokenPoolWithExistingTokenViaFactoryParams,
  staticConfig: { rmnProxy: string; router: string },
): FactoryDeploy {
  validateNonZeroAddress(NAME_DEPLOY_POOL, 'factory', params.factory)
  validateAddress(NAME_DEPLOY_POOL, 'sender', params.sender)
  validateNonZeroAddress(NAME_DEPLOY_POOL, 'token', params.token)
  validateUint8(NAME_DEPLOY_POOL, 'localTokenDecimals', params.localTokenDecimals)

  const family = getTokenPoolFamily(params.type)
  const tokenPoolInitCode = getTokenPoolArtifact(params.type).bytecode
  assertNonEmptyInitCode(NAME_DEPLOY_POOL, 'tokenPoolInitCode', tokenPoolInitCode)

  const userSalt = normalizeFactorySalt(NAME_DEPLOY_POOL, params.salt)
  const guardedSalt = guardFactorySalt(userSalt, params.sender)
  const lb = resolveLockBox(family, params.lockBox, params.factory, guardedSalt, params.token)
  const poolInitArgs = buildPoolInitArgs(family, {
    token: params.token,
    decimals: params.localTokenDecimals,
    rmnProxy: staticConfig.rmnProxy,
    router: staticConfig.router,
    lockBox: lb.forInitArgs,
  })
  const pool = predictFactoryPool(params.factory, guardedSalt, tokenPoolInitCode, poolInitArgs)

  const data = TOKEN_POOL_FACTORY_INTERFACE.encodeFunctionData('deployTokenPoolWithExistingToken', [
    params.token,
    params.localTokenDecimals,
    FACTORY_POOL_TYPE[family],
    (params.remoteTokenPools ?? []).map((r) => toAbiRemote(NAME_DEPLOY_POOL, r)),
    tokenPoolInitCode,
    lb.forCall,
    userSalt,
    params.futureOwner ?? ZeroAddress,
  ])
  return {
    pool,
    ...(lb.predicted !== undefined && { lockBox: lb.predicted }),
    transaction: {
      family: ChainFamily.EVM,
      transactions: [{ from: params.sender, to: params.factory, data }],
    },
  }
}

/**
 * Reads the factory's static config over RPC, asserts it is a real `TokenPoolFactory 2.0.0`, and
 * (when `expectedStaticConfig` is set) asserts the read config matches trusted values.
 * @throws {@link CCTParamsInvalidError} if the pinned static config diverges from the on-chain read
 */
async function resolveStaticConfig(
  operation: string,
  chain: EVMChain,
  factory: string,
  expected: { rmnProxy: string; router: string } | undefined,
): Promise<{ rmnProxy: string; router: string }> {
  await assertTokenPoolFactory(operation, chain, factory)
  const cfg: FactoryStaticConfig = await readFactoryStaticConfig(chain, factory)
  if (expected !== undefined) {
    if (
      getAddress(expected.rmnProxy) !== cfg.rmnProxy ||
      getAddress(expected.router) !== cfg.ccipRouter
    )
      throw new CCTParamsInvalidError(
        operation,
        'expectedStaticConfig',
        `factory getStaticConfig() is rmnProxy=${cfg.rmnProxy}, ccipRouter=${cfg.ccipRouter}, which does not match the pinned rmnProxy=${expected.rmnProxy}, router=${expected.router} — the predicted pool address would be wrong; do not deploy`,
      )
  }
  return { rmnProxy: cfg.rmnProxy, router: cfg.ccipRouter }
}

/** Fails if any predicted address is already occupied (a reused salt+init-code pair). */
async function assertUnoccupied(
  chain: EVMChain,
  operation: string,
  addresses: (string | undefined)[],
): Promise<void> {
  for (const address of addresses) {
    if (address === undefined) continue
    if ((await chain.provider.getCode(address)) !== '0x')
      throw new CCTParamsInvalidError(
        operation,
        'salt',
        `${address} already holds code — this salt and init-code pair has been deployed already; vary \`salt\` to get a fresh address`,
      )
  }
}

/**
 * Builds an unsigned `deployTokenAndTokenPool` call and returns it with the predicted token, pool,
 * and (if auto-deployed) lockbox addresses. Reads `getStaticConfig()` to predict the pool address,
 * asserts the factory is a real `TokenPoolFactory 2.0.0`, and checks the predicted addresses are free.
 *
 * @remarks Unsigned-only; see the module header for the sender/salt binding and RPC-trust caveats.
 * @throws {@link CCTParamsInvalidError} if `factory`/`sender` is invalid, init code is empty, the
 * salt is malformed, `expectedStaticConfig` diverges, or a predicted address is occupied
 * @throws {@link CCTContractTypeInvalidError}/{@link CCTContractVersionUnsupportedError} if `factory` is not a `TokenPoolFactory 2.0.0`
 */
export async function deployTokenAndTokenPoolViaFactory(
  chain: EVMChain,
  params: DeployTokenAndTokenPoolViaFactoryParams,
): Promise<FactoryDeploy> {
  const staticConfig = await resolveStaticConfig(
    NAME_DEPLOY_BOTH,
    chain,
    params.factory,
    params.expectedStaticConfig,
  )
  const deploy = deployTokenAndTokenPoolViaFactoryUnchecked(params, staticConfig)
  await assertUnoccupied(chain, NAME_DEPLOY_BOTH, [deploy.token, deploy.pool, deploy.lockBox])
  return deploy
}

/**
 * Builds an unsigned `deployTokenPoolWithExistingToken` call and returns it with the predicted pool
 * and (if auto-deployed) lockbox addresses. Same reads/asserts as {@link deployTokenAndTokenPoolViaFactory}.
 *
 * @remarks Unsigned-only; see the module header for the sender/salt binding and RPC-trust caveats.
 * @throws {@link CCTParamsInvalidError} if `factory`/`sender`/`token` is invalid, init code is
 * empty, the salt is malformed, `expectedStaticConfig` diverges, or a predicted address is occupied
 * @throws {@link CCTContractTypeInvalidError}/{@link CCTContractVersionUnsupportedError} if `factory` is not a `TokenPoolFactory 2.0.0`
 */
export async function deployTokenPoolWithExistingTokenViaFactory(
  chain: EVMChain,
  params: DeployTokenPoolWithExistingTokenViaFactoryParams,
): Promise<FactoryDeploy> {
  const staticConfig = await resolveStaticConfig(
    NAME_DEPLOY_POOL,
    chain,
    params.factory,
    params.expectedStaticConfig,
  )
  const deploy = deployTokenPoolWithExistingTokenViaFactoryUnchecked(params, staticConfig)
  await assertUnoccupied(chain, NAME_DEPLOY_POOL, [deploy.pool, deploy.lockBox])
  return deploy
}
