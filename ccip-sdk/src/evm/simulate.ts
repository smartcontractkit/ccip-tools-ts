/**
 * Pool-direct destination preflight simulations.
 *
 * The OffRamp's `execute()` is proof-gated (merkle root on v1.x, CCV attestations on v2.0), so a
 * full destination execution cannot be simulated before a message is sent. The release/mint leg
 * can be: the token pool only gates `releaseOrMint` on `msg.sender` being a registered
 * OffRamp for the source chain (`_onlyOffRamp`), which an `eth_call` satisfies with a spoofed
 * `from`. Every `Pool.ReleaseOrMintInV1` field is constructible pre-send.
 *
 * Both simulations mirror the OffRamp's own ERC165 dispatch: probe the pool's
 * `supportsInterface(IPoolV2)` for the 2-arg (finality-aware) variant, falling back to
 * `CCIP_POOL_V1` for the 1-arg variant, following the pool's own ERC165 answer the same way
 * `OffRamp._releaseOrMintSingleToken` does.
 */
import { type BytesLike, type JsonRpcApiProvider, hexlify, toBeHex, zeroPadValue } from 'ethers'

import { interfaces } from './const.ts'
import { parseWithFragment } from './errors.ts'
import { CCIPContractTypeInvalidError } from '../errors/index.ts'
import { type FinalityRequested, encodeFinality } from '../extra-args.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'

/**
 * ERC165 interface id of `IPoolV2` (v2.0 pools, 2-arg `releaseOrMint`/`lockOrBurn`).
 * Matches `type(IPoolV2).interfaceId` in chainlink-ccip.
 */
export const IPOOL_V2_INTERFACE_ID = '0x940a1542'
/**
 * ERC165 interface id of v1 pools: `Pool.CCIP_POOL_V1 = bytes4(keccak256("CCIP_POOL_V1"))`
 * (1-arg `releaseOrMint`/`lockOrBurn`; v1.5.0 through v1.6.x, incl. the oUSDT pools).
 */
export const CCIP_POOL_V1_INTERFACE_ID = '0xaff2afbf'

/** Which pool release interface the simulation dispatched to (mirroring the OffRamp). */
export type PoolInterfaceVersion = 'IPoolV2' | 'IPoolV1'

// Destination `releaseOrMint` revert names that typically clear on their own — a liquidity
// shortfall is topped up, a rate limit refills, an RMN curse is lifted. Used ONLY to flag the
// generic dest-execution error as transient (retryable); it never selects an error type or the
// block decision. Names are matched against the shared SDK ABI bundle, so every entry is a
// standard chainlink-ccip pool / RateLimiter error. External errors not in the bundle (oUSDT
// lockbox, xERC20 bridge limits) read as non-transient — the caller can parse `context.revert`
// (the raw encoded revert) with `EVMChain.parse` to refine.
const TRANSIENT_REVERT_NAMES = new Set([
  'InsufficientLiquidity',
  'InsufficientBalance',
  'ERC20InsufficientBalance',
  'TokenMaxCapacityExceeded',
  'TokenRateLimitReached',
  'CursedByRMN',
])

/**
 * Whether a destination `releaseOrMint` revert is one that typically clears on its own, so a later
 * retry may succeed. Decodes the selector against the shared SDK ABI bundle (the standard parse)
 * and checks it against {@link TRANSIENT_REVERT_NAMES}; anything unrecognized reads as
 * non-transient. This only sets the `isTransient` flag on the raised error — a revert always
 * blocks the send regardless.
 *
 * @param data - raw revert data (`0x`-prefixed) from the failed `eth_call`
 */
export function isTransientReleaseOrMintRevert(data: BytesLike): boolean {
  const hex = hexlify(getDataBytes(data))
  if (hex.length < 10) return false
  const parsed = parseWithFragment(hex.slice(0, 10))
  return parsed != null && TRANSIENT_REVERT_NAMES.has(parsed[0].name)
}

/**
 * Best-effort human name for an unclassified revert, used as the detail of the generic
 * {@link CCIPDestExecutionRevertError} (the decoded error name, or the raw selector when unknown).
 * @param data - raw revert data from the failed `eth_call`
 * @returns decoded `Name(args)` when a known ABI matches, else the raw selector
 */
