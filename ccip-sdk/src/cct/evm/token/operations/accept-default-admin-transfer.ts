/**
 * acceptDefaultAdminTransfer — completes a token-admin handoff proposed by
 * {@link BeginDefaultAdminTransfer}, called by the proposed admin.
 *
 * @remarks Dispatches on {@link resolveToken}. A CrossChainToken v2.0.0 encodes
 * `acceptDefaultAdminTransfer`, which mines only once the AccessControlDefaultAdminRules delay has
 * passed; its pending admin is public, so a missing transfer or a known wrong `sender` is rejected
 * before signing. A v1.x `FactoryBurnMintERC20` encodes Ownable2Step's `acceptOwnership`, with no
 * delay and nothing to pre-flight: the contract compares `msg.sender` against a `private`
 * pending-owner slot with no getter (in both `ConfirmedOwnerWithProposal` v1.5.1 and
 * `Ownable2Step` v1.6.2), so a caller who is not the proposed owner simply reverts.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  getTokenInterface,
  readPendingTokenDefaultAdmin,
  resolveToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link AcceptDefaultAdminTransfer}. */
export type AcceptDefaultAdminTransferParams = {
  /** v1.x `FactoryBurnMintERC20` or CrossChainToken v2.0.0 whose pending transfer is being accepted. */
  tokenAddress: string
  /**
   * Proposed admin; sets `tx.from` for offline signing. Checked against v2's pending default
   * admin when supplied; v1's pending owner cannot be read, so it is not checked there.
   */
  sender?: string
}

/** Pre-flights and encodes one version's acceptance; `operation` attributes its errors. */
type Builder = (
  iface: Interface,
  chain: EVMChain,
  params: AcceptDefaultAdminTransferParams,
  operation: string,
) => Promise<UnsignedEVMTx>

const buildV1: Builder = async (iface, _chain, { tokenAddress }) =>
  callTx(tokenAddress, iface.encodeFunctionData('acceptOwnership', []))

// The schedule having passed stays an on-chain check, so an unsigned tx may be signed for
// execution after the delay.
const buildV2: Builder = async (iface, chain, { tokenAddress, sender }, operation) => {
  const { newAdmin, schedule } = await readPendingTokenDefaultAdmin(chain, tokenAddress)
  if (schedule === 0n)
    throw new CCTParamsInvalidError(
      operation,
      'tokenAddress',
      `has no pending default-admin transfer`,
    )
  // A zero pending admin is the separate, deliberate renunciation path and cannot accept.
  if (newAdmin === ZeroAddress)
    throw new CCTParamsInvalidError(
      operation,
      'tokenAddress',
      'has a pending default-admin renunciation, which must be completed with renounceRole',
    )
  if (sender !== undefined && getAddress(sender) !== newAdmin)
    throw new CCTParamsInvalidError(
      operation,
      'sender',
      `must be the pending default admin (${newAdmin})`,
    )
  return callTx(tokenAddress, iface.encodeFunctionData('acceptDefaultAdminTransfer', []))
}

const BUILDERS: Partial<Record<TokenVersion, Builder>> = {
  [TokenVersion.V1_5_1]: buildV1,
  [TokenVersion.V2_0_0]: buildV2,
}

/** Completes a token-admin handoff: v2 `acceptDefaultAdminTransfer`, v1 Ownable2Step `acceptOwnership`. */
export class AcceptDefaultAdminTransfer extends EVMOperation<AcceptDefaultAdminTransferParams> {
  /** Widened to `string` so the deprecated `AcceptTokenOwnership` alias can rename it. */
  readonly name: string = 'acceptDefaultAdminTransfer'

  /** Validates the token address before any RPC. */
  protected override validate({ tokenAddress }: AcceptDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
  }

  /**
   * Resolves the token version, then pre-flights it. v2 confirms a transfer is pending, is not a
   * renunciation, and, when known, names `sender`. v1 reads nothing beyond the version.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if v2 has no pending transfer, it schedules
   * renunciation, or `sender` is not its pending default admin
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: AcceptDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveToken(chain, params.tokenAddress)
    const build = resolveTokenEncoder(BUILDERS, version, this.name)
    return build(getTokenInterface(version), chain, params, this.name)
  }
}
