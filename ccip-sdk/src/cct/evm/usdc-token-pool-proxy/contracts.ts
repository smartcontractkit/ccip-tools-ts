/**
 * EVM `USDCTokenPoolProxy` contract layer for CCT: the cached {@link Interface}
 * ({@link USDC_TOKEN_POOL_PROXY_INTERFACE}), the deploy artifact
 * ({@link getUSDCTokenPoolProxyArtifact}), the on-chain identity check
 * ({@link assertUSDCTokenPoolProxy}), and the reads its query ops make: the static config
 * ({@link readUSDCTokenPoolProxyStaticConfig}), child pools ({@link readUSDCTokenPoolProxyPools}),
 * fee aggregator ({@link readUSDCTokenPoolProxyFeeAggregator}), owner
 * ({@link readUSDCTokenPoolProxyOwner}), a lane's mechanism ({@link readLockOrBurnMechanism}),
 * its remote pools ({@link readUSDCTokenPoolProxyRemotePools}) and its required CCVs
 * ({@link readUSDCTokenPoolProxyRequiredCCVs}). Only one version is supported, so there is no
 * version framework here. Mirrors `lockbox/contracts.ts`.
 *
 * @remarks The proxy is not a `TokenPool`: it is what the TokenAdminRegistry returns as USDC's pool
 * on a 2.0.0 chain, and it routes each lane to one of four child pools by the lane's
 * {@link LockOrBurnMechanism}.
 *
 * @packageDocumentation
 */

import { type BytesLike, Interface, ZeroAddress, getAddress, hexlify } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTDataDecodeError,
  CCTParamsInvalidError,
} from '../../errors.ts'
import USDC_TOKEN_POOL_PROXY_V2_0_0_ABI from '../artifacts/abi/V2_0_0/usdc-token-pool-proxy.ts'
import USDC_TOKEN_POOL_PROXY_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/usdc-token-pool-proxy.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract, isMissingFunction } from '../query.ts'

/** The `typeAndVersion` contract type a USDC token pool proxy reports. */
export const USDC_TOKEN_POOL_PROXY_TYPE = 'USDCTokenPoolProxy'

/**
 * Proxy versions this SDK supports, a flat list as `LOCKBOX_VERSIONS` is. The 1.6.4 proxy deployed
 * on some chains ships in no pinned `@chainlink/contracts-ccip`, so it is rejected.
 */
const USDC_TOKEN_POOL_PROXY_VERSIONS: string[] = ['2.0.0']

/** Shared, cached `USDCTokenPoolProxy` interface for constructor and calldata encoding. */
export const USDC_TOKEN_POOL_PROXY_INTERFACE = new Interface(USDC_TOKEN_POOL_PROXY_V2_0_0_ABI)

/** `LockOrBurnMechanism` names; the index is the on-chain enum ordinal. */
export const LOCK_OR_BURN_MECHANISMS = [
  'INVALID_MECHANISM',
  'CCTP_V1',
  'CCTP_V2',
  'LOCK_RELEASE',
  'CCV',
] as const

/** How the proxy routes a lane; `INVALID_MECHANISM` means the lane is not served. */
export type LockOrBurnMechanism = (typeof LOCK_OR_BURN_MECHANISMS)[number]

/** Child pool per mechanism; `ZeroAddress` leaves that mechanism unroutable. */
export type USDCTokenPoolProxyPools = {
  /** Pool for `CCTP_V1` lanes; must support `IPoolV1`. */
  cctpV1Pool: string
  /** Pool for `CCTP_V2` lanes; must support `IPoolV1`. */
  cctpV2Pool: string
  /** Pool for `CCV` lanes; must support `IPoolV2`. */
  cctpV2PoolWithCCV: string
  /** Pool for `LOCK_RELEASE` lanes; must support `IPoolV1` or `IPoolV2`. */
  siloedLockReleasePool: string
}

/** The proxy's immutables, set once in its constructor. */
export type USDCTokenPoolProxyStaticConfig = {
  /** USDC token. */
  token: string
  /** CCIP router whose ramps may call the proxy. */
  router: string
  /** CCTP verifier resolver required on `CCV` lanes. */
  cctpVerifier: string
}