export function describeRevert(data: BytesLike | undefined): string {
  if (!data) return 'revert without data'
  const hex = hexlify(getDataBytes(data))
  if (hex.length < 10) return hex
  const known = parseWithFragment(hex.slice(0, 10), '0x' + hex.slice(10))
  if (known) return `${known[0].name} (${hex})`
  return hex
}

/** `Pool.ReleaseOrMintInV1` — ABI-compatible from v1.5.0 through v2.0 (only `amount` was renamed to `sourceDenominatedAmount`). */
export type ReleaseOrMintSimInput = {
  /** Original sender on the source chain (address or raw bytes; may be empty). */
  originalSender?: BytesLike
  /** Source chain selector. */
  remoteChainSelector: bigint
  /** Token recipient on this (destination) chain. */
  receiver: string
  /** Amount, denominated in the decimals declared by `sourcePoolData` (see below). */
  sourceDenominatedAmount: bigint
  /** Token address on this (destination) chain. */
  localToken: string
  /**
   * Source pool address as raw bytes (abi-encoded address for EVM sources). Must match a remote
   * pool configured on the destination pool, else the pool reverts `InvalidSourcePoolAddress`.
   */
  sourcePoolAddress: BytesLike
  /**
   * The source pool's `lockOrBurn` return (`destPoolData`). Every base-`TokenPool` pool returns
   * `abi.encode(uint256(sourceDecimals))`; the destination pool falls back to its own decimals
   * when empty. Default `0x` — correct whenever `sourceDenominatedAmount` is already expressed in
   * the destination token's decimals (or decimals match). For source pools returning other data, obtain the
   * exact value with {@link simulateLockOrBurn}.
   */
  sourcePoolData?: BytesLike
  /** Offchain data (USDC-CCTP attestations etc.); `''` for all pool-liquidity cases. */
  offchainTokenData?: BytesLike
}

/** Options for {@link simulateReleaseOrMint}. */
export type SimulateReleaseOrMintOpts = {
  /** Destination chain provider. */
  provider: JsonRpcApiProvider
  /** Destination token pool address. */
  pool: string
  /**
   * A registered OffRamp (for the message's source chain) on the destination Router,
   * used as the `eth_call` `from`, satisfying the pool's `_onlyOffRamp` gate.
   */
  offRamp: string
  /** The `ReleaseOrMintInV1` input to simulate. */
  input: ReleaseOrMintSimInput
  /** Requested finality (v2/IPoolV2 pools only; encoded as the 2nd `releaseOrMint` arg). */
  finality?: FinalityRequested
}

async function probeSupportsInterface(
  provider: JsonRpcApiProvider,
  pool: string,
  interfaceId: string,
): Promise<boolean> {
  try {
    const result = await provider.call({
      to: pool,
      data: interfaces.TokenPool_v2_0.encodeFunctionData('supportsInterface', [interfaceId]),
    })
    return !!interfaces.TokenPool_v2_0.decodeFunctionResult('supportsInterface', result)[0]
  } catch {
    return false // non-ERC165 contract
  }
}

function encodeReleaseOrMintIn(input: ReleaseOrMintSimInput) {
  const senderBytes = getAddressBytes(input.originalSender ?? '0x')
  return {
    originalSender:
      senderBytes.length > 0 && senderBytes.length < 32
        ? zeroPadValue(senderBytes, 32)
        : hexlify(senderBytes),
    remoteChainSelector: input.remoteChainSelector,
    receiver: input.receiver,
    sourceDenominatedAmount: input.sourceDenominatedAmount,
    localToken: input.localToken,
    sourcePoolAddress: hexlify(getDataBytes(input.sourcePoolAddress)),
    sourcePoolData: hexlify(getDataBytes(input.sourcePoolData ?? '0x')),
    offchainTokenData: hexlify(getDataBytes(input.offchainTokenData ?? '0x')),
  }
}

