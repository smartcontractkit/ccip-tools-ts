/**
 * acceptDefaultAdminTransfer — completes a pending token-admin transfer: a CrossChainToken v2.0.0
 * after its mandatory AccessControlDefaultAdminRules delay, a v1.x `FactoryBurnMintERC20` via
 * Ownable2Step `acceptOwnership`.
 *
 * @remarks v1's pending owner is a `private` slot with no getter, so nothing about the caller is
 * pre-flighted there; a caller who is not the proposed owner simply reverts.
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
  /** Token whose pending admin transfer is being accepted. */
  tokenAddress: string
  /** Proposed admin; optional for offline signing, and checked when supplied on v2 only. */
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

/** Completes a token-admin transfer: v2 `acceptDefaultAdminTransfer`, v1 Ownable2Step `acceptOwnership`. */
export class AcceptDefaultAdminTransfer extends EVMOperation<AcceptDefaultAdminTransferParams> {
  /** Widened to `string` so the deprecated `AcceptTokenOwnership` alias can rename it. */
  readonly name: string = 'acceptDefaultAdminTransfer'

  /** Validates the token address before any RPC. */
  protected override prepare(
    params: AcceptDefaultAdminTransferParams,
  ): AcceptDefaultAdminTransferParams {
    const { tokenAddress } = params
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    return params
  }

  /**
   * On v2, confirms a transfer is pending and, when known, that `sender` is its proposed admin.
   * The contract also requires its schedule to have passed; that time-dependent check remains
   * on-chain so an unsigned tx may be signed for execution after the delay.
   *
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} if no v2 transfer is pending, it schedules renunciation,
   * or `sender` is not its pending default admin
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
