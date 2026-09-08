/**
 * Shared internals of the three remote-pool write ops — `setRemotePool` (v1.5.0),
 * `addRemotePool` and `removeRemotePool` (v1.5.1+): the parameter shape they have in common,
 * `remotePoolAddress` parsing, and the per-lane membership read the add/remove preconditions
 * are checked against. The owner gate itself is `assertPoolOwner` in `../contracts.ts`,
 * shared with every other owner-gated pool write.
 *
 * @packageDocumentation
 */

import { isHexString } from 'ethers'

import { CCIPTokenPoolChainConfigNotFoundError } from '../../../errors/index.ts'
import type { EVMChain } from '../../../evm/index.ts'
import { networkInfo } from '../../../networks.ts'
import { decodeAddress } from '../../../utils.ts'
import { parseHexBytes, validateNonZeroAddress, validateUint64 } from '../validate.ts'

/**
 * Parameters shared by every remote-pool write op: which pool, which lane, and which remote pool.
 *
 * @remarks `remotePoolAddress` is the *remote* chain's pool address as raw bytes, not an EVM
 * address: the lane's other end may be Solana, Aptos or Sui, whose addresses are 32 bytes. The
 * contracts take it as `bytes` for exactly that reason, so it is accepted here as hex of any
 * (even-digit) length rather than validated as an EVM address.
 */
export type RemotePoolParams = {
  /** Local token pool contract being reconfigured. */
  poolAddress: string
  /** CCIP selector of the lane's remote chain (`uint64`). */
  remoteChainSelector: bigint
  /**
   * Remote chain's pool address as hex bytes; the `0x` prefix is optional. Any even number of
   * hex digits is accepted — a non-EVM remote's address is not 20 bytes.
   */
  remotePoolAddress: string
  /** Current pool owner; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/**
 * {@link RemotePoolParams} as {@link parseRemotePoolParams} leaves it: `remotePoolAddress`
 * normalised to 0x-prefixed lowercase hex, so `buildUnsigned` encodes it without re-parsing.
 */
export type ParsedRemotePoolParams = RemotePoolParams & { remotePoolAddress: string }

/**
 * Normalises `remotePoolAddress` to 0x-prefixed lowercase hex, the form `bytes` calldata is
 * encoded from.
 * @remarks Deliberately not an address check: see {@link RemotePoolParams.remotePoolAddress}.
 * Only the encoding is constrained — hex digits, `0x` optional, whole bytes, non-empty. A thin
 * alias over the shared {@link parseHexBytes} that fixes the param path these three ops all
 * blame; the parser itself lives in `../validate.ts` alongside its sibling validators, shared
 * with `applyChainUpdates`, which validates the same kind of value.
 * @throws {@link CCTParamsInvalidError} if `value` is not a non-empty, whole-byte hex string
 */
export function parseRemotePoolAddress(operation: string, value: unknown): string {
  return parseHexBytes(operation, 'remotePoolAddress', value)
}

/**
 * Validates the params every remote-pool op takes, before any RPC.
 * @remarks `poolAddress` is required to be **non-zero**, not merely well formed: a call to `0x0`
 * hits no code, so it would mine as a *successful* no-op rather than failing.
 * @returns The parsed `remotePoolAddress` (0x-prefixed lowercase hex).
 * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid non-zero address,
 * `remoteChainSelector` is not a `uint64`, or `remotePoolAddress` is not hex bytes
 */
export function validateRemotePoolParams(operation: string, params: RemotePoolParams): string {
  validateNonZeroAddress(operation, 'poolAddress', params.poolAddress)
  validateUint64(operation, 'remoteChainSelector', params.remoteChainSelector)
  return parseRemotePoolAddress(operation, params.remotePoolAddress)
}

/**
 * The three ops' {@link Operation.parse}: validates every field before any RPC and returns the
 * params with `remotePoolAddress` already normalised, so `buildUnsigned` encodes it without
 * re-parsing. Spreads the result of {@link validateRemotePoolParams} back over the params.
 * @throws {@link CCTParamsInvalidError} if any field is invalid (see {@link validateRemotePoolParams})
 */
export function parseRemotePoolParams(
  operation: string,
  params: RemotePoolParams,
): ParsedRemotePoolParams {
  return { ...params, remotePoolAddress: validateRemotePoolParams(operation, params) }
}

/**
 * Reads the remote pool addresses currently registered on one lane, as the pool reports them.
 *
 * @remarks Scoped to the single `remoteChainSelector` rather than scanning every supported
 * chain — one `getRemotePools` call instead of one per lane.
 *
 * A lane with no configuration at all surfaces from
 * {@link EVMChain.getTokenPoolRemotes} as {@link CCIPTokenPoolChainConfigNotFoundError} (it
 * requires a non-zero remote token), not as an empty result. That is treated here as "no remote
 * pools registered", which is what it means: an unconfigured lane cannot have any.
 */
export async function readRegisteredRemotePools(
  chain: EVMChain,
  { poolAddress, remoteChainSelector }: RemotePoolParams,
): Promise<readonly string[]> {
  let remotes
  try {
    remotes = await chain.getTokenPoolRemotes(poolAddress, remoteChainSelector)
  } catch (err) {
    if (err instanceof CCIPTokenPoolChainConfigNotFoundError) return []
    throw err
  }
  // one selector in, at most one lane out — keyed by the remote network's name
  return Object.values(remotes).flatMap(({ remotePools }) => remotePools)
}

/**
 * Whether `remotePoolAddress` (hex bytes) is among the lane's `registered` pools.
 *
 * @remarks The two sides arrive in different spellings: `registered` comes back from
 * {@link EVMChain.getTokenPoolRemotes} already decoded into the *remote* family's address format
 * (checksummed hex for EVM, base58 for Solana, …), while the caller passes raw `bytes`. So the
 * caller's value is decoded through the same codec, with the remote chain's family taken from
 * its selector, and only then compared.
 *
 * Comparison is exact, or case-insensitive when both sides are hex — which covers EVM checksum
 * spellings without risking a false match between two base58 addresses that differ only in case.
 * If the family is unknown or the bytes are not decodable as one of its addresses (e.g. an
 * oddly sized value), the undecoded hex is compared instead, so an unrecognised lane degrades
 * to a plain byte comparison rather than throwing.
 */
export function isRegisteredRemotePool(
  registered: readonly string[],
  remotePoolAddress: string,
  remoteChainSelector: bigint,
): boolean {
  let expected
  try {
    expected = decodeAddress(remotePoolAddress, networkInfo(remoteChainSelector).family)
  } catch {
    expected = remotePoolAddress
  }
  return registered.some(
    (pool) =>
      pool === expected ||
      (isHexString(pool) && isHexString(expected) && pool.toLowerCase() === expected.toLowerCase()),
  )
}
