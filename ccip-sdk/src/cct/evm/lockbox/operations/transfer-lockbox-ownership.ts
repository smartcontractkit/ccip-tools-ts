/**
 * transferLockboxOwnership: proposes a new `ERC20LockBox` (v2.0.0) owner (step 1 of Ownable2Step;
 * the proposed owner completes it with {@link AcceptLockboxOwnership}).
 * Mirrors `token-pool/operations/transfer-pool-ownership.ts`.
 *
 * @remarks Nothing changes on-chain until the proposed owner accepts: this only writes
 * `s_pendingOwner`, and the current owner keeps every privilege until then.
 *
 * @packageDocumentation
 */

import { getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import { LOCKBOX_INTERFACE, assertLockbox, readLockboxOwner } from '../contracts.ts'

/** Parameters for {@link TransferLockboxOwnership}. */
export type TransferLockboxOwnershipParams = {
  /** Address of the `ERC20LockBox` whose ownership is being proposed away. */
  lockbox: string
  /**
   * Address to propose as the next owner. It gains nothing until it calls `acceptOwnership`.
   * @remarks The zero address is allowed: it parks `s_pendingOwner` on an address nobody can sign
   * as, which is how a mistaken proposal is retracted. The current owner is rejected, since the
   * lockbox would revert `CannotTransferToSelf`.
   */
  newOwner: string
  /**
   * The current lockbox owner. Sets `tx.from` for offline / multisig signing, and when supplied is
   * checked against the lockbox's on-chain `owner()`. {@link TransferLockboxOwnership.execute}
   * defaults it to the signing wallet.
   */
  sender?: string
}

/** Proposes a new `ERC20LockBox` owner via Ownable2Step `transferOwnership`. Owner-only. */
export class TransferLockboxOwnership extends EVMOperation<TransferLockboxOwnershipParams> {
  readonly name = 'transferLockboxOwnership'

  /**
   * Validates the addresses and, when `sender` is known, rejects a self-transfer.
   * @throws {@link CCTParamsInvalidError} if `lockbox` is zero or malformed, `newOwner` is
   * malformed, or `newOwner` equals `sender`
   */
  protected override prepare(
    params: TransferLockboxOwnershipParams,
  ): TransferLockboxOwnershipParams {
    const { lockbox, newOwner, sender } = params
    validateNonZeroAddress(this.name, 'lockbox', lockbox)
    validateAddress(this.name, 'newOwner', newOwner)
    if (sender === undefined) return params
    // `generate` validates `sender` only after this hook, so validate it before comparing.
    validateAddress(this.name, 'sender', sender)
    if (getAddress(newOwner) === getAddress(sender))
      throw new CCTParamsInvalidError(
        this.name,
        'newOwner',
        `must differ from sender (${sender}); the lockbox already has that owner and would revert CannotTransferToSelf`,
      )
    return params
  }

  /**
   * Confirms `lockbox` is a deployed, supported `ERC20LockBox`, then bounds the transfer against
   * its on-chain `owner()` before building `transferOwnership` calldata.
   * @remarks {@link assertLockbox} runs first: `transferOwnership` sent to an EOA or an
   * undeployed address mines as a successful no-op, and a pool or token answers the same selector,
   * so the wrong contract's ownership would move. Both checks live here, not in {@link execute},
   * so the offline / multisig path gets them too.
   * @remarks `owner()` is read even without `sender`, so `newOwner` is bounded away from the
   * current owner when the eventual signer is not yet known.
   * @throws {@link CCTParamsInvalidError} if nothing at `lockbox` answers `typeAndVersion()`,
   * `sender` is given and is not the lockbox owner, or `newOwner` is already the owner
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is some other contract, e.g. the pool
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @throws {@link CCIPTypeVersionInvalidError} if `lockbox` answers `typeAndVersion()` with a
   * string that is not a `type version` pair
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { lockbox, newOwner, sender }: TransferLockboxOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    await assertLockbox(this.name, chain, lockbox)
    const owner = await readLockboxOwner(chain, lockbox)
    if (sender !== undefined && getAddress(sender) !== owner)
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must be the current lockbox owner (${owner})`,
      )
    if (getAddress(newOwner) === owner)
      throw new CCTParamsInvalidError(
        this.name,
        'newOwner',
        `must differ from the current lockbox owner (${owner}); the lockbox would revert CannotTransferToSelf`,
      )
    return callTx(lockbox, LOCKBOX_INTERFACE.encodeFunctionData('transferOwnership', [newOwner]))
  }
}
