/**
 * TokenPoolFactory (v2.0.0) contract layer: the cached {@link Interface} built from the vendored
 * `chainlink-ccip` ABI, the on-chain identity check ({@link assertTokenPoolFactory}), and the
 * internal static-config read ({@link readFactoryStaticConfig}) that address prediction needs.
 * Follows the same shape as the other CCT contract layers (`token-pool`, `token`, `lockbox`): one
 * module-level `Interface` over a vendored ABI, plus a `typeAndVersion` assert.
 *
 * @remarks The ABI is vendored from `@chainlink/contracts-ccip` into
 * `artifacts/abi/V2_0_0/token-pool-factory.ts` (see its `generate:` snippet) — the full published
 * contract ABI, not a hand-written fragment — so it stays in step with the contract exactly like
 * every other CCT ABI. `assertTokenPoolFactory` narrows an on-chain `typeAndVersion` read the same
 * way `token-pool`'s `resolveTokenPool` does.
 *
 * @packageDocumentation
 */

import { Contract, Interface, getAddress, isError } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../errors.ts'
import TOKEN_POOL_FACTORY_V2_0_0_ABI from '../artifacts/abi/V2_0_0/token-pool-factory.ts'

/** Contract type a `TokenPoolFactory` reports from `typeAndVersion`, e.g. `TokenPoolFactory 2.0.0`. */
export const FACTORY_TYPE = 'TokenPoolFactory'

/** The one `TokenPoolFactory` version this module supports. */
export const FACTORY_VERSION = '2.0.0'

/**
 * The factory's `PoolType` enum, `BURN_MINT = 0`, `LOCK_RELEASE = 1`. Keyed by the SDK's family
 * names so the local pool `type` maps through `getTokenPoolFamily`.
 */
export const FACTORY_POOL_TYPE = { BurnMint: 0, LockRelease: 1 } as const

/** Cached interface over the vendored `chainlink-ccip` ABI, built once — as `token-pool`/`token`/`lockbox` do. */
export const TOKEN_POOL_FACTORY_INTERFACE = new Interface(TOKEN_POOL_FACTORY_V2_0_0_ABI)

/**
 * True for the two failure shapes a call to a function a contract does not declare produces:
 * `CALL_EXCEPTION` (revert) and `BAD_DATA` (node answers `0x`, which is also what an EOA and an
 * undeployed address answer). Deliberately narrow — a transport error or rate limit must not be
 * read as "this contract lacks the function". Local copy; `cct-sdk` has no shared util yet.
 */
function isMissingFunction(err: unknown): boolean {
  return isError(err, 'CALL_EXCEPTION') || isError(err, 'BAD_DATA')
}

/**
 * Asserts `factory` is a deployed, supported `TokenPoolFactory` by reading its `typeAndVersion`.
 *
 * @remarks Every factory call targets a caller-supplied address, and the EVM answers a call to an
 * address with no code by succeeding and doing nothing. Without this read a factory typo, an EOA,
 * or an unrelated contract mines as a "successful" deployment that created nothing. One `eth_call`
 * turns those into a typed error before any calldata is built, the way `token-pool`'s
 * `resolveTokenPool` narrows the same on-chain `typeAndVersion` read.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param factory - The caller-supplied factory address.
 * @throws {@link CCTParamsInvalidError} if nothing at `factory` answers `typeAndVersion()`
 * @throws {@link CCTContractTypeInvalidError} if it is some other contract
 * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
 * @throws `CCIPTypeVersionInvalidError` if it answers with an unparseable `type version` string
 */
export async function assertTokenPoolFactory(
  operation: string,
  chain: EVMChain,
  factory: string,
): Promise<void> {
  let contractType: string, version: string
  try {
    ;[contractType, version] = await chain.typeAndVersion(factory)
  } catch (err) {
    if (!isMissingFunction(err)) throw err
    throw new CCTParamsInvalidError(
      operation,
      'factory',
      `nothing at ${factory} answers typeAndVersion() — it holds no contract code, holds code that is not a TokenPoolFactory, or was deployed so recently that this RPC node has not caught up; check the address`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
  if (contractType !== FACTORY_TYPE)
    throw new CCTContractTypeInvalidError(factory, FACTORY_TYPE, contractType)
  if (version !== FACTORY_VERSION)
    throw new CCTContractVersionUnsupportedError(FACTORY_TYPE, version, {
      context: { address: factory },
    })
}

/** The factory's immutable CCIP wiring, from {@link readFactoryStaticConfig}. */
export type FactoryStaticConfig = {
  /** RMNProxy every pool this factory deploys is constructed with. */
  rmnProxy: string
  /** TokenAdminRegistry the factory registers deployed pools in. */
  tokenAdminRegistry: string
  /** RegistryModuleOwnerCustom used for owner-based token-admin registration. */
  registryModuleOwnerCustom: string
  /** CCIP Router every pool this factory deploys is constructed with. */
  ccipRouter: string
}

/**
 * Reads the factory's `getStaticConfig()` in one `eth_call`, checksummed. Internal: address
 * prediction needs `rmnProxy`/`ccipRouter` because the factory builds the pool's constructor args
 * from them, so a pool's deterministic address cannot be computed without them. Not exposed on the
 * public manager surface.
 * @param chain - Chain to read from.
 * @param factory - `TokenPoolFactory` to read.
 */
export async function readFactoryStaticConfig(
  chain: EVMChain,
  factory: string,
): Promise<FactoryStaticConfig> {
  const contract = new Contract(factory, TOKEN_POOL_FACTORY_INTERFACE, chain.provider)
  // The Result is array-iterable; positional to avoid depending on named-key decoding.
  const [rmnProxy, tokenAdminRegistry, registryModuleOwnerCustom, ccipRouter] = (await contract
    .getFunction('getStaticConfig')
    .staticCall()) as [string, string, string, string]
  return {
    rmnProxy: getAddress(rmnProxy),
    tokenAdminRegistry: getAddress(tokenAdminRegistry),
    registryModuleOwnerCustom: getAddress(registryModuleOwnerCustom),
    ccipRouter: getAddress(ccipRouter),
  }
}
