/**
 * provideSiloedLiquidity: deposits tokens into one lane's silo of a `SiloedLockReleaseTokenPool`
 * (v1.6.0–v1.6.1).
 *
 * @remarks **Gated on the silo's rebalancer** (`getChainRebalancer(remoteChainSelector)`), not the
 * owner and not the unsiloed rebalancer: the pool reverts `Unauthorized` for anyone else. The owner
 * appoints it with {@link SetSiloRebalancer} or when designating the silo with
 * {@link UpdateSiloDesignations}.
 *
 * @remarks The lane must be siloed: the pool reverts `ChainNotSiloed` otherwise. The shared
 * unsiloed bucket is funded with {@link ProvideLiquidity} instead.
 *
 * @remarks The deposit is a `transferFrom` on the rebalancer, so the tokens must be **approved to
 * the pool** first, exactly as for {@link ProvideLiquidity}; pre-flighted the same way
 * ({@link assertLiquidityFunding}).
 *
 * @remarks **Removed in v2.0.0**, where a siloed pool escrows through a per-lane `ERC20LockBox`
 * instead (see `configureLockBoxes`).
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLiquidityFunding,
  assertSiloRebalancer,
  assertSiloedChain,
  assertSiloedLockReleasePool,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link ProvideSiloedLiquidity}. */
export type ProvideSiloedLiquidityParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` to deposit into. Must be non-zero: it is the tx `to`,
   * and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * The siloed lane whose silo receives the deposit (`uint64`). Must be non-zero and currently
   * siloed on the pool.
   */
  remoteChainSelector: bigint
  /** Amount of the pool's token to deposit (`uint256`), in the token's smallest unit. */
  amount: bigint
  /**
   * The silo's rebalancer. Sets `tx.from` for offline / multisig signing, and when supplied is
   * checked against the pool's on-chain `getChainRebalancer(remoteChainSelector)` before any
   * calldata is built. Optional for {@link ProvideSiloedLiquidity.generate} (an offline builder
   * may not yet know the signer); {@link ProvideSiloedLiquidity.execute} defaults it to the
   * signing wallet, so the check always runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `provideSiloedLiquidity` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ProvideSiloedLiquidityParams) => UnsignedEVMTx

const encodeProvideSiloedLiquidity: Encoder = (
  iface,
  { poolAddress, remoteChainSelector, amount },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('provideSiloedLiquidity', [remoteChainSelector, amount]),
  )

/** Deposits tokens into one lane's silo as its rebalancer (v1.6.0–v1.6.1). */
export class ProvideSiloedLiquidity extends EVMOperation<ProvideSiloedLiquidityParams> {
  readonly name = 'provideSiloedLiquidity'

  /**
   * One 1.6.0 entry covers 1.6.1 by floor-match (the signature never changed), and the explicit
   * `null` at 2.0.0 marks the removal. The siloed family never resolves at 1.5.x.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_6_0]: encodeProvideSiloedLiquidity,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /**
   * Validates the pool, lane and amount before any RPC. Lane 0 and a zero `amount` both revert
   * on-chain (`ChainNotSiloed`, `LiquidityAmountCannotBeZero`).
   */
  protected override validate({
    poolAddress,
    remoteChainSelector,
    amount,
  }: ProvideSiloedLiquidityParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateUint64(this.name, 'remoteChainSelector', remoteChainSelector)
    if (remoteChainSelector === 0n)
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        '0 designates the unsiloed bucket, which the pool rejects here with ChainNotSiloed; use provideLiquidity',
      )
    validatePositiveUint256(this.name, 'amount', amount)
  }

  /**
   * Resolves the pool's type/version, floor-matches the encoder, confirms the lane is siloed,
   * then that `sender` (when given) is the silo's rebalancer and can fund the deposit.
   * @remarks The lane check is a property of the pool, not of the caller, so it runs with or
   * without `sender`, and first: on an unsiloed lane `getChainRebalancer` would answer with the
   * unsiloed rebalancer, and the sender check would pass or fail for the wrong reason.
   * @remarks The checks live here, not in {@link execute}, so the offline / multisig path gets
   * them too. The funding check needs a depositor, so it runs only with a `sender`.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which escrows through per-lane
   * lockboxes instead
   * @throws {@link CCTParamsInvalidError} if the lane is not siloed, or `sender` is given and is
   * not the silo's rebalancer
   * @throws {@link CCTTxFailedError} if `sender` holds, or has approved the pool for, less than
   * `amount`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ProvideSiloedLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { poolAddress, remoteChainSelector, amount, sender } = params
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)

    await assertSiloedChain(this.name, chain, poolAddress, remoteChainSelector)
    if (sender !== undefined) {
      await assertSiloRebalancer(this.name, chain, poolAddress, remoteChainSelector, sender)
      await assertLiquidityFunding(this.name, chain, poolAddress, sender, amount)
    }
    return unsigned
  }

  /**
   * Signs and submits as the silo's rebalancer, defaulting `sender` to the signing wallet: the
   * only address that can satisfy {@link buildUnsigned}'s rebalancer check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the silo's rebalancer
   * @throws {@link CCTTxFailedError} if the wallet's balance or its allowance to the pool is
   * below `amount`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ProvideSiloedLiquidityParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
