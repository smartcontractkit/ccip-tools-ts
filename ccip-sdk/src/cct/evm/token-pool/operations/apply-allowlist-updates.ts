/**
 * applyAllowlistUpdates — replaces entries in a token pool's sender allowlist, the set of local
 * addresses permitted to initiate a CCIP transfer through the pool. Removes are applied before
 * adds, in one call: `applyAllowListUpdates(address[] removes, address[] adds)`.
 *
 * @remarks Requires the pool to have been deployed *with* an allowlist: `allowlistEnabled` is
 * immutable, and the call reverts `AllowListNotEnabled` when it is false. That, and every update
 * the pool would silently ignore, is pre-flighted against the current allowlist before any
 * calldata is built.
 *
 * @remarks Available on v1.5.0–v1.6.1 with an unchanged signature, and **removed outright in
 * v2.0.0**, which has no allowlist. The encoder table pins an explicit `null` ceiling at
 * {@link TokenPoolVersion.V2_0_0} so {@link resolveEncoder}'s floor-match cannot inherit the
 * 1.5.0 encoder upward and emit calldata for a selector the pool does not implement; a 2.0.0 pool
 * reports {@link CCTOperationUnsupportedError} instead.
 *
 * @packageDocumentation
 */

import { type Interface, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateArray, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  readTokenPoolAllowlist,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link ApplyAllowlistUpdates}. */
export type ApplyAllowlistUpdatesParams = {
  /** Token pool contract address whose allowlist is being updated. */
  poolAddress: string
  /**
   * Addresses to remove from the allowlist. Applied *before* {@link adds} on-chain. Must contain
   * no duplicates, no zero address, and no address that also appears in {@link adds}. Every entry
   * must currently be allowlisted — the pool silently ignores the rest.
   */
  removes: string[]
  /**
   * Addresses to add to the allowlist. Must contain no duplicates, no zero address, and no
   * address that also appears in {@link removes}. No entry may already be allowlisted — the pool
   * silently ignores the rest.
   */
  adds: string[]
  /**
   * Current pool owner; sets `tx.from` for offline / multisig signing. When supplied it is also
   * checked against the pool's on-chain `owner()` before any calldata is built, since the pool
   * gates `applyAllowListUpdates` on `onlyOwner`.
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

/** Encodes `applyAllowListUpdates` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ParsedApplyAllowlistUpdatesParams) => UnsignedEVMTx

/**
 * `removes` FIRST, then `adds` — the ABI's own parameter order. A swapped pair still encodes and
 * still type-checks (both are `address[]`), and would silently allowlist the addresses meant to be
 * revoked, so the byte-parity test is what pins this down.
 */
const encodeApplyAllowlistUpdates: Encoder = (iface, { poolAddress, removes, adds }) =>
  callTx(poolAddress, iface.encodeFunctionData('applyAllowListUpdates', [removes, adds]))

/**
 * Validates every entry of one array and returns it checksummed, rejecting duplicates. Compared
 * on checksummed form, so the same address in two different casings still counts as a duplicate.
 *
 * The zero address is rejected outright: the pool skips it in `adds` (`if (toAdd == address(0))
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
 * Applies allowlist removals and additions to an EVM token pool in one `applyAllowListUpdates`
 * call (v1.5.0–v1.6.1; unsupported on v2.0.0, which has no allowlist).
 */
export class ApplyAllowlistUpdates extends EVMOperation<
  ApplyAllowlistUpdatesParams,
  ParsedApplyAllowlistUpdatesParams
> {
  readonly name = 'applyAllowlistUpdates'

  /**
   * One entry at V1_5_0 covers v1.5.0/v1.5.1/v1.6.1, whose signature is identical, and the
   * explicit `null` at V2_0_0 stops the floor-match walk: the function was removed from the
   * contract there, so there is nothing to inherit. See {@link resolveEncoder}.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeApplyAllowlistUpdates,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /**
   * Validates the pool address and every allowlist entry before any RPC, *keeping* what each
   * check produced (checksummed, duplicate-free arrays) so {@link buildUnsigned} and the encoder
   * never re-derive it.
   *
   * Three judgement calls, all rejections:
   * - **both arrays empty** — rejected: such a call encodes and mines while changing nothing, so
   *   it can only be a caller bug; mirrors `lockbox/operations/authorize-callers.ts`.
   * - **duplicates within an array** — rejected, mirroring the Solana `configureAllowlist` /
   *   `removeFromAllowlist` ops. The EVM pool treats its allowlist as a set, so a duplicate is a
   *   silent no-op on-chain; catching it locally keeps the two families' contracts identical.
   * - **an address in BOTH `adds` and `removes`** — rejected: removes apply first, so the address
   *   would end up *allowlisted*, and no caller can reasonably have meant both.
   *
   * - **the zero address in either array** — rejected: the pool `continue`s past it in `adds` and
   *   so can never hold it, making it a silent no-op on either side.
   *
   * Comparisons are on checksummed form, so the same address in two different casings still
   * counts as a duplicate / an overlap. The remaining no-ops — removing an address that is not
   * allowlisted, adding one that already is — need the pool's current allowlist and are caught in
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
   * Resolves the pool's type + version, floor-matches the encoder (rejecting v2.0.0, which has no
   * allowlist), confirms `sender` owns the pool when it is known, then pre-flights the update
   * against the pool's current allowlist so nothing that would revert or mine as a no-op is ever
   * built.
   *
   * Three state preconditions, all read in one round-trip by {@link readTokenPoolAllowlist}:
   * - **the allowlist must be enabled** — `applyAllowListUpdates` opens with
   *   `if (!i_allowlistEnabled) revert AllowListNotEnabled()`. The flag is `immutable`, set to
   *   `allowlist.length > 0` in the constructor, so a pool deployed without one can never gain
   *   it: this is a permanent property of the pool, not a transient state.
   * - **every `removes` entry must currently be allowlisted** — `EnumerableSet.remove` returns
   *   false for an absent address and the pool ignores it, so the tx mines having changed
   *   nothing. Mirrors `remove-remote-pool.ts`.
   * - **no `adds` entry may already be allowlisted** — the symmetric case: `EnumerableSet.add`
   *   returns false and the entry is silently skipped.
   *
   * @remarks Encoder resolution runs *before* the owner read on purpose: an unsupported version
   * should surface as {@link CCTOperationUnsupportedError} rather than burning an RPC on a pool
   * this op can never target. The owner check is skipped entirely when `sender` is omitted —
   * there is nothing to compare against, and `generateUnsignedApplyAllowlistUpdates` is expected
   * to be usable before the eventual signer is known. {@link execute} always supplies one. The
   * allowlist pre-flight, by contrast, does not depend on the signer and always runs.
   * @throws {@link CCTOperationUnsupportedError} if the pool is v2.0.0
   * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner, if the
   * pool has no allowlist enabled, if a `removes` entry is not currently allowlisted, or if an
   * `adds` entry already is
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedApplyAllowlistUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    // resolved before any further RPC, so an unsupported version fails on one call
    const encode = resolveEncoder(this.encoders, version, this.name)
    // owner-gated on-chain; surface it as a param error here instead of an on-chain revert
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)

    const { enabled, entries } = await readTokenPoolAllowlist(chain, params.poolAddress)
    if (!enabled)
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        'pool was deployed without an allowlist and can never have one (`allowlistEnabled` is immutable and false); applyAllowListUpdates reverts AllowListNotEnabled',
      )

    const allowlisted = new Set(entries)
    const absent = params.removes.find((address) => !allowlisted.has(address))
    if (absent !== undefined)
      throw new CCTParamsInvalidError(
        this.name,
        'removes',
        `${absent} is not allowlisted (allowlisted: ${entries.join(', ') || 'none'}); the pool would ignore it and the tx would change nothing`,
      )
    const present = params.adds.find((address) => allowlisted.has(address))
    if (present !== undefined)
      throw new CCTParamsInvalidError(
        this.name,
        'adds',
        `${present} is already allowlisted; the pool would ignore it and the tx would change nothing`,
      )

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, allowlisted = ${entries.length}, removes = ${params.removes.length}, adds = ${params.adds.length}`,
    )
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * if the wallet is not the pool owner, or if any other param is invalid
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ApplyAllowlistUpdatesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
