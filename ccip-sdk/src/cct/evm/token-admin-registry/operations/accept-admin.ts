/**
 * acceptAdmin — accepts a pending TokenAdminRegistry administrator role for a token.
 * Second half of the two-step admin handshake: `registerAdmin` (fresh registration) or
 * `transferAdmin` (existing-admin hand-off) first proposes an address as
 * `pendingAdministrator`; that address then calls `acceptAdmin` to become `administrator`,
 * after which `setPool` is callable. Version-independent (v1.5–v2.0 share one encoding).
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

/** Parameters for `acceptAdmin`. */
export type AcceptAdminParams = {
  /** Token whose pending registry admin role is being accepted. */
  tokenAddress: string
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a
   * direct lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and
   * need a configured lane.
   */
  address: string
  /**
   * Pending administrator accepting the role. Optional: omitting it skips the
   * pending-administrator check in {@link AcceptAdmin.buildUnsigned}, so a wrong signer only fails
   * on-chain. {@link AcceptAdmin.execute} defaults it to the signing wallet.
   */
  sender?: string
}

/** Accepts a pending TokenAdminRegistry administrator role for a token. */
export class AcceptAdmin extends EVMOperation<AcceptAdminParams> {
  readonly name = 'acceptAdmin'

  /**
   * Validates all addresses before any RPC and, if given, checksums `sender` so
   * {@link buildUnsigned} can compare it against the registry's own checksummed
   * `pendingAdministrator`.
   */
  protected override prepare(p: AcceptAdminParams): AcceptAdminParams {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'address', p.address)
    if (p.sender === undefined) return p
    validateAddress(this.name, 'sender', p.sender)
    return { ...p, sender: getAddress(p.sender) }
  }

  /**
   * Confirms an administrator is pending and, if given, that it is `sender`, then builds
   * `acceptAdminRole` calldata against the TokenAdminRegistry resolved from `address`.
   */
  protected async buildUnsigned(chain: EVMChain, p: AcceptAdminParams): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    const { administrator, pendingAdministrator } = await readTokenAdminRegistryConfig(
      chain,
      to,
      p.tokenAddress,
    )

    if (pendingAdministrator === ZeroAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `no administrator is pending for this token (current administrator: ${administrator}) — nothing to accept`,
      )
    }
    // without `sender`, the pending check above is the only pre-flight
    if (p.sender !== undefined && pendingAdministrator !== p.sender) {
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must be the pending token administrator (${pendingAdministrator})`,
      )
    }

    // TAR.acceptAdminRole encoding is version-stable across v1.5–v2.0; no version dispatch needed.
    const data = getTokenAdminRegistryInterface().encodeFunctionData('acceptAdminRole', [
      p.tokenAddress,
    ])
    return callTx(to, data)
  }
}
