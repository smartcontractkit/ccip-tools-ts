/**
 * provideLiquidity — deposits tokens into a LockRelease pool (v1.5.0–v1.6.1).
 *
 * @remarks **Rebalancer-gated, not owner-gated.** The pool compares `msg.sender` to
 * `s_rebalancer` and reverts `Unauthorized` for anyone else, the owner included; the owner's part
 * is to appoint the rebalancer with {@link SetRebalancer}.
 *
 * @remarks The deposit is a `transferFrom` on the rebalancer, so the tokens must be **approved to
 * the pool** first. That is pre-flighted here ({@link assertLiquidityFunding}) rather than left to
 * revert `ERC20InsufficientAllowance` in the wallet, matching Solana's `provideLiquidity`.
 *
 * @remarks **Removed in v2.0.0**, where a LockRelease pool escrows through an external
 * `ERC20LockBox` instead of holding liquidity itself.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLiquidityFunding,
  assertLockReleasePool,
  assertPoolRebalancer,
  getTokenPoolInterface,
  readTokenPoolAcceptsLiquidity,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link ProvideLiquidity}. */
export type ProvideLiquidityParams = {
  /** LockRelease pool to deposit into. Must be non-zero — it is the tx `to`, and a call to `0x0`
   * hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /** Amount of the pool's token to deposit (`uint256`), in the token's smallest unit. */
  amount: bigint
  /**
   * The pool's rebalancer. Sets `tx.from` for offline / multisig signing, and when supplied is
   * checked against the pool's on-chain `getRebalancer()` before any calldata is built. Optional
   * for {@link ProvideLiquidity.generate} (an offline builder may not yet know the signer);
   * {@link ProvideLiquidity.execute} defaults it to the signing wallet, so the check always runs
   * on a broadcast tx.
   */
  sender?: string
}

/** Encodes `provideLiquidity` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ProvideLiquidityParams) => UnsignedEVMTx

const encodeProvideLiquidity: Encoder = (iface, { poolAddress, amount }) =>
  callTx(poolAddress, iface.encodeFunctionData('provideLiquidity', [amount]))

/** Deposits tokens into a LockRelease pool as its rebalancer (v1.5.0–v1.6.1). */
export class ProvideLiquidity extends EVMOperation<ProvideLiquidityParams> {
  readonly name = 'provideLiquidity'

  /**
   * One 1.5.0 entry covers 1.5.1 and 1.6.1 by floor-match — the signature never changed — and the
   * explicit `null` at 2.0.0 marks the removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeProvideLiquidity,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /** Validates the pool address and amount before any RPC; a zero `amount` moves nothing. */
  protected override validate({ poolAddress, amount }: ProvideLiquidityParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validatePositiveUint256(this.name, 'amount', amount)
  }

  /**
   * Resolves the pool's type/version, floor-matches the encoder, then confirms the pool takes
   * deposits at all and that `sender` (when given) is its rebalancer.
   * @remarks The v1.5.x `canAcceptLiquidity()` read is a property of the pool, not of the caller,
   * so it runs first: `i_acceptLiquidity` is set *immutable* in the constructor, so a pool
   * deployed with it `false` reverts every `provideLiquidity` for its whole lifetime and no
   * choice of sender helps. v1.6.1 dropped the flag and always accepts.
   * @remarks The checks live here, not in {@link execute}, so the offline / multisig path gets
   * them too rather than being handed a transaction that reverts once signed. The funding check
   * needs a depositor, so it runs only with a `sender`.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which escrows through an
   * `ERC20LockBox` instead
   * @throws {@link CCTParamsInvalidError} if the pool cannot accept liquidity, or `sender` is
   * given and is not the pool's rebalancer
   * @throws {@link CCTTxFailedError} if `sender` holds, or has approved the pool for, less than
   * `amount`
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ProvideLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertLockReleasePool(this.name, params.poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)

    const hasAcceptFlag = version === TokenPoolVersion.V1_5_0 || version === TokenPoolVersion.V1_5_1
    if (hasAcceptFlag && !(await readTokenPoolAcceptsLiquidity(chain, params.poolAddress)))
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        `pool ${params.poolAddress} was deployed with acceptLiquidity = false, which is immutable, so it rejects every deposit with LiquidityNotAccepted`,
      )
    if (params.sender !== undefined) {
      await assertPoolRebalancer(this.name, chain, params.poolAddress, params.sender)
      await assertLiquidityFunding(
        this.name,
        chain,
        params.poolAddress,
        params.sender,
        params.amount,
      )
    }
    return unsigned
  }

  /**
   * Signs and submits as the rebalancer, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s rebalancer check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the pool's rebalancer
   * @throws {@link CCTTxFailedError} if the wallet's balance or its allowance to the pool is
   * below `amount`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ProvideLiquidityParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
