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
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'
import { getTokenAdminRegistryInterface, readTokenAdminRegistryConfig } from '../contracts.ts'

/** Parameters for {@link TransferAdmin}. */
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
   * Current registry administrator. Optional: omitting it skips the administrator check in
   * {@link TransferAdmin.buildUnsigned}, so a wrong signer only fails on-chain.
   * {@link TransferAdmin.execute} defaults it to the signing wallet.
   */
  sender?: string
}

/**
 * Proposes a new TokenAdminRegistry administrator for a token via `transferAdminRole`.
 * Two-step by design: `newAdmin` must separately call `acceptAdmin` to complete the handoff —
 * this op alone does not change who can act as administrator.
 */
export class TransferAdmin extends EVMOperation<TransferAdminParams> {
  readonly name = 'transferAdmin'

  /**
   * Validates all addresses before any RPC and, if given, checksums `sender` so
   * {@link buildUnsigned} can compare it against the registry's own checksummed `administrator`.
   */
  protected override prepare(p: TransferAdminParams): TransferAdminParams {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'newAdmin', p.newAdmin)
    validateAddress(this.name, 'address', p.address)
    if (p.sender === undefined) return p
    validateAddress(this.name, 'sender', p.sender)
    return { ...p, sender: getAddress(p.sender) }
  }

  /**
   * Reads the registry directly, confirms the token is registered and, if given, that `sender` is
   * the current administrator, then builds `transferAdminRole` calldata against the TAR resolved
   * from `address`.
   */
  protected async buildUnsigned(chain: EVMChain, p: TransferAdminParams): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    const { administrator, pendingAdministrator } = await readTokenAdminRegistryConfig(
      chain,
      to,
      p.tokenAddress,
    )

    const pending = pendingAdministrator === ZeroAddress ? undefined : pendingAdministrator

    // Registration state is checked BEFORE comparing against `sender`, and deliberately so: an
    // unregistered token has a zero `administrator`, so an equality-first check would let
    // `sender: ZeroAddress` (which validateAddress permits) compare equal to it and build a
    // `transferAdminRole` tx for a token that has no admin to transfer.
    if (administrator === ZeroAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        pending
          ? `registration for this token is still pending acceptance by ${pending}; the pending administrator must accept the admin role first — this operation only transfers an accepted role`
          : `token ${p.tokenAddress} is not registered in the TokenAdminRegistry at ${to}; call registerAdmin first`,
      )
    }
    // without `sender`, the registration check above is the only pre-flight
    if (p.sender !== undefined && administrator !== p.sender) {
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must be the current token administrator (${administrator})`,
      )
    }

    // TAR.transferAdminRole encoding is version-stable across v1.5–v2.0; no version dispatch needed.
    const data = getTokenAdminRegistryInterface().encodeFunctionData('transferAdminRole', [
      p.tokenAddress,
      p.newAdmin,
    ])
    chain.logger.debug(`${this.name}: registry = ${to}, token = ${p.tokenAddress}`)
    return callTx(to, data)
  }
}
