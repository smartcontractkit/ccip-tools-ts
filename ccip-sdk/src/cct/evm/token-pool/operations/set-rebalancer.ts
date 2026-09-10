/**
 * setRebalancer — appoints the LockRelease pool role allowed to move liquidity (v1.5.0–v1.6.1).
 *
 * @remarks Owner-only. The rebalancer is the *only* account `provideLiquidity` and
 * `withdrawLiquidity` accept — not the owner — so this op is how an owner delegates liquidity
 * management, and the zero address is how it revokes it.
 *
 * @remarks **Removed in v2.0.0**, which authorizes liquidity on the pool's external
 * `ERC20LockBox` rather than through a pool-level role.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLockReleasePool,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link SetRebalancer}. */
export type SetRebalancerParams = {
  /** LockRelease pool whose rebalancer role is being assigned. Must be non-zero — it is the tx
   * `to`, and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * Address to appoint as rebalancer. Named to match the Solana op's public field
   * (`cct/solana/token-pool/operations/set-rebalancer.ts`), so cross-family callers write one
   * shape.
   *
   * The zero address is **allowed** and meaningful: it disables liquidity management entirely,
   * since the pool then accepts `provideLiquidity` / `withdrawLiquidity` from nobody. Revoking a
   * delegated rebalancer is a legitimate — and on incident response, urgent — operation.
   */
  rebalancer: string
  /**
   * The pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is checked
   * against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link SetRebalancer.generate}; {@link SetRebalancer.execute} defaults it to the signing
   * wallet, so the owner check always runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `setRebalancer` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: SetRebalancerParams) => UnsignedEVMTx

const encodeSetRebalancer: Encoder = (iface, { poolAddress, rebalancer }) =>
  callTx(poolAddress, iface.encodeFunctionData('setRebalancer', [rebalancer]))

/** Appoints a LockRelease pool's rebalancer (v1.5.0–v1.6.1). Owner-only. */
export class SetRebalancer extends EVMOperation<SetRebalancerParams> {
  readonly name = 'setRebalancer'

  /**
   * One 1.5.0 entry covers 1.5.1 and 1.6.1 by floor-match — 1.6.1 added a `RebalancerSet` event
   * but kept the signature — and the explicit `null` at 2.0.0 marks the removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeSetRebalancer,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /** Validates both addresses before any RPC; a zero `rebalancer` revokes the role. */
  protected override validate({ poolAddress, rebalancer }: SetRebalancerParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'rebalancer', rebalancer)
  }

  /**
   * Resolves the pool's type/version, floor-matches the encoder, then confirms `sender` (when
   * given) is the pool owner.
   * @remarks The owner check lives here, not in {@link execute}, so the offline / multisig path
   * gets it too rather than being handed a transaction that reverts once signed.
   * @remarks Ordered *after* the encoder so a 2.0.0 pool reports the real problem (removed
   * selector) rather than spending a round trip and failing on an authorization detail.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which authorizes liquidity on
   * its `ERC20LockBox` instead
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetRebalancerParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertLockReleasePool(this.name, params.poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)
    return unsigned
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the pool owner
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetRebalancerParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
