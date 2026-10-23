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
 * @remarks On a `SiloedLockReleaseTokenPool` this sets the *unsiloed* rebalancer; a silo's own is
 * set with {@link SetSiloRebalancer}, and silos are created with {@link UpdateSiloDesignations}.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLockReleasePool,
  checkPoolOwner,
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
   * One 1.5.0 entry covers 1.5.1, 1.6.0 and 1.6.1 by floor-match — 1.6.1 added a `RebalancerSet`
   * event but kept the signature — and the explicit `null` at 2.0.0 marks the removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeSetRebalancer,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /** Validates both addresses before any RPC; a zero `rebalancer` revokes the role. */
  protected override prepare(params: SetRebalancerParams): SetRebalancerParams {
    const { poolAddress, rebalancer } = params
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'rebalancer', rebalancer)
    return params
  }

  /**
   * Resolves the pool's type/version and floor-matches the encoder.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which authorizes liquidity on
   * its `ERC20LockBox` instead
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetRebalancerParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertLockReleasePool(this.name, params.poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Confirms `sender` (when given) is the pool owner.
   * @remarks Reported rather than thrown outright, so a plan that appoints this owner in an
   * earlier step can still build this transaction — and reported from here rather than
   * {@link execute} so the offline / multisig path is checked too, instead of being handed a
   * transaction that reverts once signed.
   */
  protected override async preconditions(
    chain: EVMChain,
    params: SetRebalancerParams,
  ): Promise<PreconditionError[]> {
    if (params.sender === undefined) return []
    return unmet(await checkPoolOwner(chain, params.poolAddress, params.sender))
  }
}
