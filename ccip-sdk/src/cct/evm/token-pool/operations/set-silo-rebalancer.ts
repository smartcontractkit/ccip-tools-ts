/**
 * setSiloRebalancer: appoints the account allowed to move one lane's silo liquidity on a
 * `SiloedLockReleaseTokenPool` (v1.6.0–v1.6.1).
 *
 * @remarks Owner-only, and the lane must already be siloed (`ChainNotSiloed` otherwise). The
 * appointee is the *only* account `provideSiloedLiquidity` / `withdrawSiloedLiquidity` accept for
 * that lane. Silos, and their first rebalancer, are created with {@link UpdateSiloDesignations};
 * the shared unsiloed bucket's rebalancer is set with {@link SetRebalancer}.
 *
 * @remarks The zero address differs by version: a **v1.6.0** pool reverts `ZeroAddressNotAllowed`
 * on it, while **v1.6.1** accepts it and leaves the silo with no rebalancer, which freezes its
 * liquidity until the owner appoints a new one. Rejected here at v1.6.0.
 *
 * @remarks **Removed in v2.0.0**, where a siloed pool escrows through a per-lane `ERC20LockBox`
 * that authorizes its own callers.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  assertSiloedChain,
  assertSiloedLockReleasePool,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link SetSiloRebalancer}. */
export type SetSiloRebalancerParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` whose silo rebalancer is being assigned. Must be non-zero
   * (it is the tx `to`, and a call to `0x0` hits no code, so it would mine as a successful
   * no-op). */
  poolAddress: string
  /** The siloed lane (`uint64`). Must be non-zero and currently siloed on the pool. */
  remoteChainSelector: bigint
  /**
   * Address to appoint as the silo's rebalancer. Named to match {@link SetRebalancer}'s field.
   *
   * The zero address is accepted only by a **v1.6.1** pool, where it revokes the role and leaves
   * the silo's liquidity unmovable; a v1.6.0 pool reverts `ZeroAddressNotAllowed`, so it is
   * rejected there before any calldata is built.
   */
  rebalancer: string
  /**
   * The pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is checked
   * against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link SetSiloRebalancer.generate}; {@link SetSiloRebalancer.execute} defaults it to the
   * signing wallet, so the owner check always runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `setSiloRebalancer` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: SetSiloRebalancerParams) => UnsignedEVMTx

const encodeSetSiloRebalancer: Encoder = (
  iface,
  { poolAddress, remoteChainSelector, rebalancer },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('setSiloRebalancer', [remoteChainSelector, rebalancer]),
  )

/** Appoints one lane's silo rebalancer on a siloed pool (v1.6.0–v1.6.1). Owner-only. */
export class SetSiloRebalancer extends EVMOperation<SetSiloRebalancerParams> {
  readonly name = 'setSiloRebalancer'

  /**
   * One 1.6.0 entry covers 1.6.1 by floor-match (1.6.1 dropped the zero-address check but kept
   * the signature), and the explicit `null` at 2.0.0 marks the removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_6_0]: encodeSetSiloRebalancer,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /**
   * Validates the pool, lane and rebalancer before any RPC. A zero `rebalancer` passes here: only
   * the pool's version decides whether it is allowed.
   */
  protected override prepare(params: SetSiloRebalancerParams): SetSiloRebalancerParams {
    const { poolAddress, remoteChainSelector, rebalancer } = params
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateUint64(this.name, 'remoteChainSelector', remoteChainSelector)
    if (remoteChainSelector === 0n)
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        '0 designates the unsiloed bucket, which the pool rejects here with ChainNotSiloed; use setRebalancer',
      )
    validateAddress(this.name, 'rebalancer', rebalancer)
    return params
  }

  /**
   * Resolves the pool's type/version, floor-matches the encoder, rejects a zero `rebalancer` on a
   * v1.6.0 pool, confirms the lane is siloed, then that `sender` (when given) is the pool owner.
   * @remarks The zero-address check needs only the version, so it costs no RPC. The lane check is
   * a property of the pool and runs with or without `sender`. Both live here, not in
   * {@link execute}, so the offline / multisig path gets them too.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if `rebalancer` is zero on a v1.6.0 pool, the lane is
   * not siloed, or `sender` is given and is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetSiloRebalancerParams,
  ): Promise<UnsignedEVMTx> {
    const { poolAddress, remoteChainSelector, rebalancer, sender } = params
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)

    if (version === TokenPoolVersion.V1_6_0 && getAddress(rebalancer) === ZeroAddress)
      throw new CCTParamsInvalidError(
        this.name,
        'rebalancer',
        'a v1.6.0 pool reverts ZeroAddressNotAllowed; only v1.6.1 accepts the zero address, which leaves the silo with no rebalancer',
      )
    await assertSiloedChain(this.name, chain, poolAddress, remoteChainSelector)
    if (sender !== undefined) await assertPoolOwner(this.name, chain, poolAddress, sender)
    return unsigned
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet: the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the pool owner
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetSiloRebalancerParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
