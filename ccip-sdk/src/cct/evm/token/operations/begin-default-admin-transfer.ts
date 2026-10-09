/**
 * beginDefaultAdminTransfer — proposes a new token admin. A CrossChainToken v2.0.0 schedules a
 * default-admin transfer, accepted after the contract's configured delay; a v1.x
 * `FactoryBurnMintERC20` encodes Ownable2Step `transferOwnership`, accepted immediately.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type PreconditionError, CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  checkTokenDefaultAdmin,
  checkTokenOwnershipTransfer,
  getTokenInterface,
  resolveToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link BeginDefaultAdminTransfer}. */
export type BeginDefaultAdminTransferParams = {
  /** Token whose admin is being transferred. */
  tokenAddress: string
  /**
   * Proposed admin. On v2, zero schedules renunciation through `renounceRole`; on v1, where a zero
   * proposal would retract instead, it is rejected.
   */
  newAdmin: string
  /** Current admin (v1 owner, v2 default admin); optional for offline signing and checked when supplied. */
  sender?: string
}

/** Encodes one version's proposal; `operation` / `param` attribute its errors. */
type Builder = (
  iface: Interface,
  params: BeginDefaultAdminTransferParams,
  operation: string,
  param: string,
) => UnsignedEVMTx

/** Reports one version's unmet on-chain requirements; `operation` / `param` attribute them. */
type Checker = (
  chain: EVMChain,
  params: BeginDefaultAdminTransferParams,
  operation: string,
  param: string,
) => Promise<PreconditionError[]>

const buildV1: Builder = (iface, { tokenAddress, newAdmin }, operation, param) => {
  if (getAddress(newAdmin) === ZeroAddress)
    throw new CCTParamsInvalidError(
      operation,
      param,
      'must be non-zero on a v1 Ownable2Step token, where a zero proposal retracts the pending transfer instead of renouncing — use cancelDefaultAdminTransfer to retract it',
    )
  return callTx(tokenAddress, iface.encodeFunctionData('transferOwnership', [newAdmin]))
}

const buildV2: Builder = (iface, { tokenAddress, newAdmin }) =>
  callTx(tokenAddress, iface.encodeFunctionData('beginDefaultAdminTransfer', [newAdmin]))

const checkV1: Checker = (chain, { tokenAddress, newAdmin, sender }, _operation, param) =>
  checkTokenOwnershipTransfer(chain, tokenAddress, newAdmin, sender, param)

const checkV2: Checker = async (chain, { tokenAddress, sender }, operation) =>
  unmet(await checkTokenDefaultAdmin(operation, chain, tokenAddress, sender))

const BUILDERS: Partial<Record<TokenVersion, Builder>> = {
  [TokenVersion.V1_5_1]: buildV1,
  [TokenVersion.V2_0_0]: buildV2,
}

const CHECKERS: Partial<Record<TokenVersion, Checker>> = {
  [TokenVersion.V1_5_1]: checkV1,
  [TokenVersion.V2_0_0]: checkV2,
}

/**
 * Resolves the token version and builds its proposal. Shared with the deprecated
 * `TransferTokenOwnership`, which reports errors under its own `operation` and `newAdminParam`.
 */
export async function buildBeginDefaultAdminTransfer(
  operation: string,
  chain: EVMChain,
  params: BeginDefaultAdminTransferParams,
  newAdminParam = 'newAdmin',
): Promise<UnsignedEVMTx> {
  const version = await resolveToken(chain, params.tokenAddress)
  const build = resolveTokenEncoder(BUILDERS, version, operation)
  return build(getTokenInterface(version), params, operation, newAdminParam)
}

/**
 * Resolves the token version and reports its unmet requirements. The precondition counterpart of
 * {@link buildBeginDefaultAdminTransfer}, shared with `TransferTokenOwnership` the same way.
 */
export async function checkBeginDefaultAdminTransfer(
  operation: string,
  chain: EVMChain,
  params: BeginDefaultAdminTransferParams,
  newAdminParam = 'newAdmin',
): Promise<PreconditionError[]> {
  const version = await resolveToken(chain, params.tokenAddress)
  const check = resolveTokenEncoder(CHECKERS, version, operation)
  return check(chain, params, operation, newAdminParam)
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
   * Resolves the token version and encodes its proposal.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if a v1 `newAdmin` is zero
   */
  protected buildUnsigned(
    chain: EVMChain,
    params: BeginDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return buildBeginDefaultAdminTransfer(this.name, chain, params)
  }

  /**
   * Confirms the current admin (v2 `defaultAdmin()`, v1 `owner()`) and, when known, that `sender`
   * is it; v1 also reports a `newAdmin` that already owns the token. On v2, OpenZeppelin permits
   * replacing an existing pending transfer and permits the zero-address proposal used for
   * renunciation, so neither is reported.
   * @remarks Reported rather than thrown outright so this can be planned behind the step that
   * makes `sender` the admin. A renounced v2 admin stays fatal.
   * @throws {@link CCTParamsInvalidError} if a v2 token has no default admin
   */
  protected override preconditions(
    chain: EVMChain,
    params: BeginDefaultAdminTransferParams,
  ): Promise<PreconditionError[]> {
    return checkBeginDefaultAdminTransfer(this.name, chain, params)
  }
}