/**
 * Simulate the destination pool's `releaseOrMint` via a pool-direct `eth_call` with
 * `from` set to a registered OffRamp.
 *
 * Runs the real release path (pool balance / lockbox / per-chain silo / mint) and the pool's
 * `_validateReleaseOrMint` (source-chain allowed, source-pool wiring, RMN curse, inbound rate
 * limit) — with zero state overrides. Interface arity (IPoolV2 2-arg vs CCIP_POOL_V1 1-arg) is
 * dispatched off the pool's own ERC165 answer, mirroring `OffRamp._releaseOrMintSingleToken`.
 *
 * Not covered (OffRamp-side, unreachable pre-send): `NotACompatiblePool` and the receiver-side
 * finality check (`getCCVsAndFinalityConfig`, enforced by the OffRamp for data-carrying messages).
 *
 * @param opts - {@link SimulateReleaseOrMintOpts}
 * @returns pool interface used and the pool-computed `destinationAmount` (local decimals)
 *
 * @throws {@link CCIPContractTypeInvalidError} if the pool supports neither IPoolV2 nor CCIP_POOL_V1
 * @throws The raw `eth_call` provider error on any revert. A revert means the message would not
 *   execute on the destination; decode the reason with `EVMChain.parse(getErrorData(err))`, or go
 *   through `EVMChain.checkExecute`, which raises a typed error carrying the encoded revert.
 *
 * @example
 * ```typescript
 * import { simulateReleaseOrMint, EVMChain, getErrorData } from '@chainlink/ccip-sdk'
 *
 * try {
 *   const { destinationAmount } = await simulateReleaseOrMint({
 *     provider, pool, offRamp,
 *     input: {
 *       remoteChainSelector: sourceSelector,
 *       receiver, localToken, sourceDenominatedAmount: amount,
 *       sourcePoolAddress: zeroPadValue(sourcePool, 32),
 *     },
 *   })
 * } catch (err) {
 *   const parsed = EVMChain.parse(getErrorData(err) ?? '0x')
 *   if (parsed) console.log(`dest cannot release: ${parsed.error}`)
 * }
 * ```
 */
export async function simulateReleaseOrMint({
  provider,
  pool,
  offRamp,
  input,
  finality,
}: SimulateReleaseOrMintOpts): Promise<{
  poolInterface: PoolInterfaceVersion
  destinationAmount: bigint
}> {
  const releaseOrMintIn = encodeReleaseOrMintIn(input)

  let poolInterface: PoolInterfaceVersion, calldata: string
  if (await probeSupportsInterface(provider, pool, IPOOL_V2_INTERFACE_ID)) {
    poolInterface = 'IPoolV2'
    calldata = interfaces.TokenPool_v2_0.encodeFunctionData(
      'releaseOrMint((bytes,uint64,address,uint256,address,bytes,bytes,bytes),bytes4)',
      [releaseOrMintIn, toBeHex(encodeFinality(finality ?? 0n), 4)],
    )
  } else if (await probeSupportsInterface(provider, pool, CCIP_POOL_V1_INTERFACE_ID)) {
    poolInterface = 'IPoolV1'
    calldata = interfaces.TokenPool_v2_0.encodeFunctionData(
      'releaseOrMint((bytes,uint64,address,uint256,address,bytes,bytes,bytes))',
      [releaseOrMintIn],
    )
  } else {
    throw new CCIPContractTypeInvalidError(pool, 'unknown (not ERC165 IPoolV2/CCIP_POOL_V1)', [
      'TokenPool',
    ])
  }

  const result = await provider.call({ from: offRamp, to: pool, data: calldata })
  const [{ destinationAmount }] = interfaces.TokenPool_v2_0.decodeFunctionResult(
    poolInterface === 'IPoolV2'
      ? 'releaseOrMint((bytes,uint64,address,uint256,address,bytes,bytes,bytes),bytes4)'
      : 'releaseOrMint((bytes,uint64,address,uint256,address,bytes,bytes,bytes))',
    result,
  ) as unknown as [{ destinationAmount: bigint }]
  return { poolInterface, destinationAmount }
}

/** `Pool.LockOrBurnInV1` (unchanged from v1.5 through v2.0). */
export type LockOrBurnSimInput = {
  /** Receiver on the destination chain (raw bytes; zero-padded address for EVM). */
  receiver: BytesLike
  /** Destination chain selector. */
  remoteChainSelector: bigint
  /** Original sender on this (source) chain. */
  originalSender: string
  /** Amount in the source token's decimals. */
  amount: bigint
  /** Token address on this (source) chain. */
  localToken: string
}

