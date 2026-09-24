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
import type { TransactionResult } from '../../../operation.ts'
import {
  type EVMExecuteParams,
  type PreflightParams,
  EVMOperation,
  callTx,
} from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import { getTokenAdminRegistryInterface, readTokenAdminRegistryConfig } from '../contracts.ts'

/**
 * Parameters for `acceptAdmin`.
 * @remarks `sender` is typed optional to satisfy `EVMOperation`'s shared shape, but is required
 * for {@link AcceptAdmin.generate}: the pending-administrator check below has nothing to compare
 * against without it, so an omitted `sender` is rejected in {@link AcceptAdmin.parse}.
 * {@link AcceptAdmin.execute} relaxes this — it defaults `sender` to the signing wallet's own
 * address, since that is the only address that can ever satisfy the pending-administrator check
 * for a signed submission (see {@link AcceptAdmin.execute}).
 */
export type AcceptAdminParams = PreflightParams & {
  /** Token whose pending registry admin role is being accepted. */
  tokenAddress: string
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a
   * direct lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and
   * need a configured lane.
   */
  address: string
  /**
   * Pending administrator accepting the role. Required for {@link AcceptAdmin.generate}
   * (unsigned/offline flows); optional for {@link AcceptAdmin.execute}, which defaults it to
   * the wallet's address — see the remarks above.
   */
  sender?: string
}

/** {@link AcceptAdminParams} as {@link AcceptAdmin.parse} leaves it: `sender` present and checksummed. */
type ParsedAcceptAdminParams = AcceptAdminParams & { sender: string }

/** Accepts a pending TokenAdminRegistry administrator role for a token. */
export class AcceptAdmin extends EVMOperation<AcceptAdminParams, ParsedAcceptAdminParams> {
  readonly name = 'acceptAdmin'

  /**
   * Validates all addresses before any RPC — `sender` is required here (unlike the base
   * `EVMOperation` shape), see the {@link AcceptAdminParams} remarks — and checksums `sender` so
   * {@link buildUnsigned} can compare it against the registry's own checksummed
   * `pendingAdministrator` without re-asserting it.
   */
  protected override parse(p: AcceptAdminParams): ParsedAcceptAdminParams {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'address', p.address)
    validateAddress(this.name, 'sender', p.sender)
    // Non-zero as well as well-formed, and checked here rather than left to the comparison in
    // `buildUnsigned`: that comparison was the only thing rejecting a zero `sender` — which
    // `isAddress` accepts in its ICAP spelling — and it stops rejecting anything under
    // `preflight: 'report'`. A zero `sender` is a bad parameter, not chain state, so it belongs
    // here where both modes throw.
    validateNonZeroAddress(this.name, 'sender', p.sender)
    return { ...p, sender: getAddress(p.sender) }
  }

  /**
   * Builds `acceptAdminRole` calldata against the TokenAdminRegistry resolved from `address`,
   * checking `sender` against the registry's pending administrator. A mismatch throws, or is
   * attached to the returned tx under `preflight: 'report'` — see
   * {@link EVMOperation.recordPreflight}.
   */
  protected async buildUnsigned(
    chain: EVMChain,
    p: ParsedAcceptAdminParams,
  ): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    const { administrator, pendingAdministrator } = await readTokenAdminRegistryConfig(
      chain,
      to,
      p.tokenAddress,
    )

    // TAR.acceptAdminRole encoding is version-stable across v1.5–v2.0; no version dispatch needed.
    const data = getTokenAdminRegistryInterface().encodeFunctionData('acceptAdminRole', [
      p.tokenAddress,
    ])
    const tx = callTx(to, data)

    // Pre-flight, not calldata: `acceptAdminRole(token)` is correct and complete regardless of who
    // is pending right now. Whether the registry is ready is a question about *when* this gets
    // submitted, and `registerAdmin`/`transferAdmin` earlier in the same plan is the usual reason
    // it is not ready yet — which is what `preflight: 'report'` is for. `execute` rejects either
    // way.
    if (pendingAdministrator === ZeroAddress) {
      return this.recordPreflight(tx, p.preflight, {
        param: 'sender',
        reason: `no administrator is pending for this token (current administrator: ${administrator}) — nothing to accept`,
      })
    }
    return this.recordPreflight(
      tx,
      p.preflight,
      pendingAdministrator === p.sender
        ? undefined
        : {
            param: 'sender',
            reason: `must be the pending token administrator (${pendingAdministrator})`,
          },
    )
  }

  /**
   * Signs and submits as the pending administrator, defaulting `sender` to the signing wallet —
   * the only address that can satisfy {@link buildUnsigned}'s pending-administrator check for a
   * broadcast tx. See {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is
   * rejected rather than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, or
   * if the registry does not currently satisfy a requirement {@link buildUnsigned} recorded
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<AcceptAdminParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
