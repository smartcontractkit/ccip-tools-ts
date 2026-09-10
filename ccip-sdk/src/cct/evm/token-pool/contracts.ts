/**
 * EVM token-pool contract layer for CCT: cached {@link Interface}s + on-chain type/version
 * resolution ({@link resolveTokenPool}, {@link getTokenPoolInterface}, floor-matched via
 * {@link resolveEncoder}) for read/write ops, plus the deployable pools' creation artifacts
 * ({@link getTokenPoolArtifact}), the narrow role reads every owner-gated write pre-flights
 * `sender` against ({@link readTokenPoolOwner}, {@link readTokenPoolRateLimitAdmin}), the allowlist read
 * `applyAllowlistUpdates` pre-flights against ({@link readTokenPoolAllowlist}) plus the
 * owner-only guard built on the first of them ({@link assertPoolOwner}), and the LockRelease
 * liquidity layer: the rebalancer and liquidity reads plus the guards the liquidity ops pre-flight
 * with ({@link assertLockReleasePool}, {@link assertPoolRebalancer},
 * {@link assertLiquidityFunding}, {@link assertPoolLiquidity}). The write-side rate-limit shape
 * lane-config ops share lives in `rate-limit.ts`. Mirrors `token/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface, ZeroAddress, getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../errors.ts'
import BURN_MINT_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/burn-mint-token-pool-and-proxy.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_0_ABI from '../artifacts/abi/V1_5_0/lock-release-token-pool-and-proxy.ts'
import BURN_MINT_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/burn-mint-token-pool.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI from '../artifacts/abi/V1_5_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI from '../artifacts/abi/V1_6_1/lock-release-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/burn-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI from '../artifacts/abi/V2_0_0/lock-release-token-pool.ts'
import BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-from-mint-token-pool.ts'
import BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/burn-with-from-mint-token-pool.ts'
import LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract } from '../query.ts'

/**
 * ABI families for pool resolution. The burn-* variants are interface-compatible for CCT
 * ops (identical constructor + `transferOwnership`, shared TokenPool surface), so they share
 * the `BurnMint` ABI; `LockRelease` (with its liquidity functions) is distinct.
 */
export const TOKEN_POOL_FAMILIES = ['BurnMint', 'LockRelease'] as const

/** An ABI family for pool resolution. */
export type TokenPoolFamily = (typeof TOKEN_POOL_FAMILIES)[number]

/**
 * Supported on-chain `typeAndVersion` pool types. The burn-* variants are interface-compatible
 * for CCT ops and share the `BurnMint` ABI (see {@link getTokenPoolFamily}); `LockReleaseTokenPool`
 * is distinct. Unsupported values fail in {@link parseTokenPoolVersion}, which also normalizes
 * v1.5.0's `*AndProxy` shims onto these base names.
 */
export const TOKEN_POOL_TYPES = [
  'BurnMintTokenPool',
  'BurnFromMintTokenPool',
  'BurnWithFromMintTokenPool',
  'BurnToAddressTokenPool',
  'BurnMintWithLockReleaseFlagTokenPool',
  'LockReleaseTokenPool',
  'SiloedLockReleaseTokenPool',
] as const

/** A supported EVM token-pool contract type. */
export type TokenPoolType = (typeof TOKEN_POOL_TYPES)[number]

/** The burn-* mint pool types, which share the `BurnMint` ABI. */
export type BurnMintTokenPoolType = Extract<TokenPoolType, `Burn${string}`>

/** The lock/release pool types, which share the `LockRelease` ABI. */
export type LockReleaseTokenPoolType = Exclude<TokenPoolType, BurnMintTokenPoolType>

/** Type guard for {@link TOKEN_POOL_TYPES}. */
export function isTokenPoolType(v: string): v is TokenPoolType {
  return (TOKEN_POOL_TYPES as readonly string[]).includes(v)
}

/**
 * Classifies a supported pool type into its ABI {@link TokenPoolFamily} by name: every burn-* pool
 * shares the `BurnMint` ABI (hence the anchored `^Burn`, which also covers
 * `BurnMintWithLockReleaseFlagTokenPool`), and the rest share `LockRelease`.
 * {@link TOKEN_POOL_TYPES} is the gate, so only allowlisted, ABI-compatible names reach here.
 */
export function getTokenPoolFamily(type: TokenPoolType): TokenPoolFamily {
  return /^Burn/.test(type) ? 'BurnMint' : 'LockRelease'
}

