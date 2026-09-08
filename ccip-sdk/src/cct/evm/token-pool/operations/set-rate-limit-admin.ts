/**
 * setRateLimitAdmin — assigns the TokenPool role allowed to change rate limits alongside the
 * owner (v1.5.0–v1.6.1 only).
 *
 * @remarks **Removed in v2.0.0.** The standalone `setRateLimitAdmin(address)` selector does not
 * exist on a 2.0.0 pool: the role was folded into a three-field dynamic config
 * (`router`/`rateLimitAdmin`/`feeAdmin`) written in one shot by `setDynamicConfig`. The encoder
 * table therefore pins an explicit `null` ceiling at 2.0.0 so a 2.0.0 pool is reported
 * unsupported instead of floor-matching the 1.5.0 encoder and emitting calldata for a selector
 * the pool does not implement. Use {@link SetDynamicConfig} there.
 *
 * Owner-only, deliberately: unlike the rate-limit *config* ops — which the pool accepts from
 * either the owner or the current `rateLimitAdmin` — this op assigns the role itself, so
 * accepting the `rateLimitAdmin` as `sender` would let it reassign (or entrench) its own
 * privilege. Only the pool `owner` is allowed through.
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

/** Parameters for {@link SetRateLimitAdmin}. */
export type SetRateLimitAdminParams = {
  /** Token pool whose rate-limit admin role is being assigned. Must be non-zero — it is the tx
   * `to`, and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * Address to grant the rate-limit admin role to. Named `newRateLimitAdmin` to match the Solana
   * op's public field (`cct/solana/token-pool/operations/set-rate-limit-admin.ts`) rather than the
   * ABI's bare `rateLimitAdmin`, so cross-family callers write one shape.
   *
   * The zero address is **allowed** and meaningful: it clears the role, leaving the owner as the
   * only account that can change rate limits. Revoking a delegated admin is a legitimate — and
   * on incident response, urgent — operation, so it is not rejected here.
   */
  newRateLimitAdmin: string
  /**
   * The pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is checked
   * against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link SetRateLimitAdmin.generate} (an offline builder may not yet know the signer);
   * {@link SetRateLimitAdmin.execute} defaults it to the signing wallet, so the owner check
   * always runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `setRateLimitAdmin` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: SetRateLimitAdminParams) => UnsignedEVMTx

const encodeSetRateLimitAdmin: Encoder = (iface, { poolAddress, newRateLimitAdmin }) =>
  callTx(poolAddress, iface.encodeFunctionData('setRateLimitAdmin', [newRateLimitAdmin]))

/**
 * Assigns a TokenPool's rate-limit admin role (v1.5.0–v1.6.1). Owner-only; removed in v2.0.0 in
 * favour of {@link SetDynamicConfig}.
 */
export class SetRateLimitAdmin extends EVMOperation<SetRateLimitAdminParams> {
  readonly name = 'setRateLimitAdmin'

  /**
   * One 1.5.0 entry covers 1.5.1 and 1.6.1 by floor-match (the encoding never changed), and the
   * explicit `null` at 2.0.0 is load-bearing, not decoration: without it a 2.0.0 pool would
   * floor-match the 1.5.0 encoder and produce calldata for a selector that version removed.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeSetRateLimitAdmin,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /** Validates both addresses before any RPC; a zero `newRateLimitAdmin` clears the role. */
  protected override validate({ poolAddress, newRateLimitAdmin }: SetRateLimitAdminParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'newRateLimitAdmin', newRateLimitAdmin)
  }

  /**
   * Resolves the pool's type/version, confirms `sender` (when given) is the pool owner, then
   * floor-matches the encoder against that version.
   * @remarks The owner check lives here, not only in {@link execute}, so the offline / multisig
   * path gets it too: `generateUnsignedSetRateLimitAdmin` with an unauthorized `sender` would
   * otherwise hand back a fully-formed transaction that reverts `Unauthorized` only after being
   * reviewed and signed. Every sibling owner-gated pool write gates in `buildUnsigned` for the
   * same reason.
   * @remarks Ordered *after* the encoder so a 2.0.0 pool reports the real problem (removed
   * selector) rather than spending a round trip and failing on an authorization detail.
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool — the selector was removed;
   * use {@link SetDynamicConfig}
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetRateLimitAdminParams,
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
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetRateLimitAdminParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
