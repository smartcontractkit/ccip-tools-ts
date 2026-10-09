/**
 * cancelDefaultAdminTransfer — retracts a pending token-admin transfer: a CrossChainToken v2.0.0
 * via `cancelDefaultAdminTransfer`, a v1.x `FactoryBurnMintERC20` via Ownable2Step
 * `transferOwnership(0x0)`. Only the current admin may retract it.
 *
 * @remarks v1's pending owner has no getter, so whether anything was pending is not checked there.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  checkTokenDefaultAdmin,
  checkTokenOwner,
  getTokenInterface,
  readPendingTokenDefaultAdmin,
  resolveToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link CancelDefaultAdminTransfer}. */
export type CancelDefaultAdminTransferParams = {
  /** Token whose pending admin transfer is being canceled. */
  tokenAddress: string
  /** Current admin (v1 owner, v2 default admin); optional for offline signing and checked when supplied. */
  sender?: string
}

/** Encodes one version's retraction. */
type Builder = (iface: Interface, params: CancelDefaultAdminTransferParams) => UnsignedEVMTx

/** Reports one version's unmet on-chain requirements; `operation` attributes them. */
type Checker = (
  chain: EVMChain,
  params: CancelDefaultAdminTransferParams,
  operation: string,
) => Promise<PreconditionError[]>

const buildV1: Builder = (iface, { tokenAddress }) =>
  callTx(tokenAddress, iface.encodeFunctionData('transferOwnership', [ZeroAddress]))

const buildV2: Builder = (iface, { tokenAddress }) =>
  callTx(tokenAddress, iface.encodeFunctionData('cancelDefaultAdminTransfer', []))

const checkV1: Checker = async (chain, { tokenAddress, sender }) =>
  sender === undefined ? [] : unmet(await checkTokenOwner(chain, tokenAddress, sender))

const checkV2: Checker = async (chain, { tokenAddress, sender }, operation) => {
  const [{ schedule }, admin] = await Promise.all([
    readPendingTokenDefaultAdmin(chain, tokenAddress),
    sender === undefined
      ? undefined
      : checkTokenDefaultAdmin(operation, chain, tokenAddress, sender),
  ])
  return unmet(
    schedule === 0n
      ? { param: 'tokenAddress', reason: 'has no pending default-admin transfer to cancel' }
      : undefined,
    admin,
  )
}

const BUILDERS: Partial<Record<TokenVersion, Builder>> = {
  [TokenVersion.V1_5_1]: buildV1,
  [TokenVersion.V2_0_0]: buildV2,
}

const CHECKERS: Partial<Record<TokenVersion, Checker>> = {
  [TokenVersion.V1_5_1]: checkV1,
  [TokenVersion.V2_0_0]: checkV2,
}

/**
 * Resolves the token version and builds its retraction. Shared with the deprecated
 * `TransferTokenOwnership` (zero `newOwner`), which reports errors under its own `operation`.
 */
export async function buildCancelDefaultAdminTransfer(
  operation: string,
  chain: EVMChain,
  params: CancelDefaultAdminTransferParams,
): Promise<UnsignedEVMTx> {
  const version = await resolveToken(chain, params.tokenAddress)
  const build = resolveTokenEncoder(BUILDERS, version, operation)
  return build(getTokenInterface(version), params)
}

/**
 * Resolves the token version and reports its unmet requirements. The precondition counterpart of
 * {@link buildCancelDefaultAdminTransfer}, shared with `TransferTokenOwnership` the same way.
 */
export async function checkCancelDefaultAdminTransfer(
  operation: string,
  chain: EVMChain,
  params: CancelDefaultAdminTransferParams,
): Promise<PreconditionError[]> {
  const version = await resolveToken(chain, params.tokenAddress)
  const check = resolveTokenEncoder(CHECKERS, version, operation)
  return check(chain, params, operation)
}

/** Retracts a pending token-admin transfer: v2 `cancelDefaultAdminTransfer`, v1 `transferOwnership(0x0)`. */
export class CancelDefaultAdminTransfer extends EVMOperation<CancelDefaultAdminTransferParams> {
  readonly name = 'cancelDefaultAdminTransfer'

  /** Validates the token address before any RPC. */
  protected override validate({ tokenAddress }: CancelDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
  }

  /**
   * Resolves the token version and encodes its retraction.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   */
  protected buildUnsigned(
    chain: EVMChain,
    params: CancelDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return buildCancelDefaultAdminTransfer(this.name, chain, params)
  }

  /**
   * Confirms, when known, that `sender` is the current admin (v2 default admin, v1 owner). On v2,
   * also confirms a transfer exists: OpenZeppelin would mine a cancel with nothing pending as a
   * silent no-op.
   * @remarks Reported rather than thrown outright: `beginDefaultAdminTransfer` in an earlier step
   * creates the pending transfer this one cancels.
   */
  protected override preconditions(
    chain: EVMChain,
    params: CancelDefaultAdminTransferParams,
  ): Promise<PreconditionError[]> {
    return checkCancelDefaultAdminTransfer(this.name, chain, params)
  }
}