/**
 * Inbound source-pool-data tags `getRequiredCCVs` accepts, from `USDCSourcePoolDataCodec`. Any
 * other tag, `CCTP_VERSION_2_TAG` included, reverts `InvalidMessageVersion`.
 */
export const INBOUND_MECHANISM_TAGS = {
  CCV: '0x3047587c',
  LOCK_RELEASE: '0xfa7c07de',
} as const satisfies Partial<Record<LockOrBurnMechanism, string>>

/** `USDCTokenPoolProxy` deploy artifact: contract name + ctor {@link Interface} + creation bytecode. */
export function getUSDCTokenPoolProxyArtifact(): DeployArtifact {
  return {
    contract: USDC_TOKEN_POOL_PROXY_TYPE,
    iface: USDC_TOKEN_POOL_PROXY_INTERFACE,
    // not exported as a constant: an exported `as const` literal is inlined into the `.d.ts`
    bytecode: USDC_TOKEN_POOL_PROXY_V2_0_0_BYTECODE,
  }
}

/**
 * Asserts `usdcTokenPoolProxy` is a deployed, supported `USDCTokenPoolProxy` by reading its
 * `typeAndVersion`.
 *
 * @remarks Run before every proxy read: a child pool or an unrelated contract can answer the same
 * getters with a different layout, which would decode as garbage or misattribute a revert. As in
 * `assertLockbox`, a `BAD_DATA` or `CALL_EXCEPTION` from the probe means there is no proxy at the
 * address; any other failure propagates untouched.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param usdcTokenPoolProxy - The caller-supplied proxy address, already validated as non-zero.
 * @param param - Param the address came from, for the error's `param` field.
 * @throws {@link CCTParamsInvalidError} if nothing at the address answers `typeAndVersion()`
 * @throws {@link CCTContractTypeInvalidError} if the contract is not a `USDCTokenPoolProxy`
 * @throws {@link CCTContractVersionUnsupportedError} if it reports a version other than 2.0.0
 */
