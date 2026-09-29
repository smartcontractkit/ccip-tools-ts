/**
 * transferAdmin — proposes a new TokenAdminRegistry administrator for a token
 * (two-step; the proposed admin must separately call `acceptAdmin`).
 * Version-independent (v1.5–v2.0 share one encoding).
 *
 * @remarks This is the registry's ADMIN role — the account allowed to call `setPool`
 * ({@link SetPool}) and manage the token's CCT configuration in the `TokenAdminRegistry`.
 * It is entirely distinct from a `TokenPool`'s Ownable2Step *owner* ({@link TransferOwnership}),
 * which controls the pool contract itself (rate limits, remote-chain config, etc.). A token's
 * registry admin and its pool's owner are commonly the same EOA/multisig, but the two roles
 * live on different contracts and are transferred independently — do not confuse `transferAdmin`
 * (this op) with `transferOwnership`.
 *
 * @packageDocumentation
 */

import { ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'
import { getTokenAdminRegistryInterface, readTokenAdminRegistryConfig } from '../contracts.ts'

/**
 * Parameters for {@link TransferAdmin}.
 * @remarks `sender` is typed optional to satisfy `EVMOperation`'s shared shape, but is required
 * for {@link TransferAdmin.generate}: the pre-tx check below has nothing to compare
 * `administrator` against without it, so an omitted `sender` is rejected in
 * {@link TransferAdmin.parse}. {@link TransferAdmin.execute} relaxes this — it defaults
 * `sender` to the signing wallet's own address, the only address that can satisfy the
 * current-administrator check for a signed submission (see {@link TransferAdmin.execute}).
 */
export type TransferAdminParams = {
  /** Token whose registry admin role is being handed over. */
  tokenAddress: string
  /** The administrator proposed to accept the token's registry admin role. Pass {@link ZeroAddress}
   * to cancel any pending transfer — the pending proposal is discarded without accepting the role.
   */
  newAdmin: string
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a
   * direct lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and
   * need a configured lane.
   */
  address: string
  /**
   * Current registry administrator. Required for {@link TransferAdmin.generate}
   * (unsigned/offline flows) — `buildUnsigned` must read the registry and confirm the caller is
   * the current administrator *before* encoding a tx, so it needs to know who that caller is up
   * front. Optional for {@link TransferAdmin.execute}, which defaults it to the wallet's address
   * — see the remarks above.
   */
  sender?: string
}

/** {@link TransferAdminParams} as {@link TransferAdmin.parse} leaves it: `sender` present and checksummed. */
type ParsedTransferAdminParams = TransferAdminParams & { sender: string }

/**
 * Proposes a new TokenAdminRegistry administrator for a token via `transferAdminRole`.
 * Two-step by design: `newAdmin` must separately call `acceptAdmin` to complete the handoff —
 * this op alone does not change who can act as administrator.
 */
export class TransferAdmin extends EVMOperation<TransferAdminParams, ParsedTransferAdminParams> {
  readonly name = 'transferAdmin'

  /**
   * Validates all addresses before any RPC, including the presence of `sender` (see above), and
   * checksums `sender` so {@link buildUnsigned} can compare it against the registry's own
   * checksummed `administrator` without re-asserting it.
   */
  protected override parse(p: TransferAdminParams): ParsedTransferAdminParams {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'newAdmin', p.newAdmin)
    validateAddress(this.name, 'address', p.address)
    validateAddress(this.name, 'sender', p.sender)
    return { ...p, sender: getAddress(p.sender) }
  }

  /** Builds `transferAdminRole` calldata against the TAR resolved from `address`. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: ParsedTransferAdminParams,
  ): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    // TAR.transferAdminRole encoding is version-stable across v1.5–v2.0; no version dispatch needed.
    const data = getTokenAdminRegistryInterface().encodeFunctionData('transferAdminRole', [
      p.tokenAddress,
      p.newAdmin,
    ])
    chain.logger.debug(`${this.name}: registry = ${to}, token = ${p.tokenAddress}`)
    return callTx(to, data)
  }

  /**
   * Confirms the token has an accepted administrator and that `sender` is it.
   * @remarks Reported rather than thrown outright, which is the case this whole mechanism exists
   * for: `registerAdmin → acceptAdmin → transferAdmin` is one plan, and neither of the later two
   * could be built at all while the earlier ones were still unsigned.
   */
  protected override async preconditions(
    chain: EVMChain,
    p: ParsedTransferAdminParams,
  ): Promise<PreconditionError[]> {
    // `chain.getTokenAdminRegistryFor` is memoized, so this re-uses what `buildUnsigned` resolved
    // rather than reading `tx.transactions[0].to`, which is typed as a loose `AddressLike`.
    const registry = await chain.getTokenAdminRegistryFor(p.address)
    const { administrator, pendingAdministrator } = await readTokenAdminRegistryConfig(
      chain,
      registry,
      p.tokenAddress,
    )
    const pending = pendingAdministrator === ZeroAddress ? undefined : pendingAdministrator

    // Registration state is checked BEFORE comparing against `sender`, and deliberately so: an
    // unregistered token has a zero `administrator`, so an equality-first check would let
    // `sender: ZeroAddress` (which validateAddress permits) compare equal to it and report
    // nothing for a token that has no admin to transfer.
    if (administrator === ZeroAddress)
      return [
        {
          param: 'sender',
          reason: pending
            ? `registration for this token is still pending acceptance by ${pending}; the pending administrator must accept the admin role first — this operation only transfers an accepted role`
            : `token ${p.tokenAddress} is not registered in the TokenAdminRegistry at ${registry}; call registerAdmin first`,
        },
      ]
    if (administrator !== p.sender)
      return [
        { param: 'sender', reason: `must be the current token administrator (${administrator})` },
      ]
    return []
  }

  /**
   * Signs and submits as the current administrator, defaulting `sender` to the signing wallet —
   * the only address that can satisfy {@link preconditions}' current-administrator check for a
   * broadcast tx. See {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is
   * rejected rather than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, or
   * if any other param is invalid (see {@link buildUnsigned})
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<TransferAdminParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