/** Narrows a pool type to the {@link LockReleaseTokenPoolType}s, per {@link getTokenPoolFamily}. */
export function isLockReleaseTokenPoolType(type: TokenPoolType): type is LockReleaseTokenPoolType {
  return getTokenPoolFamily(type) === 'LockRelease'
}

/** Known pool versions, low to high. Value order drives floor-match in {@link resolveEncoder}. */
export const TokenPoolVersion = {
  V1_5_0: '1.5.0',
  V1_5_1: '1.5.1',
  V1_6_1: '1.6.1',
  V2_0_0: '2.0.0',
} as const

/** A known EVM token-pool version. */
export type TokenPoolVersion = (typeof TokenPoolVersion)[keyof typeof TokenPoolVersion]

/** Type guard for {@link TokenPoolVersion}. */
export function isTokenPoolVersion(v: string): v is TokenPoolVersion {
  return Object.values(TokenPoolVersion).some((known) => known === v)
}

/**
 * Narrows raw `typeAndVersion` strings to a known {@link TokenPoolType} and
 * {@link TokenPoolVersion}. A v1.5.0 `*AndProxy` type normalizes to its base pool type.
 * @throws {@link CCTContractTypeInvalidError} if `contractType` is not a supported pool type
 * @throws {@link CCTContractVersionUnsupportedError} if `version` is not a known pool version
 */
export function parseTokenPoolVersion({
  address,
  contractType,
  version,
}: {
  address: string
  contractType: string
  version: string
}): { type: TokenPoolType; version: TokenPoolVersion } {
  // v1.5.0's `*AndProxy` shims override only lockOrBurn/releaseOrMint, so every function a CCT op
  // encodes is the base pool's — and the vendored v1.5.0 ABIs are the `*_and_proxy` ones already.
  const type =
    version === TokenPoolVersion.V1_5_0 ? contractType.replace(/AndProxy$/, '') : contractType
  if (!isTokenPoolType(type))
    throw new CCTContractTypeInvalidError(address, TOKEN_POOL_TYPES.join(', '), contractType)
  if (!isTokenPoolVersion(version))
    throw new CCTContractVersionUnsupportedError(contractType, version, {
      context: { address },
    })

  return { type, version }
}

/**
 * Resolves an on-chain pool's type + version from its `typeAndVersion`, narrowed to a known
 * {@link TokenPoolType} and {@link TokenPoolVersion}.
 * @throws {@link CCTContractTypeInvalidError} if the reported type is not a supported pool type
 * @throws {@link CCTContractVersionUnsupportedError} if the reported version is not a known pool version
 */
export async function resolveTokenPool(
  chain: EVMChain,
  address: string,
): Promise<{ type: TokenPoolType; version: TokenPoolVersion }> {
  const [contractType, version] = await chain.typeAndVersion(address)
  return parseTokenPoolVersion({ address, contractType, version })
}

/** `Ownable2Step.owner()`, identical across all supported pool types and versions. */
type PoolOwnerGetter = Pick<TypedContract<typeof BURN_MINT_TOKEN_POOL_V1_5_0_ABI>, 'owner'>

/**
 * Pre-flights `sender` against the pool's on-chain `owner()` for an owner-gated write, so an
 * unauthorized caller fails as a {@link CCTParamsInvalidError} here instead of as an opaque
 * `OwnableUnauthorizedAccount` revert after a multisig has already reviewed and signed.
 *
 * @remarks A single `owner()` call, not the full `getTokenPoolState` query: `owner` is the only
 * field this needs and the only one whose getter never changed spelling, so reading it directly
 * costs one `eth_call` instead of a second `typeAndVersion` resolution plus every admin field.
 * @remarks For an owner-*only* gate. Not for a gate that accepts more than the owner —
 * `setChainRateLimiterConfigs` takes `owner` **or** `rateLimitAdmin`, and collapsing that
 * disjunction to this helper would lock out a delegated rate-limit admin.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the owner from.
 * @param poolAddress - Token pool being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the pool owner
 */
export async function assertPoolOwner(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  sender: string,
): Promise<void> {
  const owner = await readTokenPoolOwner(chain, poolAddress)
  if (getAddress(sender) === owner) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    `must be the current token pool owner (${owner})`,
  )
}

/**
 * Guards a LockRelease-only op: the liquidity and rebalancer functions are absent from the
 * `BurnMint` ABI, so without this the op would hand that {@link Interface} an unknown function
 * name and fail as an opaque ethers error instead of naming the real problem.
 * @param operation - Operation name, for the error's context.
 * @param poolAddress - Token pool being acted on.
 * @param type - Pool type, as resolved by {@link resolveTokenPool}.
 * @throws {@link CCTContractTypeInvalidError} if `type` is not a {@link LockReleaseTokenPoolType}
 */
