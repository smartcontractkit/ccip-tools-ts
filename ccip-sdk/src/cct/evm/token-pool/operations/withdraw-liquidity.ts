/**
 * withdrawLiquidity — pulls tokens back out of a LockRelease pool (v1.5.0–v1.6.1).
 *
 * @remarks **Rebalancer-gated, not owner-gated**, and the tokens go to `msg.sender`: the pool
 * compares `msg.sender` to `s_rebalancer`, reverts `Unauthorized` for anyone else (the owner
 * included), and transfers the amount to that same address. Appoint the rebalancer with
 * {@link SetRebalancer}.
 *
 * @remarks **Removed in v2.0.0**, where a LockRelease pool escrows through an external
 * `ERC20LockBox` instead of holding liquidity itself.
 *
 * @remarks On a `SiloedLockReleaseTokenPool` this withdraws from the *unsiloed* bucket only, and
 * is gated on the unsiloed rebalancer; the per-lane `withdrawSiloedLiquidity` is not exposed.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLockReleasePool,
  checkPoolLiquidity,
  checkPoolRebalancer,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link WithdrawLiquidity}. */
export type WithdrawLiquidityParams = {
  /** LockRelease pool to withdraw from. Must be non-zero — it is the tx `to`, and a call to `0x0`
   * hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /** Amount of the pool's token to withdraw (`uint256`), in the token's smallest unit. */
  amount: bigint
  /**
   * The pool's rebalancer, which also receives the tokens. Sets `tx.from` for offline / multisig
   * signing, and when supplied is checked against the pool's on-chain `getRebalancer()` before
   * any calldata is built. Optional for {@link WithdrawLiquidity.generate};
   * {@link WithdrawLiquidity.execute} defaults it to the signing wallet.
   */
  sender?: string
}

/** Encodes `withdrawLiquidity` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: WithdrawLiquidityParams) => UnsignedEVMTx

const encodeWithdrawLiquidity: Encoder = (iface, { poolAddress, amount }) =>
  callTx(poolAddress, iface.encodeFunctionData('withdrawLiquidity', [amount]))

/** Withdraws tokens from a LockRelease pool to its rebalancer (v1.5.0–v1.6.1). */
export class WithdrawLiquidity extends EVMOperation<WithdrawLiquidityParams> {
  readonly name = 'withdrawLiquidity'

  /**
   * One 1.5.0 entry covers 1.5.1, 1.6.0 and 1.6.1 by floor-match — the signature never changed —
   * and the explicit `null` at 2.0.0 marks the removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeWithdrawLiquidity,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /** Validates the pool address and amount before any RPC; a zero `amount` moves nothing. */
  protected override validate({ poolAddress, amount }: WithdrawLiquidityParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validatePositiveUint256(this.name, 'amount', amount)
  }

  /**
   * Resolves the pool's type/version, floor-matches the encoder, and encodes. The rebalancer and
   * withdrawable-liquidity requirements are reported by {@link WithdrawLiquidity.preconditions}.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which escrows through an
   * `ERC20LockBox` instead
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: WithdrawLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertLockReleasePool(this.name, params.poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Confirms `sender` (when given) is the pool's rebalancer, and that the pool's withdrawable
   * liquidity covers `amount` ({@link checkPoolLiquidity}): its balance, or its unsiloed liquidity
   * on a siloed pool.
   * @remarks Both reported rather than thrown outright: `provideLiquidity` in an earlier plan
   * step is exactly what puts the liquidity there. Reported from here rather than {@link execute}
   * so the offline / multisig path is covered too.
   * @remarks The liquidity check is advisory: every CCIP transfer moves it, so a later shortfall
   * still reverts `InsufficientLiquidity`. The pool type is re-resolved here; the
   * `typeAndVersion` read behind it is memoized on {@link EVMChain}, so this costs no RPC.
   */
  protected override async preconditions(
    chain: EVMChain,
    params: WithdrawLiquidityParams,
  ): Promise<PreconditionError[]> {
    const { type } = await resolveTokenPool(chain, params.poolAddress)
    return unmet(
      ...(await Promise.all([
        params.sender === undefined
          ? undefined
          : checkPoolRebalancer(chain, params.poolAddress, params.sender),
        checkPoolLiquidity(chain, params.poolAddress, type, params.amount),
      ])),
    )
  }

  /**
   * Signs and submits as the rebalancer, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link preconditions}' rebalancer check for a broadcast tx, and the
   * address the tokens are sent to. See {@link EVMOperation.resolveWalletSender} for why a
   * divergent `sender` is rejected rather than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the pool's rebalancer
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain, e.g.
   * `InsufficientLiquidity`
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<WithdrawLiquidityParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
