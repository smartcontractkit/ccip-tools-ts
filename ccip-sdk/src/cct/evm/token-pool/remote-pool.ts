/**
 * Shared internals of the three remote-pool write ops — `setRemotePool` (v1.5.0),
 * `addRemotePool` and `removeRemotePool` (v1.5.1+): the parameter shape they have in common,
 * `remotePoolAddress` parsing and encoding, and the per-lane membership read the add/remove
 * preconditions are checked against. The owner check itself is `checkPoolOwner` in `../contracts.ts`,
 * shared with every other owner-gated pool write.
 *
 * @packageDocumentation
 */

import { CCIPTokenPoolChainConfigNotFoundError } from '../../../errors/index.ts'
import type { EVMChain } from '../../../evm/index.ts'
import { parseRemoteAddress } from '../../remote-address.ts'
import { validateNonZeroAddress, validateUint64 } from '../validate.ts'

/**
 * Parameters shared by every remote-pool write op: which pool, which lane, and which remote pool.
 *
 * @remarks `remotePoolAddress` is the *remote* chain's pool address, not necessarily an EVM
 * address: the lane's other end may be Solana, Aptos or Sui. It is written in that chain's own
 * format, validated against the family of `remoteChainSelector`, and encoded to the 32-byte padded
 * `bytes` the contracts store — an unpadded EVM remote would configure fine, then revert every
 * inbound transfer with `InvalidSourcePoolAddress`.
 */
export type RemotePoolParams = {
  /** Local token pool contract being reconfigured. */
  poolAddress: string
  /** CCIP selector of the lane's remote chain (`uint64`). */
  remoteChainSelector: bigint
  /** Remote chain's pool address in that chain's own format: `0x…` for EVM, base58 for Solana. */
  remotePoolAddress: string
  /** Current pool owner; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/**
 * {@link RemotePoolParams} as {@link parseRemotePoolParams} leaves it: `remotePoolAddress` in its
 * canonical spelling, the one {@link EVMChain.getTokenPoolRemotes} returns, so the add/remove
 * preconditions compare it as a plain string. Each op's encoder pads it once, via
 * `encodeAddressToAny`.
 */
export type ParsedRemotePoolParams = RemotePoolParams & { remotePoolAddress: string }

/**
 * Validates the params every remote-pool op takes, before any RPC.
 * @remarks `poolAddress` is required to be **non-zero**, not merely well formed: a call to `0x0`
 * hits no code, so it would mine as a *successful* no-op rather than failing.
 * @returns The canonical `remotePoolAddress`.
 * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid non-zero address,
 * `remoteChainSelector` is not a `uint64` or a known chain selector, or `remotePoolAddress` is not
 * a valid, non-zero address of that chain's family
 */
export function validateRemotePoolParams(operation: string, params: RemotePoolParams): string {
  validateNonZeroAddress(operation, 'poolAddress', params.poolAddress)
  validateUint64(operation, 'remoteChainSelector', params.remoteChainSelector)
  return parseRemoteAddress(
    operation,
    'remotePoolAddress',
    params.remotePoolAddress,
    params.remoteChainSelector,
  )
}

/**
 * The three ops' {@link Operation.parse}: validates every field before any RPC and returns the
 * params with `remotePoolAddress` already canonical. Spreads the result of
 * {@link validateRemotePoolParams} back over the params.
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