export function assertLockReleasePool(
  operation: string,
  poolAddress: string,
  type: TokenPoolType,
): void {
  if (isLockReleaseTokenPoolType(type)) return
  throw new CCTContractTypeInvalidError(
    poolAddress,
    'LockRelease token pool',
    type,
    `${operation} is a lock/release liquidity function, which the BurnMint pools do not declare`,
    { context: { operation } },
  )
}

/**
 * Cached pool {@link Interface}s per {@link TokenPoolFamily} and {@link TokenPoolVersion},
 * built once from the vendored `artifacts/` ABIs (no per-call `new Interface`). `V1_5_0`
 * uses the `*_and_proxy` variants — the only form `@chainlink/contracts-ccip` ships at 1.5.0.
 */
export const TOKEN_POOL_INTERFACES: Record<TokenPoolFamily, Record<TokenPoolVersion, Interface>> = {
  BurnMint: {
    [TokenPoolVersion.V1_5_0]: new Interface(BURN_MINT_TOKEN_POOL_V1_5_0_ABI),
    [TokenPoolVersion.V1_5_1]: new Interface(BURN_MINT_TOKEN_POOL_V1_5_1_ABI),
    [TokenPoolVersion.V1_6_1]: new Interface(BURN_MINT_TOKEN_POOL_V1_6_1_ABI),
    [TokenPoolVersion.V2_0_0]: new Interface(BURN_MINT_TOKEN_POOL_V2_0_0_ABI),
  },
  LockRelease: {
    [TokenPoolVersion.V1_5_0]: new Interface(LOCK_RELEASE_TOKEN_POOL_V1_5_0_ABI),
    [TokenPoolVersion.V1_5_1]: new Interface(LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI),
    [TokenPoolVersion.V1_6_1]: new Interface(LOCK_RELEASE_TOKEN_POOL_V1_6_1_ABI),
    [TokenPoolVersion.V2_0_0]: new Interface(LOCK_RELEASE_TOKEN_POOL_V2_0_0_ABI),
  },
}

/**
 * Returns the cached pool {@link Interface} for `type` and `version`, selected by the
 * type's {@link TokenPoolFamily}. Never throws when both came from
 * {@link parseTokenPoolVersion}.
 */
export function getTokenPoolInterface(type: TokenPoolType, version: TokenPoolVersion): Interface {
  return TOKEN_POOL_INTERFACES[getTokenPoolFamily(type)][version]
}

/**
 * Reads a token pool's Ownable2Step `owner()` in a single `eth_call`. The one owner read every
 * owner-gated pool write op pre-flights `sender` against.
 *
 * @remarks No `version` parameter and no family dispatch: `owner()` is declared identically —
 * same selector, same `address` return — by both {@link TOKEN_POOL_FAMILIES} at all four
 * supported versions, so the v1.5.0 `BurnMint` interface types the call for every pool.
 * @remarks **Deliberately not routed through the `getTokenPoolState` query op, and must not be
 * "simplified" back to it.** That query costs 6–8 `eth_call`s (token, router, RMN proxy,
 * rate-limit admin, supported chains, dynamic config, finality config, lockbox) plus a
 * `getTokenInfo` round trip, and re-resolves `typeAndVersion`, all to obtain one address that
 * this one call returns — on every owner-gated write op, at every version.
 *
 * This mirrors `token-admin-registry/operations/transfer-admin.ts`, which likewise does its own
 * narrow pre-tx read rather than going through a read op.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool contract to read `owner()` from.
 * @returns The current owner, checksummed.
 */
export async function readTokenPoolOwner(chain: EVMChain, poolAddress: string): Promise<string> {
  const pool: PoolOwnerGetter = getTypedContract(
    chain,
    poolAddress,
    BURN_MINT_TOKEN_POOL_V1_5_0_ABI,
  )
  return getAddress(resultToObject(await pool.owner()))
}

/**
 * `TokenPool`'s allowlist getters, identical across v1.5.0–v1.6.1 and both ABI families. Absent
 * from v2.0.0, which dropped the allowlist — callers must resolve the version first.
 */
type PoolAllowlistGetter = Pick<
  TypedContract<typeof BURN_MINT_TOKEN_POOL_V1_5_0_ABI>,
  'getAllowListEnabled' | 'getAllowList'
