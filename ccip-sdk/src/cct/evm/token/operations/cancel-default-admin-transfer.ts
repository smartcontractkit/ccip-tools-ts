/**
 * cancelDefaultAdminTransfer — retracts a pending token-admin proposal made by
 * {@link BeginDefaultAdminTransfer}. Only the current admin may retract it.
 *
 * @remarks Dispatches on {@link resolveToken}. A CrossChainToken v2.0.0 encodes
 * `cancelDefaultAdminTransfer`, and the public pending slot lets a cancel with nothing pending be
 * rejected before signing. A v1.x `FactoryBurnMintERC20` encodes Ownable2Step's
 * `transferOwnership(0x0)`, parking the pending owner on an address nobody can sign as. Its
 * pending owner is a `private` slot with no getter, so whether anything was pending is not
 * checked.
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
  /** v1.x `FactoryBurnMintERC20` or CrossChainToken v2.0.0 whose pending transfer is being retracted. */
  tokenAddress: string
  /** Current admin (v1 `owner()`, v2 default admin); optional for offline signing and checked when supplied. */
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

// OpenZeppelin mines a cancel with nothing pending as a silent no-op; it is rejected here instead.
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
 * Resolves the token version and builds its retraction; the shared body of
 * {@link CancelDefaultAdminTransfer} and the deprecated `TransferTokenOwnership` alias's
 * zero-`newOwner` path.
 * @param operation - Operation name, for errors' `operation` field.
 * @param chain - Chain to resolve and pre-flight against.
 * @param params - Validated params.
 * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown version
 * @throws {@link CCTParamsInvalidError} per {@link CancelDefaultAdminTransfer}'s pre-flights
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

/** Retracts a pending token-admin proposal: v2 `cancelDefaultAdminTransfer`, v1 `transferOwnership(0x0)`. */
export class CancelDefaultAdminTransfer extends EVMOperation<CancelDefaultAdminTransferParams> {
  readonly name = 'cancelDefaultAdminTransfer'

  /** Validates the token address before any RPC. */
  protected override validate({ tokenAddress }: CancelDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
  }

  /**
   * Resolves the token version, then pre-flights it. v2 confirms a transfer is pending and, when
   * `sender` is known, that it is the current default admin. v1 checks a known `sender` against
   * `owner()`.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if v2 has no pending transfer or no default admin, or
   * `sender` is not the current admin (either version)
   */
  protected buildUnsigned(
    chain: EVMChain,
    params: CancelDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    return buildCancelDefaultAdminTransfer(this.name, chain, params)
  }
}
