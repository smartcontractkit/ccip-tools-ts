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
 * ({@link checkLiquidityFunding}).
 *
 * @remarks **Removed in v2.0.0**, where a siloed pool escrows through a per-lane `ERC20LockBox`
 * instead (see {@link ConfigureSiloedLockboxes}).
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type PreconditionError, CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertSiloedLockReleasePool,
  checkLiquidityFunding,
  checkSiloRebalancer,
  checkSiloedChain,
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
  protected override prepare(params: ProvideSiloedLiquidityParams): ProvideSiloedLiquidityParams {
    const { poolAddress, remoteChainSelector, amount } = params
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateUint64(this.name, 'remoteChainSelector', remoteChainSelector)
    if (remoteChainSelector === 0n)
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        '0 designates the unsiloed bucket, which the pool rejects here with ChainNotSiloed; use provideLiquidity',
      )
    validatePositiveUint256(this.name, 'amount', amount)
    return params
  }

  /**
   * Resolves the pool's type/version and floor-matches the encoder.
   * @remarks The lane, rebalancer and funding requirements are reported by
   * {@link ProvideSiloedLiquidity.preconditions}.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which escrows through per-lane
   * lockboxes instead
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ProvideSiloedLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertSiloedLockReleasePool(this.name, params.poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Confirms the lane is siloed, then that `sender` (when given) is the silo's rebalancer and
   * holds, and has approved the pool for, the deposit.
   * @remarks All reported rather than thrown outright: `updateSiloDesignations →
   * approveToken → provideSiloedLiquidity` is one plan. The lane check is a property of the pool,
   * so it runs with or without `sender`; the rebalancer is read only once it passes, since on an
   * unsiloed lane `getChainRebalancer` answers with the unsiloed rebalancer and the check would
   * pass or fail for the wrong reason. The funding check needs a depositor, so it runs only with a
   * `sender`.
   */
  protected override async preconditions(
    chain: EVMChain,
    { poolAddress, remoteChainSelector, amount, sender }: ProvideSiloedLiquidityParams,
  ): Promise<PreconditionError[]> {
    const [siloed, funding] = await Promise.all([
      checkSiloedChain(chain, poolAddress, remoteChainSelector),
      sender === undefined ? undefined : checkLiquidityFunding(chain, poolAddress, sender, amount),
    ])
    const rebalancer =
      siloed || sender === undefined
        ? undefined
        : await checkSiloRebalancer(chain, poolAddress, remoteChainSelector, sender)
    return unmet(siloed, rebalancer, funding)
  }

  /**
   * Signs and submits as the silo's rebalancer, defaulting `sender` to the signing wallet: the
   * only address that can satisfy {@link preconditions}' rebalancer check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the silo's rebalancer
   * @throws {@link CCTPreconditionError} if the wallet's balance or its allowance to the pool is
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