>

/**
 * Reads a token pool's sender allowlist and whether the feature is enabled at all, in two
 * parallel `eth_call`s.
 *
 * @remarks Same rationale as {@link readTokenPoolOwner} for not routing through
 * `getTokenPoolState`, which does not expose the allowlist.
 * @remarks `enabled` is fixed for the pool's lifetime: the contract sets `i_allowlistEnabled`
 * *immutable* in its constructor, to `allowlist.length > 0`. A pool deployed without an
 * allowlist can therefore never gain one, and every `applyAllowListUpdates` against it reverts
 * `AllowListNotEnabled`.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool contract to read from; must be v1.5.0–v1.6.1.
 * @returns `enabled`, and the current entries checksummed (empty when disabled).
 */
export async function readTokenPoolAllowlist(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ enabled: boolean; entries: string[] }> {
  const pool: PoolAllowlistGetter = getTypedContract(
    chain,
    poolAddress,
    BURN_MINT_TOKEN_POOL_V1_5_0_ABI,
  )
  const [enabled, entries] = await Promise.all([pool.getAllowListEnabled(), pool.getAllowList()])
  return {
    enabled: resultToObject(enabled),
    entries: resultToObject(entries).map((entry) => getAddress(entry)),
  }
}

/**
 * Reads a token pool's `rateLimitAdmin` — the delegated role the pools accept for rate-limit
 * writes alongside the owner — in a single `eth_call`.
 *
 * @remarks Same rationale as {@link readTokenPoolOwner} for not routing through
 * `getTokenPoolState`.
 * @remarks Version-dispatched, unlike `owner()`: v1.5.0–v1.6.1 expose a standalone
 * `getRateLimitAdmin()`, while v2.0.0 folded the role into `getDynamicConfig()`'s
 * `(router, rateLimitAdmin, feeAdmin)` triple.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool contract to read from.
 * @param version - Pool version, as resolved by {@link resolveTokenPool}; selects the getter.
 * @returns The current rate-limit admin, checksummed. The zero address when the role is unset —
 * callers must treat that as "matches nobody" rather than comparing it directly.
 */
export async function readTokenPoolRateLimitAdmin(
  chain: EVMChain,
  poolAddress: string,
  version: TokenPoolVersion,
): Promise<string> {
  if (version === TokenPoolVersion.V2_0_0) {
    const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V2_0_0_ABI)
    // getDynamicConfig returns (router, rateLimitAdmin, feeAdmin); index the raw Result rather
    // than resultToObject it, which would turn the named tuple into an object (see
    // get-token-pool-state.ts).
    const dynamicConfig = await pool.getDynamicConfig()
    return getAddress(dynamicConfig[1] as string)
  }
  const pool = getTypedContract(chain, poolAddress, BURN_MINT_TOKEN_POOL_V1_5_1_ABI)
  return getAddress(resultToObject(await pool.getRateLimitAdmin()))
}

/**
 * Reads a LockRelease pool's `rebalancer` — the single account the pool accepts
 * `provideLiquidity` / `withdrawLiquidity` from — in one `eth_call`.
 *
 * @remarks No dispatch, but callers must resolve the pool first
 * ({@link assertLockReleasePool}, plus a v2.0.0 check): `getRebalancer()` is declared identically
 * at v1.5.0–v1.6.1 by both LockRelease types, and is absent from a `BurnMint` pool and from
 * v2.0.0, so those cases should report the type or version rather than a bare call failure.
 * @remarks On a `SiloedLockReleaseTokenPool` this is the *unsiloed* rebalancer, which is what its
 * plain liquidity entry points gate on; the per-lane `getChainRebalancer(uint64)` governs the
 * siloed ones, which this SDK does not expose.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool to read `getRebalancer()` from.
 * @returns The current rebalancer, checksummed; the zero address when none is configured, which
 * means the pool accepts liquidity calls from nobody.
 */
export async function readTokenPoolRebalancer(
  chain: EVMChain,
  poolAddress: string,
): Promise<string> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI)
  return getAddress(resultToObject(await pool.getRebalancer()))
}

/**
 * Pre-flights `sender` against the pool's on-chain `getRebalancer()` for a liquidity write, the
 * rebalancer-gated counterpart of {@link assertPoolOwner}.
 *
 * @remarks Deliberately *not* the owner: `provideLiquidity` and `withdrawLiquidity` compare
 * `msg.sender` to `s_rebalancer` and revert `Unauthorized` for everyone else, the owner included.
 * The owner's role is to appoint the rebalancer, not to move liquidity itself.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the rebalancer from.
 * @param poolAddress - Token pool being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the pool's rebalancer, or no
 * rebalancer is configured
 */
