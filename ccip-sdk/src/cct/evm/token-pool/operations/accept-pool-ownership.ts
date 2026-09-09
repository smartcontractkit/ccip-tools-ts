/**
 * acceptPoolOwnership — completes a pending TokenPool ownership transfer (step 2 of Ownable2Step;
 * {@link TransferPoolOwnership} is step 1).
 *
 * @remarks Called by the **proposed** owner, not the current one, so unlike every other pool write
 * in this module it is not owner-gated and pre-flights nothing about the caller. The contract
 * compares `msg.sender` against `s_pendingOwner`, which is `private` with no getter in both
 * `ConfirmedOwnerWithProposal` (v1.5.x) and `Ownable2Step` (v1.6.1+) — there is no read that could
 * confirm the caller is the proposed owner, so a caller who is not simply reverts
 * (`MustBeProposedOwner`, or `Must be proposed owner` on v1.5.x).
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link AcceptPoolOwnership}. */
export type AcceptPoolOwnershipParams = {
  /** Token pool whose pending ownership transfer is being completed. Must be non-zero — it is the
   * tx `to`, and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /** The proposed owner. Sets `tx.from` for offline / multisig signing, and is not checked
   * against the chain, per the module remark. {@link AcceptPoolOwnership.execute} defaults it to
   * the signing wallet. */
  sender?: string
}

/** Encodes `acceptOwnership` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: AcceptPoolOwnershipParams) => UnsignedEVMTx

const encodeAcceptOwnership: Encoder = (iface, { poolAddress }) =>
  callTx(poolAddress, iface.encodeFunctionData('acceptOwnership', []))

/** Completes a pending TokenPool ownership transfer via Ownable2Step `acceptOwnership`. */
export class AcceptPoolOwnership extends EVMOperation<AcceptPoolOwnershipParams> {
  readonly name = 'acceptPoolOwnership'

  /**
   * Stable across pool versions: one V1_5_0 entry covers all via floor-match, with no `null`
   * ceiling — `acceptOwnership()` takes no arguments and survived into v2.0.0 unchanged.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder>> = {
    [TokenPoolVersion.V1_5_0]: encodeAcceptOwnership,
  }

  /** Validates the pool address before any RPC; there is no other parameter to check. */
  protected override validate({ poolAddress }: AcceptPoolOwnershipParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
  }

  /**
   * Reads the pool's type-and-version, then floor-matches the encoder and its interface.
   * @remarks The resolution is not needed for the encoding — `acceptOwnership()` is one fixed
   * selector — but it is the check that `poolAddress` is a supported CCT pool at all, so a token
   * or registry address passed here is named as such instead of producing calldata that reverts.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: AcceptPoolOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Signs and submits as the proposed owner, defaulting `sender` to the signing wallet.
   * @remarks The contract authorizes on `msg.sender`, so the wallet *is* the address that must be
   * the proposed owner; see {@link EVMOperation.resolveWalletSender}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain — notably when the wallet is
   * not the pool's proposed owner, which cannot be checked before signing
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<AcceptPoolOwnershipParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
