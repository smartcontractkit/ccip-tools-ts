/**
 * Minimal human-readable ABI (and a cached {@link Interface}) for `TokenPoolFactory 2.0.0`
 * (chainlink-ccip `chains/evm/contracts/TokenPoolFactory.sol`).
 *
 * Only the members the factory-deploy operations need are declared. `RemoteTokenPoolInfo`
 * is spelled out so the empty remote-pools array type-checks; the same-chain deploys here
 * always pass `[]` for it.
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

const REMOTE_TOKEN_POOL_INFO =
  'tuple(uint64 remoteChainSelector, bytes remotePoolAddress, bytes remotePoolInitCode, tuple(address remotePoolFactory, address remoteRouter, address remoteRMNProxy, address remoteLockBox, uint8 remoteTokenDecimals) remoteChainConfig, uint8 poolType, bytes remoteTokenAddress, bytes remoteTokenInitCode, tuple(bool isEnabled, uint128 capacity, uint128 rate) rateLimiterConfig)[] remoteTokenPools'

/** Human-readable ABI fragments for `TokenPoolFactory 2.0.0`. */
export const TOKEN_POOL_FACTORY_ABI = [
  'function getStaticConfig() view returns (address rmnProxy, address tokenAdminRegistry, address registryModuleOwnerCustom, address ccipRouter)',
  `function deployTokenAndTokenPool(${REMOTE_TOKEN_POOL_INFO}, uint8 localTokenDecimals, uint8 localPoolType, bytes tokenInitCode, bytes tokenPoolInitCode, address lockBox, bytes32 salt, address futureOwner) returns (address token, address pool)`,
  `function deployTokenPoolWithExistingToken(address token, uint8 localTokenDecimals, uint8 localPoolType, ${REMOTE_TOKEN_POOL_INFO}, bytes tokenPoolInitCode, address lockBox, bytes32 salt, address futureOwner) returns (address pool)`,
] as const

/** Cached {@link Interface} built from {@link TOKEN_POOL_FACTORY_ABI}. */
export const tokenPoolFactoryInterface = new Interface(TOKEN_POOL_FACTORY_ABI)

/** `TokenPoolFactory` `PoolType` enum: `BURN_MINT = 0`, `LOCK_RELEASE = 1`. */
export const FACTORY_POOL_TYPE = { 'burn-mint': 0, 'lock-release': 1 } as const
