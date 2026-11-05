/**
 * setRateLimitAdmin: assigns the TokenPool role allowed to change rate limits alongside the owner.
 *
 * @remarks **v2.0.0 has no standalone setter.** 2.0.0 removed `setRateLimitAdmin(address)` and
 * folded the role into a dynamic config (`router`/`rateLimitAdmin`/`feeAdmin`) that
 * `setDynamicConfig` overwrites as a whole. On a 2.0.0 pool this op reads `getDynamicConfig()`
 * at build time and encodes `setDynamicConfig(router, newRateLimitAdmin, feeAdmin)`, writing
 * `router` and `feeAdmin` back as read.
 *
 * Unlike {@link SetDynamicConfig}, the 2.0.0 calldata therefore depends on chain state at build
 * time: if `router` or `feeAdmin` changes before a multisig signs, the tx writes the old value
 * back. Use {@link SetDynamicConfig} for exact control over all three fields.
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
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  readTokenPoolDynamicConfig,
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

/**
 * Encodes the role assignment against the resolved pool {@link Interface}. Takes `chain` and is
 * async because the v2.0.0 encoder reads the fields it must preserve.
 */
type Encoder = (
  chain: EVMChain,
  iface: Interface,
  params: SetRateLimitAdminParams,
) => Promise<UnsignedEVMTx>

/** v1.5.0–v1.6.1: the standalone `setRateLimitAdmin(address)`. */
const encodeSetRateLimitAdmin: Encoder = async (
  _chain,
  iface,
  { poolAddress, newRateLimitAdmin },
) => callTx(poolAddress, iface.encodeFunctionData('setRateLimitAdmin', [newRateLimitAdmin]))

/**
 * v2.0.0: `setDynamicConfig(router, rateLimitAdmin, feeAdmin)` overwrites all three fields, so
 * `router` and `feeAdmin` are read from `getDynamicConfig()` and written back as read.
 */
const encodeSetDynamicConfigV2_0_0: Encoder = async (
  chain,
  iface,
  { poolAddress, newRateLimitAdmin },
) => {
  const { router, feeAdmin } = await readTokenPoolDynamicConfig(chain, poolAddress)
  return callTx(
    poolAddress,
    iface.encodeFunctionData('setDynamicConfig', [router, newRateLimitAdmin, feeAdmin]),
  )
}

/**
 * Assigns a TokenPool's rate-limit admin role. Owner-only. On v2.0.0 it writes
 * `setDynamicConfig`, keeping the on-chain `router` and `feeAdmin`.
 */
export class SetRateLimitAdmin extends EVMOperation<SetRateLimitAdminParams> {
  readonly name = 'setRateLimitAdmin'

  /**
   * One 1.5.0 entry covers 1.5.1, 1.6.0 and 1.6.1 by floor-match (the encoding never changed).
   * 2.0.0 needs its own entry: it removed the selector the 1.5.0 encoder emits.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder>> = {
    [TokenPoolVersion.V1_5_0]: encodeSetRateLimitAdmin,
    [TokenPoolVersion.V2_0_0]: encodeSetDynamicConfigV2_0_0,
  }

  /** Validates both addresses before any RPC; a zero `newRateLimitAdmin` clears the role. */
  protected override prepare(params: SetRateLimitAdminParams): SetRateLimitAdminParams {
    const { poolAddress, newRateLimitAdmin } = params
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'newRateLimitAdmin', newRateLimitAdmin)
    return params
  }

  /**
   * Resolves the pool's type/version and floor-matches the encoder, then encodes while
   * confirming `sender` (when given) is the pool owner.
   * @remarks The owner check lives here, not only in {@link execute}, so the offline / multisig
   * path gets it too: `generateUnsignedSetRateLimitAdmin` with an unauthorized `sender` would
   * otherwise hand back a fully-formed transaction that reverts `Unauthorized` only after being
   * reviewed and signed. Every sibling owner-gated pool write gates in `buildUnsigned` for the
   * same reason.
   * @remarks Encoder resolution runs *before* any read so a version with no encoder reports the
   * real problem (unsupported) rather than spending a round trip and failing on an authorization
   * detail. Encoding (which reads `getDynamicConfig()` on v2.0.0) and the owner check are
   * independent, so they run in parallel.
   * @throws {@link CCTOperationUnsupportedError} if no encoder covers the pool's version
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetRateLimitAdminParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const [unsigned] = await Promise.all([
      encode(chain, getTokenPoolInterface(type, version), params),
      params.sender !== undefined &&
        assertPoolOwner(this.name, chain, params.poolAddress, params.sender),
    ])
    return unsigned
  }
}