export async function assertPoolRebalancer(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  sender: string,
): Promise<void> {
  const rebalancer = await readTokenPoolRebalancer(chain, poolAddress)
  if (rebalancer !== ZeroAddress && getAddress(sender) === rebalancer) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    rebalancer === ZeroAddress
      ? `no rebalancer is configured on ${poolAddress}, so it accepts liquidity calls from nobody; the pool owner must appoint one with setRebalancer`
      : `must be the current pool rebalancer (${rebalancer})`,
  )
}

/**
 * Reads a v1.5.0 / v1.5.1 LockRelease pool's `canAcceptLiquidity()` in one `eth_call`.
 *
 * @remarks Only declared at v1.5.0 and v1.5.1, where the constructor fixes `i_acceptLiquidity`
 * *immutable*: a pool deployed with it `false` rejects every deposit with `LiquidityNotAccepted`
 * for its whole lifetime, which is why that is worth one call to catch before signing. v1.6.1
 * dropped the flag and always accepts, so callers must not reach here for it. Same shape as
 * {@link readTokenPoolAllowlist}'s `enabled`.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool to read from; must be v1.5.0 or v1.5.1.
 * @returns Whether the pool accepts liquidity deposits at all.
 */
export async function readTokenPoolAcceptsLiquidity(
  chain: EVMChain,
  poolAddress: string,
): Promise<boolean> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI)
  return resultToObject(await pool.canAcceptLiquidity())
}

/**
 * The token a pool escrows, plus a handle to it, in one `eth_call`. `getToken()` is declared
 * identically by every pool type and version, so this needs no dispatch.
 * @param chain - Chain to read from.
 * @param poolAddress - Token pool to read `getToken()` from.
 * @returns The escrowed token, checksummed, and an ERC-20 contract bound to it.
 */
export async function readTokenPoolToken(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ token: string; erc20: TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI> }> {
  const pool = getTypedContract(chain, poolAddress, LOCK_RELEASE_TOKEN_POOL_V1_5_1_ABI)
  const token = getAddress(resultToObject(await pool.getToken()))
  return { token, erc20: getTypedContract(chain, token, FACTORY_BURN_MINT_ERC20_V1_5_1_ABI) }
}

/**
 * Pre-flights a `provideLiquidity` deposit against the rebalancer's ERC-20 position: it must hold
 * `amount` of the pool's token *and* have approved the pool to pull it, since the pool deposits
 * with `safeTransferFrom`.
 *
 * @remarks Cross-family parity with Solana, whose `provideLiquidity` likewise refuses to build
 * without the SPL delegation (`validateDelegation`) and the balance behind it. Without this the
 * only signal is an `ERC20InsufficientAllowance` revert at wallet-confirmation time, naming
 * neither the token to approve nor the pool to approve it to. The error names `approveToken`,
 * which grants exactly this allowance.
 * @remarks Advisory: an allowance can be spent or revoked between building and signing. It moves
 * only on an explicit `approve` though, so unlike a pool balance it is stable enough to be worth
 * the round trip.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool being deposited into.
 * @param account - The depositing rebalancer.
 * @param amount - Deposit amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if `account` holds less than `amount`, or has approved the
 * pool for less than `amount`
 */
export async function assertLiquidityFunding(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  account: string,
  amount: bigint,
): Promise<void> {
  const { token, erc20 } = await readTokenPoolToken(chain, poolAddress)
  const [balance, allowance] = await Promise.all([
    erc20.balanceOf(account),
    erc20.allowance(account, poolAddress),
  ])
  if (balance < amount)
    throw new CCTTxFailedError(
      operation,
      `${account} holds ${balance} of ${token}, but ${amount} is required; mint or transfer tokens first`,
    )
  if (allowance < amount)
    throw new CCTTxFailedError(
      operation,
      `${account} has approved ${allowance} of ${token} to pool ${poolAddress}, but ${amount} is required; the deposit is a transferFrom, so grant the allowance first with approveToken({ tokenAddress: '${token}', spender: '${poolAddress}', amount: ${amount}n })`,
    )
}

