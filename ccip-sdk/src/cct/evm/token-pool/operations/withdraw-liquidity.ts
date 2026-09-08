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
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLockReleasePool,
  assertPoolLiquidity,
  assertPoolRebalancer,
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
   * One 1.5.0 entry covers 1.5.1 and 1.6.1 by floor-match — the signature never changed — and the
   * explicit `null` at 2.0.0 marks the removal.
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
   * Resolves the pool's type/version, floor-matches the encoder, then confirms `sender` (when
   * given) is the pool's rebalancer.
   * @remarks The rebalancer check lives here, not in {@link execute}, so the offline / multisig
   * path gets it too rather than being handed a transaction that reverts once signed.
   * @remarks The pool's balance is pre-flighted ({@link assertPoolLiquidity}), for parity with
   * Solana's `withdrawLiquidity`. Advisory only — every CCIP transfer through the pool moves that
   * balance, so it catches "withdraw more than was ever provided" rather than proving the amount
   * will still fit when the tx mines; a later shortfall still reverts `InsufficientLiquidity`.
   * @throws {@link CCTContractTypeInvalidError} if the pool is a BurnMint pool
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which escrows through an
   * `ERC20LockBox` instead
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool's rebalancer
   * @throws {@link CCTTxFailedError} if the pool holds less than `amount`
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: WithdrawLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertLockReleasePool(this.name, params.poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)
    if (params.sender !== undefined)
      await assertPoolRebalancer(this.name, chain, params.poolAddress, params.sender)
    await assertPoolLiquidity(this.name, chain, params.poolAddress, params.amount)
    return unsigned
  }

  /**
   * Signs and submits as the rebalancer, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s rebalancer check for a broadcast tx, and the
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
