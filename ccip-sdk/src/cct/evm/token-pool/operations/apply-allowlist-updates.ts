/**
 * applyAllowlistUpdates — replaces entries in a token pool's sender allowlist, the set of local
 * addresses permitted to initiate a CCIP transfer through the pool. Removes are applied before
 * adds, in one call: `applyAllowListUpdates(address[] removes, address[] adds)`.
 *
 * @remarks Requires the allowlist holder to have been deployed *with* an allowlist:
 * `allowlistEnabled` is immutable, and the call reverts `AllowListNotEnabled` when it is false.
 * That, and every update the holder would silently ignore, is pre-flighted against the current
 * allowlist before any calldata is built.
 *
 * @remarks The holder moved in v2.0.0 (see `resolveAllowlistHolder`). On v1.5.0–v1.6.1 the tx
 * goes to the pool. A v2.0.0 pool has no allowlist of its own, so the tx goes to its bound
 * `AdvancedPoolHooks`, gated on the *hooks* owner, and changes the allowlist of every pool bound
 * to those hooks. A v2.0.0 pool with no hooks bound reports {@link CCTOperationUnsupportedError}.
 *
 * @packageDocumentation
 */

import { ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksOwner,
} from '../../advanced-pool-hooks/contracts.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateArray, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  readTokenPoolAllowlist,
  resolveAllowlistHolder,
} from '../contracts.ts'

/** Parameters for {@link ApplyAllowlistUpdates}. */
export type ApplyAllowlistUpdatesParams = {
  /**
   * Token pool whose allowlist is being updated. On v2.0.0 the update lands on the pool's bound
   * `AdvancedPoolHooks`, and so applies to every pool bound to them.
   */
  poolAddress: string
  /**
   * Addresses to remove from the allowlist. Applied *before* {@link adds} on-chain. Must contain
   * no duplicates, no zero address, and no address that also appears in {@link adds}. Every entry
   * must currently be allowlisted — the holder silently ignores the rest.
   */
  removes: string[]
  /**
   * Addresses to add to the allowlist. Must contain no duplicates, no zero address, and no
   * address that also appears in {@link removes}. No entry may already be allowlisted — the holder
   * silently ignores the rest.
   */
  adds: string[]
  /**
   * Allowlist holder's owner: the pool owner on v1.5.0–v1.6.1, the `AdvancedPoolHooks` owner on
   * v2.0.0. Sets `tx.from` for offline / multisig signing. When supplied it is also checked
   * against the holder's on-chain `owner()` before any calldata is built, since both gate
   * `applyAllowListUpdates` on `onlyOwner`.
   */
  sender?: string
}

/**
 * Normalized params for {@link ApplyAllowlistUpdates}: every allowlist entry checksummed and
 * duplicate-free, so {@link buildUnsigned} and the encoder never re-derive them.
 */
type ParsedApplyAllowlistUpdatesParams = {
  poolAddress: string
  removes: string[]
  adds: string[]
  sender?: string
}

/**
 * Validates every entry of one array and returns it checksummed, rejecting duplicates. Compared
 * on checksummed form, so the same address in two different casings still counts as a duplicate.
 *
 * The zero address is rejected outright: the holder skips it in `adds` (`if (toAdd == address(0))
 * continue`) and can never hold it, so it is a silent no-op in either array.
 * @throws {@link CCTParamsInvalidError} if an entry is not a valid address or is the zero address
 * (reported as `param[i]`), or the array holds duplicates
 */
function normalizeAddresses(operation: string, param: string, addresses: string[]): string[] {
  const normalized = addresses.map((address, i) => {
    validateNonZeroAddress(operation, `${param}[${i}]`, address)
    return getAddress(address)
  })
  if (new Set(normalized).size !== normalized.length)
    throw new CCTParamsInvalidError(operation, param, 'must not contain duplicate addresses')
  return normalized
}

/**
 * Applies allowlist removals and additions to an EVM token pool's allowlist in one
 * `applyAllowListUpdates` call: on the pool (v1.5.0–v1.6.1) or its bound `AdvancedPoolHooks`
 * (v2.0.0).
 */
export class ApplyAllowlistUpdates extends EVMOperation<
  ApplyAllowlistUpdatesParams,
  ParsedApplyAllowlistUpdatesParams