export async function assertUSDCTokenPoolProxy(
  operation: string,
  chain: EVMChain,
  usdcTokenPoolProxy: string,
  param = 'usdcTokenPoolProxy',
): Promise<void> {
  let contractType: string, version: string
  try {
    ;[contractType, version] = await chain.typeAndVersion(usdcTokenPoolProxy)
  } catch (err) {
    if (!isMissingFunction(err)) throw err
    throw new CCTParamsInvalidError(
      operation,
      param,
      `nothing at ${usdcTokenPoolProxy} answers typeAndVersion(): it holds no contract code, holds code that is not a USDCTokenPoolProxy, or was deployed so recently that this RPC node has not caught up; check the address`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
  if (contractType !== USDC_TOKEN_POOL_PROXY_TYPE)
    throw new CCTContractTypeInvalidError(
      usdcTokenPoolProxy,
      USDC_TOKEN_POOL_PROXY_TYPE,
      contractType,
      'pass the proxy the TokenAdminRegistry returns as the USDC pool, not one of its child pools',
    )
  if (!USDC_TOKEN_POOL_PROXY_VERSIONS.includes(version))
    throw new CCTContractVersionUnsupportedError(USDC_TOKEN_POOL_PROXY_TYPE, version, {
      context: { address: usdcTokenPoolProxy },
    })
}

/** A `USDCTokenPoolProxy` handle typed for the reads below. */
type USDCTokenPoolProxyReader = Pick<
  TypedContract<typeof USDC_TOKEN_POOL_PROXY_V2_0_0_ABI>,
  | 'getStaticConfig'
  | 'getPools'
  | 'getFeeAggregator'
  | 'owner'
  | 'getLockOrBurnMechanism'
  | 'getRemotePools'
  | 'getRequiredCCVs'
>

/** Binds `usdcTokenPoolProxy` for the reads below. */
function getReader(chain: EVMChain, usdcTokenPoolProxy: string): USDCTokenPoolProxyReader {
  return getTypedContract(chain, usdcTokenPoolProxy, USDC_TOKEN_POOL_PROXY_V2_0_0_ABI)
}

/** Reads the proxy's `getStaticConfig()` in one `eth_call`, checksummed. */
export async function readUSDCTokenPoolProxyStaticConfig(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
): Promise<USDCTokenPoolProxyStaticConfig> {
  // Index the raw Result: resultToObject turns these named outputs into an object at runtime
  // while still typing them as a tuple.
  const config = await getReader(chain, usdcTokenPoolProxy).getStaticConfig()
  return {
    token: getAddress(resultToObject(config[0])),
    router: getAddress(resultToObject(config[1])),
    cctpVerifier: getAddress(resultToObject(config[2])),
  }
}

/** Reads the proxy's child pools in one `eth_call`, checksummed. */
export async function readUSDCTokenPoolProxyPools(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
): Promise<USDCTokenPoolProxyPools> {
  const pools = resultToObject(await getReader(chain, usdcTokenPoolProxy).getPools())
  return {
    cctpV1Pool: getAddress(pools.cctpV1Pool),
    cctpV2Pool: getAddress(pools.cctpV2Pool),
    cctpV2PoolWithCCV: getAddress(pools.cctpV2PoolWithCCV),
    siloedLockReleasePool: getAddress(pools.siloedLockReleasePool),
  }
}

/** Reads the proxy's fee aggregator in one `eth_call`, checksummed; zero when unset. */
export async function readUSDCTokenPoolProxyFeeAggregator(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
): Promise<string> {
  return getAddress(resultToObject(await getReader(chain, usdcTokenPoolProxy).getFeeAggregator()))
}

/**
 * Reads the proxy's `owner()` in one `eth_call`, checksummed.
 * @remarks Callers run {@link assertUSDCTokenPoolProxy} first: `owner()` is declared by pools too,
 * so it says nothing about whether the address is a proxy.
 */
export async function readUSDCTokenPoolProxyOwner(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
): Promise<string> {
  return getAddress(resultToObject(await getReader(chain, usdcTokenPoolProxy).owner()))
}

/**
 * Reads how the proxy routes `remoteChainSelector`. An unset lane reads as `INVALID_MECHANISM`;
 * the getter does not revert.
 * @throws {@link CCTDataDecodeError} if the ordinal is past the enum, which a 2.0.0 proxy cannot
 * return
 */
export async function readLockOrBurnMechanism(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
  remoteChainSelector: bigint,
): Promise<LockOrBurnMechanism> {
  const raw = await getReader(chain, usdcTokenPoolProxy).getLockOrBurnMechanism(remoteChainSelector)
  const mechanism = LOCK_OR_BURN_MECHANISMS[Number(raw)]
  if (mechanism === undefined)
    throw new CCTDataDecodeError(usdcTokenPoolProxy, { context: { mechanism: raw } })
  return mechanism
}

/**
 * Reads the remote pools of the child pool serving `remoteChainSelector`, as the raw `bytes` the
 * child stores; decoding needs the remote family, which the caller knows.
 */
export async function readUSDCTokenPoolProxyRemotePools(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
  remoteChainSelector: bigint,
): Promise<string[]> {
  const pools: readonly BytesLike[] = resultToObject(
    await getReader(chain, usdcTokenPoolProxy).getRemotePools(remoteChainSelector),
  )
  return pools.map((pool) => hexlify(pool))
}

/**
 * Reads the CCVs the proxy requires for a transfer on `remoteChainSelector`.
 * @remarks The proxy ignores the local-token, amount and finality arguments, so their neutral
 * values are supplied here, as `readRequiredCCVs` does for the hooks.
 * @param direction - `IPoolV2.MessageDirection` ordinal: `0n` outbound, `1n` inbound.
 * @param extraData - Source pool data; only its first 4 bytes (the tag) matter, and only inbound.
 * @returns Checksummed CCVs; `[ZeroAddress]` means the default CCVs.
 */
export async function readUSDCTokenPoolProxyRequiredCCVs(
  chain: EVMChain,
  usdcTokenPoolProxy: string,
  remoteChainSelector: bigint,
  direction: bigint,
  extraData: string,
): Promise<string[]> {
  const ccvs = resultToObject(
    await getReader(chain, usdcTokenPoolProxy).getRequiredCCVs(
      ZeroAddress,
      remoteChainSelector,
      0n,
      '0x00000000',
      extraData,
      direction,
    ),
  )
  return ccvs.map((ccv) => getAddress(ccv))
}