/**
 * Pre-flights a withdrawal against the pool's own ERC-20 balance, which is what it pays out of.
 *
 * @remarks Weaker than {@link assertLiquidityFunding}: a pool's balance moves with every CCIP
 * transfer through it, so this catches "withdraw more than was ever provided" rather than proving
 * the amount will still fit when the tx mines.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool being withdrawn from.
 * @param amount - Withdrawal amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if the pool's balance is below `amount`
 */
export async function assertPoolLiquidity(
  operation: string,
  chain: EVMChain,
  poolAddress: string,
  amount: bigint,
): Promise<void> {
  const { token, liquidity } = await readTokenPoolLiquidity(chain, poolAddress)
  if (liquidity >= amount) return
  throw new CCTTxFailedError(
    operation,
    `pool ${poolAddress} holds ${liquidity} of ${token}, but ${amount} is required; it would revert InsufficientLiquidity`,
  )
}

/**
 * A pool's liquidity and the token it is denominated in, from one pair of calls.
 *
 * @remarks Returns the token as well so `transferLiquidity`, which checks both pools escrow the
 * same one, needs no second read.
 * @param chain - Chain to read from.
 * @param poolAddress - LockRelease pool to read.
 * @returns The escrowed token, checksummed, and the pool's balance of it.
 */
export async function readTokenPoolLiquidity(
  chain: EVMChain,
  poolAddress: string,
): Promise<{ token: string; liquidity: bigint }> {
  const { token, erc20 } = await readTokenPoolToken(chain, poolAddress)
  return { token, liquidity: await erc20.balanceOf(poolAddress) }
}

/**
 * Creation bytecode per deployable pool type (2.0.0 only — pre-2.0.0 bytecode is not vendored).
 * The keys define the deployable set ({@link DeployableTokenPoolType}). The burn-* variants share
 * the `BurnMint` constructor ABI but are distinct contracts with distinct bytecode.
 */
const TOKEN_POOL_BYTECODE = {
  BurnMintTokenPool: BURN_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  BurnFromMintTokenPool: BURN_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  BurnWithFromMintTokenPool: BURN_WITH_FROM_MINT_TOKEN_POOL_V2_0_0_BYTECODE,
  LockReleaseTokenPool: LOCK_RELEASE_TOKEN_POOL_V2_0_0_BYTECODE,
} satisfies Partial<Record<TokenPoolType, `0x${string}`>>

/** A pool contract type that can be deployed (has vendored 2.0.0 creation bytecode). */
export type DeployableTokenPoolType = keyof typeof TOKEN_POOL_BYTECODE

/** Type guard for {@link DeployableTokenPoolType} (has vendored 2.0.0 creation bytecode). */
export function isDeployableTokenPoolType(type: string): type is DeployableTokenPoolType {
  return Object.hasOwn(TOKEN_POOL_BYTECODE, type)
}

/**
 * Deploy artifact for a deployable pool `type` (v2.0.0): contract name (= `type`), the cached
 * constructor {@link Interface}, and the creation bytecode.
 */
export function getTokenPoolArtifact(type: DeployableTokenPoolType): DeployArtifact {
  return {
    contract: type,
    iface: getTokenPoolInterface(type, TokenPoolVersion.V2_0_0),
    bytecode: TOKEN_POOL_BYTECODE[type],
  }
}

/**
 * Returns the encoder registered at the greatest version less than or equal to `version`,
 * walking {@link TokenPoolVersion} downwards from `version`.
 *
 * A table entry says one of two things:
 * - **absent key** — the calldata did not change here, so it *inherits* the closest lower entry.
 *   One entry per calldata change therefore covers every higher version.
 * - **explicit `null`** — the function was removed at this version, so the op is reported
 *   unsupported rather than emitting calldata for a selector the pool does not implement.
 *
 * @param encoders - Sparse table keyed by {@link TokenPoolVersion}; `null` marks a removal ceiling.
 * @param version - The resolved on-chain pool version to encode for.
 * @param op - Operation name, for the error.
 * @throws {@link CCTOperationUnsupportedError} if nothing is registered at or below `version`, or
 * if the walk hits an explicit `null` ceiling first
 */
export function resolveEncoder<F>(
  encoders: Partial<Record<TokenPoolVersion, F | null>>,
  version: TokenPoolVersion,
  op: string,
): F {
  const versions = Object.values(TokenPoolVersion)
  for (let i = versions.indexOf(version); i >= 0; i--) {
    const encoder = encoders[versions[i]!]
    // removed here — do not inherit the lower encoder downward
    if (encoder === null) break
    if (encoder !== undefined) return encoder
  }
  throw new CCTOperationUnsupportedError(op, version)
}
