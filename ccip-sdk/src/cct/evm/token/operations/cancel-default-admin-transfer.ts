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
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  assertTokenDefaultAdmin,
  assertTokenOwner,
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

/** Pre-flights and encodes one version's retraction; `operation` attributes its errors. */
type Builder = (
  iface: Interface,
  chain: EVMChain,
  params: CancelDefaultAdminTransferParams,
  operation: string,
) => Promise<UnsignedEVMTx>

const buildV1: Builder = async (iface, chain, { tokenAddress, sender }, operation) => {
  if (sender !== undefined) await assertTokenOwner(operation, chain, tokenAddress, sender)
  return callTx(tokenAddress, iface.encodeFunctionData('transferOwnership', [ZeroAddress]))
}

const buildV2: Builder = async (iface, chain, { tokenAddress, sender }, operation) => {
  const { schedule } = await readPendingTokenDefaultAdmin(chain, tokenAddress)
  if (schedule === 0n)
    throw new CCTParamsInvalidError(
      operation,
      'tokenAddress',
      'has no pending default-admin transfer to cancel',
    )
  if (sender !== undefined) await assertTokenDefaultAdmin(operation, chain, tokenAddress, sender)
  return callTx(tokenAddress, iface.encodeFunctionData('cancelDefaultAdminTransfer', []))
}

const BUILDERS: Partial<Record<TokenVersion, Builder>> = {
  [TokenVersion.V1_5_1]: buildV1,
  [TokenVersion.V2_0_0]: buildV2,
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
  return build(getTokenInterface(version), chain, params, operation)
}

/** Retracts a pending token-admin transfer: v2 `cancelDefaultAdminTransfer`, v1 `transferOwnership(0x0)`. */
export class CancelDefaultAdminTransfer extends EVMOperation<CancelDefaultAdminTransferParams> {
  readonly name = 'cancelDefaultAdminTransfer'

  /** Validates the token address before any RPC. */
  protected override validate({ tokenAddress }: CancelDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
  }

  /**
   * Confirms, when known, that `sender` is the current admin (v2 default admin, v1 owner). On v2,
   * also confirms a transfer exists: OpenZeppelin would mine a cancel with nothing pending as a
   * silent no-op.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if no v2 transfer is pending or `sender` is not the admin
   */
  protected buildUnsigned(
    chain: EVMChain,
    params: CancelDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return buildCancelDefaultAdminTransfer(this.name, chain, params)
  }
}
