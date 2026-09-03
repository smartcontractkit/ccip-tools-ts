/**
 * setDynamicConfig — writes a v2.0.0 TokenPool's whole dynamic config in one call: the `router`
 * it accepts ramp calls from, plus the `rateLimitAdmin` and `feeAdmin` delegate roles.
 *
 * @remarks **v2.0.0 only.** This is where the standalone pre-2.0.0 setters went: `setRouter` and
 * `setRateLimitAdmin` were removed and the three fields folded into one struct written together.
 * On a 1.5.0/1.5.1/1.6.1 pool the encoder table matches nothing at or below the resolved version,
 * so the op reports itself unsupported — use `setRateLimitAdmin` there.
 *
 * **This op does not read `getDynamicConfig()` to fill in fields the caller left out, and all
 * three are therefore required.** `generateUnsignedSetDynamicConfig` has to produce deterministic
 * calldata: a multisig or cold wallet may sign it days after it was built, and a hidden read at
 * build time would open a TOCTOU window in which the "current" value baked into the calldata has
 * since changed on-chain — silently reverting an unrelated config change made in the interim.
 * Callers read the current triple with `getTokenPoolState` (which on a 2.0.0 pool already returns
 * `router`, `rateLimitAdmin` and `feeAdmin`, sourced from `getDynamicConfig()`) and pass all three
 * back explicitly, so what is signed is exactly what was reviewed.
 *
 * Owner-only, deliberately: the pool accepts rate-limit *config* writes from the current
 * `rateLimitAdmin` as well as the owner, but this call assigns that role, so admitting the
 * `rateLimitAdmin` as `sender` would let it reassign or entrench its own privilege.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/**
 * Parameters for {@link SetDynamicConfig}. The three config fields keep the contract struct's
 * names — `router`/`rateLimitAdmin`/`feeAdmin`, with no `new` prefix — because this op replaces
 * the whole struct rather than assigning one role, and every field is **required**: omitting one
 * would mean reading the current value at build time, which is exactly what this op refuses to do
 * (see the module remarks).
 */
export type SetDynamicConfigParams = {
  /** Token pool to reconfigure. Must be non-zero — it is the tx `to`, and a call to `0x0` hits no
   * code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * Router the pool accepts `lockOrBurn`/`releaseOrMint` calls from. Must be non-zero: unlike the
   * two admin roles this is not a delegable privilege but the pool's only bridging counterparty,
   * so a zero value does not "clear" anything — it detaches the pool from CCIP entirely and every
   * transfer through it reverts until an owner tx restores it.
   */
  router: string
  /**
   * Address allowed to change the pool's rate limits alongside the owner. The zero address is
   * **allowed** and meaningful: it clears the delegation, leaving the owner as the only account
   * that can change rate limits. Revoking a delegated admin is legitimate — and on incident
   * response, urgent — so it is not rejected here.
   */
  rateLimitAdmin: string
  /**
   * Address allowed to change the pool's token-transfer fee config alongside the owner. Zero is
   * **allowed**, on the same reasoning as {@link SetDynamicConfigParams.rateLimitAdmin}.
   */
  feeAdmin: string
  /**
   * The pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is checked
   * against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link SetDynamicConfig.generate} (an offline builder may not yet know the signer);
   * {@link SetDynamicConfig.execute} defaults it to the signing wallet, so the owner check always
   * runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `setDynamicConfig` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: SetDynamicConfigParams) => UnsignedEVMTx

const encodeSetDynamicConfig: Encoder = (
  iface,
  { poolAddress, router, rateLimitAdmin, feeAdmin },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('setDynamicConfig', [router, rateLimitAdmin, feeAdmin]),
  )

/** Replaces a v2.0.0 TokenPool's dynamic config (`router`, `rateLimitAdmin`, `feeAdmin`). */
export class SetDynamicConfig extends EVMOperation<SetDynamicConfigParams> {
  readonly name = 'setDynamicConfig'

  /**
   * v2.0.0 only, and no `null` ceiling is needed for the versions below it: floor-match walks
   * *downwards* from the resolved version, so 1.5.0/1.5.1/1.6.1 find nothing at or below
   * themselves and are reported unsupported for free.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V2_0_0]: encodeSetDynamicConfig,
  }

  /** Validates all four addresses before any RPC; only `router` and `poolAddress` must be non-zero. */
  protected override validate({
    poolAddress,
    router,
    rateLimitAdmin,
    feeAdmin,
  }: SetDynamicConfigParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateNonZeroAddress(this.name, 'router', router)
    validateAddress(this.name, 'rateLimitAdmin', rateLimitAdmin)
    validateAddress(this.name, 'feeAdmin', feeAdmin)
  }

  /**
   * Resolves the pool's type/version, confirms `sender` (when given) is the pool owner, then
   * floor-matches the encoder against that version. No `getDynamicConfig()` read — see the
   * module remarks.
   * @remarks The owner check lives here, not only in {@link execute}, so the offline / multisig
   * path gets it too: `generateUnsignedSetDynamicConfig` with an unauthorized `sender` would
   * otherwise hand back a fully-formed transaction that reverts `Unauthorized` only after being
   * reviewed and signed. Every sibling owner-gated pool write gates in `buildUnsigned` for the
   * same reason.
   * @remarks Ordered *after* the encoder so a pre-2.0.0 pool reports the real problem (no such
   * function) rather than spending a round trip and failing on an authorization detail.
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool, which has no
   * `setDynamicConfig`
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetDynamicConfigParams,
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
   * or is not the pool owner
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetDynamicConfigParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