> {
  readonly name = 'applyAllowlistUpdates'

  /**
   * Validates the pool address and every allowlist entry before any RPC, *keeping* what each
   * check produced (checksummed, duplicate-free arrays) so {@link buildUnsigned} and the encoder
   * never re-derive it.
   *
   * Three judgement calls, all rejections:
   * - **both arrays empty** — rejected: such a call encodes and mines while changing nothing, so
   *   it can only be a caller bug; mirrors `lockbox/operations/authorize-callers.ts`.
   * - **duplicates within an array** — rejected, mirroring the Solana `configureAllowlist` /
   *   `removeFromAllowlist` ops. The EVM holder treats its allowlist as a set, so a duplicate is a
   *   silent no-op on-chain; catching it locally keeps the two families' contracts identical.
   * - **an address in BOTH `adds` and `removes`** — rejected: removes apply first, so the address
   *   would end up *allowlisted*, and no caller can reasonably have meant both.
   *
   * - **the zero address in either array** — rejected: the holder `continue`s past it in `adds` and
   *   so can never hold it, making it a silent no-op on either side.
   *
   * Comparisons are on checksummed form, so the same address in two different casings still
   * counts as a duplicate / an overlap. The remaining no-ops — removing an address that is not
   * allowlisted, adding one that already is — need the holder's current allowlist and are caught in
   * {@link buildUnsigned}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, either array is not an
   * array or is sparse, both are empty, an entry is not a valid address or is the zero address
   * (reported as `adds[i]` / `removes[i]`), an array holds duplicates, or an address appears in
   * both arrays
   */
  protected override parse(params: ApplyAllowlistUpdatesParams): ParsedApplyAllowlistUpdatesParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    validateArray(this.name, 'removes', params.removes)
    validateArray(this.name, 'adds', params.adds)
    if (params.removes.length + params.adds.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'adds',
        'at least one address must be added or removed',
      )
    }

    const removes = normalizeAddresses(this.name, 'removes', params.removes)
    const adds = normalizeAddresses(this.name, 'adds', params.adds)
    const removed = new Set(removes)
    const overlap = adds.find((address) => removed.has(address))
    if (overlap !== undefined) {
      throw new CCTParamsInvalidError(
        this.name,
        'adds',
        `${overlap} is also in removes; removes are applied first on-chain, so it would end up allowlisted — list it in one array only`,
      )
    }
    return { poolAddress: params.poolAddress, removes, adds, sender: params.sender }
  }

  /**
   * Resolves which contract holds the pool's allowlist (the pool, or its bound hooks on v2.0.0),
   * confirms `sender` owns that holder when it is known, then pre-flights the update against the
   * current allowlist so nothing that would revert or mine as a no-op is ever built.
   *
   * Three state preconditions:
   * - **the allowlist must be enabled** — `applyAllowListUpdates` opens with
   *   `if (!i_allowlistEnabled) revert AllowListNotEnabled()`. The flag is `immutable`, set to
   *   `allowlist.length > 0` in the constructor, so a holder deployed without one can never gain
   *   it. Permanent for a legacy pool; a v2.0.0 pool can be re-pointed at other hooks.
   * - **every `removes` entry must currently be allowlisted** — `EnumerableSet.remove` returns
   *   false for an absent address and the holder ignores it, so the tx mines having changed
   *   nothing. Mirrors `remove-remote-pool.ts`.
   * - **no `adds` entry may already be allowlisted** — the symmetric case: `EnumerableSet.add`
   *   returns false and the entry is silently skipped.
   *
   * @remarks The owner check is skipped entirely when `sender` is omitted — there is nothing to
   * compare against, and `generateUnsignedApplyAllowlistUpdates` is expected to be usable before
   * the eventual signer is known. {@link execute} always supplies one. The allowlist pre-flight,
   * by contrast, does not depend on the signer and always runs.
   * @throws {@link CCTOperationUnsupportedError} if the pool is v2.0.0 with no hooks bound
   * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the holder's owner, if
   * the holder has no allowlist enabled, if a `removes` entry is not currently allowlisted, or if
   * an `adds` entry already is
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedApplyAllowlistUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version, holder } = await resolveAllowlistHolder(chain, params.poolAddress)
    const viaHooks = version === TokenPoolVersion.V2_0_0
    if (holder === ZeroAddress)
      throw new CCTOperationUnsupportedError(this.name, version, {
        context: { poolAddress: params.poolAddress, advancedPoolHooks: ZeroAddress },
        recovery:
          'A v2.0.0 pool holds no allowlist itself; it enforces the one on its bound AdvancedPoolHooks, and this pool has none bound. ' +
          'Deploy hooks with a non-empty allowlist (deployAdvancedPoolHooks), authorize the pool on them, and bind them with updateAdvancedPoolHooks.',
      })
    // owner-gated on-chain; surface it as a param error here instead of an on-chain revert. The
    // hooks are owned separately from the pools bound to them.
    if (params.sender !== undefined)
      await (viaHooks ? assertAdvancedPoolHooksOwner : assertPoolOwner)(
        this.name,
        chain,
        holder,
        params.sender,
      )

    const { enabled, entries } = await readTokenPoolAllowlist(chain, holder)
    if (!enabled)
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        viaHooks
          ? `the AdvancedPoolHooks at ${holder} bound to this pool were deployed without an allowlist and can never have one (\`allowlistEnabled\` is immutable and false); deploy hooks with a non-empty allowlist and re-point the pool with updateAdvancedPoolHooks`
          : 'pool was deployed without an allowlist and can never have one (`allowlistEnabled` is immutable and false); applyAllowListUpdates reverts AllowListNotEnabled',
      )

    const allowlisted = new Set(entries)
    const absent = params.removes.find((address) => !allowlisted.has(address))
    if (absent !== undefined)
      throw new CCTParamsInvalidError(
        this.name,
        'removes',
        `${absent} is not allowlisted (allowlisted: ${entries.join(', ') || 'none'}); it would be ignored and the tx would change nothing`,
      )
    const present = params.adds.find((address) => allowlisted.has(address))
    if (present !== undefined)
      throw new CCTParamsInvalidError(
        this.name,
        'adds',
        `${present} is already allowlisted; it would be ignored and the tx would change nothing`,
      )

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, holder = ${holder}, allowlisted = ${entries.length}, removes = ${params.removes.length}, adds = ${params.adds.length}`,
    )
    // `removes` FIRST, then `adds`: the ABI's own order. A swapped pair still encodes (both are
    // `address[]`) and would allowlist the addresses meant to be revoked; byte-parity tests pin it.
    const iface = viaHooks ? ADVANCED_POOL_HOOKS_INTERFACE : getTokenPoolInterface(type, version)
    return callTx(
      holder,
      iface.encodeFunctionData('applyAllowListUpdates', [params.removes, params.adds]),
    )
  }

  /**
   * Signs and submits as the holder's owner, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * if the wallet is not the holder's owner, or if any other param is invalid
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ApplyAllowlistUpdatesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
