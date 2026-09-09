/**
 * transferPoolOwnership — proposes a new TokenPool owner (step 1 of Ownable2Step; the proposed
 * owner completes it with {@link AcceptPoolOwnership}).
 *
 * @remarks Named for its target rather than for the selector it encodes, to keep it apart from
 * {@link TransferTokenOwnership} — the two write the same `transferOwnership(address)` calldata to
 * different contracts — and from `transferAdmin`, which moves the registry's administrator role.
 *
 * @remarks Nothing changes on-chain until the proposed owner accepts: this only writes
 * `s_pendingOwner`, and the current owner keeps every privilege until then.
 *
 * @packageDocumentation
 */

import { type Interface, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link TransferPoolOwnership}. */
export type TransferPoolOwnershipParams = {
  /** Token pool whose ownership is being proposed away. Must be non-zero — it is the tx `to`, and
   * a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * Address to propose as the next owner. It gains nothing until it calls `acceptOwnership`.
   *
   * @remarks The zero address is **allowed** and meaningful: `Ownable2Step` bounds only the
   * *constructor* owner away from `0x0`, so proposing it here parks `s_pendingOwner` on an address
   * nobody can sign as, which is how a mistaken proposal is retracted. The one address the
   * contract rejects is the caller's own (`CannotTransferToSelf`), checked below when `sender` is
   * known.
   */
  newOwner: string
  /**
   * The current pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is
   * checked against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link TransferPoolOwnership.generate} (an offline builder may not yet know the signer);
   * {@link TransferPoolOwnership.execute} defaults it to the signing wallet, so the owner check
   * always runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `transferOwnership` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: TransferPoolOwnershipParams) => UnsignedEVMTx

const encodeTransferOwnership: Encoder = (iface, { poolAddress, newOwner }) =>
  callTx(poolAddress, iface.encodeFunctionData('transferOwnership', [newOwner]))

/** Proposes a new TokenPool owner via Ownable2Step `transferOwnership`. Owner-only. */
export class TransferPoolOwnership extends EVMOperation<TransferPoolOwnershipParams> {
  readonly name = 'transferPoolOwnership'

  /**
   * Stable across pool versions: one V1_5_0 entry covers all via floor-match, with no `null`
   * ceiling — `transferOwnership(address)` reached v2.0.0 unchanged. Only the base contract behind
   * it was renamed (`ConfirmedOwnerWithProposal` → `Ownable2Step`), swapping revert strings for
   * custom errors without touching the selector or its semantics.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder>> = {
    [TokenPoolVersion.V1_5_0]: encodeTransferOwnership,
  }

  /**
   * Validates both addresses and, when `sender` is known, rejects a self-transfer — the single
   * bound the contract puts on `newOwner`, and free to catch here.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is zero or malformed, `newOwner` is
   * malformed, or `newOwner` equals `sender`
   */
  protected override validate({
    poolAddress,
    newOwner,
    sender,
  }: TransferPoolOwnershipParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'newOwner', newOwner)
    if (sender === undefined) return
    // `generate` validates `sender` only after this hook, so the comparison below would otherwise
    // run on an unvalidated string and leak a raw ethers error for a malformed one.
    validateAddress(this.name, 'sender', sender)
    if (getAddress(newOwner) === getAddress(sender))
      throw new CCTParamsInvalidError(
        this.name,
        'newOwner',
        `must differ from sender (${sender}) — the pool already has that owner and would revert CannotTransferToSelf`,
      )
  }

  /**
   * Reads the pool's type-and-version, floor-matches the encoder and its interface, then confirms
   * `sender` (when given) is the pool owner.
   * @remarks The owner check lives here, not only in {@link execute}, so the offline / multisig
   * path gets it too: `generateUnsignedTransferPoolOwnership` with an unauthorized `sender` would
   * otherwise hand back a fully-formed transaction that reverts only after being reviewed and
   * signed. Every sibling owner-gated pool write gates in `buildUnsigned` for the same reason.
   * @throws {@link CCTContractTypeInvalidError} if `poolAddress` is not a supported pool type
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: TransferPoolOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)
    return unsigned
  }

  /**
   * Signs and submits as the current pool owner, defaulting `sender` to the signing wallet — the
   * only address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather than
   * signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, or
   * is not the pool owner, or equals `newOwner`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<TransferPoolOwnershipParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
