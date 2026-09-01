/**
 * applyAllowlistUpdates — replaces entries in a token pool's sender allowlist, the set of local
 * addresses permitted to initiate a CCIP transfer through the pool. Removes are applied before
 * adds, in one call: `applyAllowListUpdates(address[] removes, address[] adds)`.
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
import { validateAddress, validateArray, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link ApplyAllowlistUpdates}. */
export type ApplyAllowlistUpdatesParams = {
  /** Token pool contract address whose allowlist is being updated. */
  poolAddress: string
  /**
   * Addresses to remove from the allowlist. Applied *before* {@link adds} on-chain. Must contain
   * no duplicates, and no address that also appears in {@link adds}.
   */
  removes: string[]
  /**
   * Addresses to add to the allowlist. Must contain no duplicates, and no address that also
   * appears in {@link removes}. The zero address is accepted locally and rejected by the pool
   * on-chain (`ZeroAddressNotAllowed`).
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
 * @throws {@link CCTParamsInvalidError} if an entry is not a valid address (reported as
 * `param[i]`), or the array holds duplicates
 */
function normalizeAddresses(operation: string, param: string, addresses: string[]): string[] {
  const normalized = addresses.map((address, i) => {
    validateAddress(operation, `${param}[${i}]`, address)
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
   * Comparisons are on checksummed form, so the same address in two different casings still
   * counts as a duplicate / an overlap.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, either array is not an
   * array or is sparse, both are empty, an entry is not a valid address (reported as `adds[i]` /
   * `removes[i]`), an array holds duplicates, or an address appears in both arrays
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
   * allowlist) and, when `sender` is known, confirms it is the pool owner before encoding.
   *
   * @remarks Encoder resolution runs *before* the owner read on purpose: an unsupported version
   * should surface as {@link CCTOperationUnsupportedError} rather than burning an RPC on a pool
   * this op can never target. The owner check is skipped entirely when `sender` is omitted —
   * there is nothing to compare against, and `generateUnsignedApplyAllowlistUpdates` is expected
   * to be usable before the eventual signer is known. {@link execute} always supplies one.
   * @throws {@link CCTOperationUnsupportedError} if the pool is v2.0.0
   * @throws {@link CCTContractTypeInvalidError} if the address is not a supported pool type
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedApplyAllowlistUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)
    return unsigned
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
