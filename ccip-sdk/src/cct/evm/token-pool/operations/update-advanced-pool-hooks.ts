/**
 * updateAdvancedPoolHooks — points a v2.0.0 TokenPool at an `AdvancedPoolHooks` contract, or
 * detaches the one it has.
 *
 * @remarks **v2.0.0 only**, owner-only. A v2.0.0 pool's allowlist and CCV requirements live on
 * the hooks contract, consulted only when the binding is non-zero — so binding the zero address
 * is meaningful: it detaches, leaving the pool enforcing nothing.
 *
 * @remarks **This binding is re-pointable; the sibling `i_lockBox` binding is not.** Both are set
 * by the v2.0.0 pool constructor, one position apart, so the asymmetry surprises: this one is a
 * plain storage slot fixed by one transaction, while `LockReleaseTokenPool`'s `i_lockBox` is
 * `immutable` with no setter, so a wrong lockbox means redeploying the pool.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { assertAdvancedPoolHooksContract } from '../../advanced-pool-hooks/contracts.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  readTokenPoolAdvancedPoolHooks,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link UpdateAdvancedPoolHooks}. */
export type UpdateAdvancedPoolHooksParams = {
  /** Token pool to re-point. Must be non-zero — it is the transaction destination. */
  poolAddress: string
  /**
   * `AdvancedPoolHooks` contract to bind, as returned by `deployAdvancedPoolHooks`; the zero
   * address detaches. A non-zero address is probed and must report type `AdvancedPoolHooks`.
   * @remarks Binding a pool here does not authorize it on the hooks contract — it must also be
   * in their authorized-caller set, or every transfer reverts `UnauthorizedCaller`.
   */
  advancedPoolHooks: string
  /**
   * Pool owner. Sets `tx.from` for offline / multisig signing and, when supplied, is checked
   * against the pool's on-chain `owner()` before calldata is built. Optional for
   * {@link UpdateAdvancedPoolHooks.generate}; {@link UpdateAdvancedPoolHooks.execute} defaults
   * it to the signing wallet.
   */
  sender?: string
}

/** Encodes the v2.0.0 `updateAdvancedPoolHooks(address)` call. */
type Encoder = (iface: Interface, params: UpdateAdvancedPoolHooksParams) => UnsignedEVMTx

const encodeUpdateAdvancedPoolHooks: Encoder = (iface, { poolAddress, advancedPoolHooks }) =>
  callTx(poolAddress, iface.encodeFunctionData('updateAdvancedPoolHooks', [advancedPoolHooks]))

/** Binds (or detaches) a v2.0.0 TokenPool's `AdvancedPoolHooks` contract. Owner-only. */
export class UpdateAdvancedPoolHooks extends EVMOperation<UpdateAdvancedPoolHooksParams> {
  readonly name = 'updateAdvancedPoolHooks'

  /** The hooks binding was introduced with the v2.0.0 pool interface. */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V2_0_0]: encodeUpdateAdvancedPoolHooks,
  }

  /** Validates, and checksums `advancedPoolHooks` so {@link buildUnsigned} can compare it. */
  protected override parse(params: UpdateAdvancedPoolHooksParams): UpdateAdvancedPoolHooksParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    validateAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    return { ...params, advancedPoolHooks: getAddress(params.advancedPoolHooks) }
  }

  /**
   * Resolves the pool, rejects a no-op re-point, confirms the target is an `AdvancedPoolHooks`,
   * and — when `sender` is supplied — confirms it is the owner. The encoder resolves first so
   * pre-v2.0.0 pools fail without further reads.
   *
   * @remarks The no-op guard is the SDK's: the contract rewrites the slot and emits
   * `AdvancedPoolHooksUpdated(hook, hook)`, indistinguishable from a real re-point in an audit
   * trail.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool is already bound to `advancedPoolHooks`
   * @throws {@link CCTContractTypeInvalidError} if a non-zero `advancedPoolHooks` is not an
   * `AdvancedPoolHooks` contract
   * @throws {@link CCTParamsInvalidError} if `sender` is supplied and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: UpdateAdvancedPoolHooksParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)
    const current = await readTokenPoolAdvancedPoolHooks(chain, params.poolAddress)
    if (current === params.advancedPoolHooks)
      throw new CCTParamsInvalidError(
        this.name,
        'advancedPoolHooks',
        current === ZeroAddress
          ? `no hooks are bound to ${params.poolAddress}, so detaching would change nothing; it would still emit AdvancedPoolHooksUpdated`
          : `${current} is already bound to ${params.poolAddress}; the update would emit AdvancedPoolHooksUpdated with no state change`,
      )
    // Skipped for a detach: the zero address is the documented way to unbind, not a target.
    if (params.advancedPoolHooks !== ZeroAddress)
      await assertAdvancedPoolHooksContract(chain, params.advancedPoolHooks)
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)
    return unsigned
  }

  /** Signs and submits as the pool owner, defaulting `sender` to the signing wallet. */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<UpdateAdvancedPoolHooksParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
