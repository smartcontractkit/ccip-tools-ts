/**
 * beginDefaultAdminTransfer — proposes a new token admin, step 1 of a two-step handoff completed
 * by {@link AcceptDefaultAdminTransfer} and retracted by {@link CancelDefaultAdminTransfer}.
 *
 * @remarks Dispatches on {@link resolveToken}. A CrossChainToken v2.0.0 schedules an
 * AccessControlDefaultAdminRules transfer (`beginDefaultAdminTransfer`), acceptable only once the
 * contract's configured delay has passed. A v1.x `FactoryBurnMintERC20` encodes Ownable2Step's
 * `transferOwnership`, acceptable immediately. Either way nothing changes on-chain until the
 * proposed admin accepts.
 *
 * @remarks `newAdmin = 0x0` is v2-only: there it schedules renunciation, completed with
 * `renounceRole`. On v1 a zero proposal would instead retract the pending transfer, so it is
 * rejected rather than silently mapped to different semantics; retract with
 * {@link CancelDefaultAdminTransfer}.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  assertTokenDefaultAdmin,
  assertTokenOwnershipTransfer,
  getTokenInterface,
  resolveToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link BeginDefaultAdminTransfer}. */
export type BeginDefaultAdminTransferParams = {
  /** v1.x `FactoryBurnMintERC20` or CrossChainToken v2.0.0 whose admin is being transferred. */
  tokenAddress: string
  /**
   * Proposed admin; it gains nothing until it accepts. On v2, zero schedules renunciation; on v1
   * it must be non-zero and differ from the current owner.
   */
  newAdmin: string
  /** Current admin (v1 `owner()`, v2 default admin); optional for offline signing and checked when supplied. */
  sender?: string
}

/**
 * Pre-flights and encodes one version's proposal. `operation` / `param` attribute its errors, so
 * the deprecated `transferTokenOwnership` alias reports its own name and `newOwner`.
 */
type Builder = (
  iface: Interface,
  chain: EVMChain,
  params: BeginDefaultAdminTransferParams,
  operation: string,
  param: string,
) => Promise<UnsignedEVMTx>

const buildV1: Builder = async (
  iface,
  chain,
  { tokenAddress, newAdmin, sender },
  operation,
  param,
) => {
  if (getAddress(newAdmin) === ZeroAddress)
    throw new CCTParamsInvalidError(
      operation,
      param,
      'must be non-zero on a v1 Ownable2Step token, where a zero proposal retracts the pending transfer instead of renouncing — use cancelDefaultAdminTransfer to retract it',
    )
  await assertTokenOwnershipTransfer(operation, chain, tokenAddress, newAdmin, sender, param)
  return callTx(tokenAddress, iface.encodeFunctionData('transferOwnership', [newAdmin]))
}

// OpenZeppelin permits replacing a pending transfer and the zero-address renunciation proposal,
// so neither is rejected here.
const buildV2: Builder = async (iface, chain, { tokenAddress, newAdmin, sender }, operation) => {
  await assertTokenDefaultAdmin(operation, chain, tokenAddress, sender)
  return callTx(tokenAddress, iface.encodeFunctionData('beginDefaultAdminTransfer', [newAdmin]))
}

const BUILDERS: Partial<Record<TokenVersion, Builder>> = {
  [TokenVersion.V1_5_1]: buildV1,
  [TokenVersion.V2_0_0]: buildV2,
}

/**
 * Resolves the token version and builds its proposal; the shared body of
 * {@link BeginDefaultAdminTransfer} and the deprecated `TransferTokenOwnership` alias.
 * @param operation - Operation name, for errors' `operation` field.
 * @param chain - Chain to resolve and pre-flight against.
 * @param params - Validated params.
 * @param newAdminParam - Param name `newAdmin` is reported under.
 * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown version
 * @throws {@link CCTParamsInvalidError} per {@link BeginDefaultAdminTransfer}'s pre-flights
 */
export async function buildBeginDefaultAdminTransfer(
  operation: string,
  chain: EVMChain,
  params: BeginDefaultAdminTransferParams,
  newAdminParam = 'newAdmin',
): Promise<UnsignedEVMTx> {
  const version = await resolveToken(chain, params.tokenAddress)
  const build = resolveTokenEncoder(BUILDERS, version, operation)
  return build(getTokenInterface(version), chain, params, operation, newAdminParam)
}

/** Proposes a new token admin: v2 `beginDefaultAdminTransfer`, v1 Ownable2Step `transferOwnership`. */
export class BeginDefaultAdminTransfer extends EVMOperation<BeginDefaultAdminTransferParams> {
  readonly name = 'beginDefaultAdminTransfer'

  /** Validates addresses before any RPC. Zero `newAdmin` is version-dependent, so checked later. */
  protected override validate({ tokenAddress, newAdmin }: BeginDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateAddress(this.name, 'newAdmin', newAdmin)
  }

  /**
   * Resolves the token version, then pre-flights it. v2 confirms the token has a default admin
   * and, when known, that `sender` is it. v1 rejects a zero `newAdmin`, then reads `owner()`:
   * `sender`, when known, must be it, and `newAdmin` must not (`CannotTransferToSelf`).
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if v2 has no default admin or `sender` is not it, or if
   * v1 `newAdmin` is zero or the current owner, or `sender` is not the owner
   */
  protected buildUnsigned(
    chain: EVMChain,
    params: BeginDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return buildBeginDefaultAdminTransfer(this.name, chain, params)
  }
}