/** Options for {@link simulateLockOrBurn}. */
export type SimulateLockOrBurnOpts = {
  /** Source chain provider. */
  provider: JsonRpcApiProvider
  /** Source token pool address. */
  pool: string
  /**
   * An OnRamp registered on the source Router for the destination chain, used as the
   * `eth_call` `from`, satisfying the pool's `_onlyOnRamp` gate.
   */
  onRamp: string
  /** The `LockOrBurnInV1` input to simulate. */
  input: LockOrBurnSimInput
  /** Requested finality (v2/IPoolV2 pools only). */
  finality?: FinalityRequested
  /**
   * Optional `eth_call` state overrides (3rd RPC param). Burn pools burn from their own balance
   * (the Router pre-transfers in production), so an isolated simulation may need the pool's token
   * balance overridden to reach the `destPoolData` return.
   */
  stateOverrides?: Record<string, unknown>
}

/**
 * Simulate the source pool's `lockOrBurn` to obtain `destPoolData`, the value the
 * destination `releaseOrMint` consumes as `sourcePoolData`. Needed only for source pools whose
 * `lockOrBurn` returns something other than decimals (every base-`TokenPool` pool returns
 * `abi.encode(uint256(localDecimals))`, so the {@link simulateReleaseOrMint} default covers them).
 *
 * Note this is a superset of "fetch destPoolData": it also exercises the source pool's
 * `_validateLockOrBurn` gates (onRamp check, allowlist, outbound rate limit, finality gate), so a
 * revert here may equally indicate a source-side block.
 *
 * @param opts - {@link SimulateLockOrBurnOpts}
 * @returns pool interface used, `destTokenAddress` and `destPoolData` as returned by the pool
 *
 * @throws {@link CCIPContractTypeInvalidError} if the pool supports neither IPoolV2 nor CCIP_POOL_V1
 * @throws The raw `eth_call` provider error on any revert
 */
export async function simulateLockOrBurn({
  provider,
  pool,
  onRamp,
  input,
  finality,
  stateOverrides,
}: SimulateLockOrBurnOpts): Promise<{
  poolInterface: PoolInterfaceVersion
  destTokenAddress: string
  destPoolData: string
}> {
  const lockOrBurnIn = {
    receiver: hexlify(getDataBytes(input.receiver)),
    remoteChainSelector: input.remoteChainSelector,
    originalSender: input.originalSender,
    amount: input.amount,
    localToken: input.localToken,
  }

  let poolInterface: PoolInterfaceVersion, fragment: string, args: unknown[]
  if (await probeSupportsInterface(provider, pool, IPOOL_V2_INTERFACE_ID)) {
    // IPoolV2.lockOrBurn(LockOrBurnInV1, bytes4 requestedFinalityConfig, bytes tokenArgs)
    // returns (LockOrBurnOutV1, uint256 destTokenAmount); tokenArgs is empty for base pools
    poolInterface = 'IPoolV2'
    fragment = 'lockOrBurn((bytes,uint64,address,uint256,address),bytes4,bytes)'
    args = [lockOrBurnIn, toBeHex(encodeFinality(finality ?? 0n), 4), '0x']
  } else if (await probeSupportsInterface(provider, pool, CCIP_POOL_V1_INTERFACE_ID)) {
    poolInterface = 'IPoolV1'
    fragment = 'lockOrBurn((bytes,uint64,address,uint256,address))'
    args = [lockOrBurnIn]
  } else {
    throw new CCIPContractTypeInvalidError(pool, 'unknown (not ERC165 IPoolV2/CCIP_POOL_V1)', [
      'TokenPool',
    ])
  }
  const calldata = interfaces.TokenPool_v2_0.encodeFunctionData(fragment, args)

  const result = (await provider.send('eth_call', [
    { from: onRamp, to: pool, data: calldata },
    'latest',
    ...(stateOverrides ? [stateOverrides] : []),
  ])) as string
  const [{ destTokenAddress, destPoolData }] = interfaces.TokenPool_v2_0.decodeFunctionResult(
    fragment,
    result,
  ) as unknown as [{ destTokenAddress: string; destPoolData: string }]
  return { poolInterface, destTokenAddress, destPoolData }
}
