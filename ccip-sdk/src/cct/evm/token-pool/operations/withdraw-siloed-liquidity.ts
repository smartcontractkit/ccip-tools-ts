/**
 * withdrawSiloedLiquidity: pulls tokens back out of one lane's silo of a
 * `SiloedLockReleaseTokenPool` (v1.6.0–v1.6.1).
 *
 * @remarks **Gated on the silo's rebalancer**, and the tokens go to `msg.sender`: the pool compares
 * `msg.sender` to `getChainRebalancer(remoteChainSelector)`, reverts `Unauthorized` for anyone else
 * (the owner and the unsiloed rebalancer included), and transfers the amount to that same address.
 *
 * @remarks Pays out of the silo's own balance only (`getAvailableTokens(remoteChainSelector)`), not
 * the shared unsiloed bucket, which {@link WithdrawLiquidity} draws on instead.
 *
 * @remarks **Removed in v2.0.0**, where a siloed pool escrows through a per-lane `ERC20LockBox`
 * instead (see {@link ConfigureSiloedLockboxes}).
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
  assertSiloLiquidity,
  assertSiloRebalancer,
  assertSiloedChain,
  assertSiloedLockReleasePool,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link WithdrawSiloedLiquidity}. */
export type WithdrawSiloedLiquidityParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` to withdraw from. Must be non-zero: it is the tx `to`,
   * and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * The siloed lane whose silo pays out (`uint64`). Must be non-zero and currently siloed on the
   * pool.
   */
  remoteChainSelector: bigint
  /** Amount of the pool's token to withdraw (`uint256`), in the token's smallest unit. */
  amount: bigint
  /**
   * The silo's rebalancer, which also receives the tokens. Sets `tx.from` for offline / multisig
   * signing, and when supplied is checked against the pool's on-chain
   * `getChainRebalancer(remoteChainSelector)` before any calldata is built. Optional for
   * {@link WithdrawSiloedLiquidity.generate}; {@link WithdrawSiloedLiquidity.execute} defaults it
   * to the signing wallet.
   */
  sender?: string
}

/** Encodes `withdrawSiloedLiquidity` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: WithdrawSiloedLiquidityParams) => UnsignedEVMTx

const encodeWithdrawSiloedLiquidity: Encoder = (
  iface,
  { poolAddress, remoteChainSelector, amount },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('withdrawSiloedLiquidity', [remoteChainSelector, amount]),
  )

/** Withdraws tokens from one lane's silo to its rebalancer (v1.6.0–v1.6.1). */
export class WithdrawSiloedLiquidity extends EVMOperation<WithdrawSiloedLiquidityParams> {
  readonly name = 'withdrawSiloedLiquidity'

  /**
   * One 1.6.0 entry covers 1.6.1 by floor-match (the signature never changed), and the explicit
   * `null` at 2.0.0 marks the removal. The siloed family never resolves at 1.5.x.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_6_0]: encodeWithdrawSiloedLiquidity,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /**
   * Validates the pool, lane and amount before any RPC. Lane 0 and a zero `amount` both revert
   * on-chain (`ChainNotSiloed`, `LiquidityAmountCannotBeZero`).
   */
  protected override prepare(params: WithdrawSiloedLiquidityParams): WithdrawSiloedLiquidityParams {
    const { poolAddress, remoteChainSelector, amount } = params
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateUint64(this.name, 'remoteChainSelector', remoteChainSelector)
    if (remoteChainSelector === 0n)
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        '0 designates the unsiloed bucket, which the pool rejects here with ChainNotSiloed; use withdrawLiquidity',
      )
    validatePositiveUint256(this.name, 'amount', amount)
    return params
  }

  /**
   * Resolves the pool's type/version, floor-matches the encoder, confirms the lane is siloed and
   * that `sender` (when given) is its rebalancer, then pre-flights the silo's balance.
   * @remarks The lane check runs with or without `sender`, and first, for the reason given on
   * `ProvideSiloedLiquidity.buildUnsigned`. The checks live here, not in {@link execute}, so the
   * offline / multisig path gets them too.
   * @remarks The silo's balance is pre-flighted ({@link assertSiloLiquidity}). Advisory only:
   * every CCIP transfer on the lane moves it, so a later shortfall still reverts
   * `InsufficientLiquidity`. Skipped for a siloed lane the pool no longer supports, whose balance
   * it will not report but still pays out.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool, which escrows through per-lane
   * lockboxes instead
   * @throws {@link CCTParamsInvalidError} if the lane is not siloed, or `sender` is given and is
   * not the silo's rebalancer
   * @throws {@link CCTTxFailedError} if the silo holds less than `amount`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: WithdrawSiloedLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { poolAddress, remoteChainSelector, amount, sender } = params
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)

    await assertSiloedChain(this.name, chain, poolAddress, remoteChainSelector)
    if (sender !== undefined)
      await assertSiloRebalancer(this.name, chain, poolAddress, remoteChainSelector, sender)
    await assertSiloLiquidity(this.name, chain, poolAddress, remoteChainSelector, amount)
    return unsigned
  }

  /**
   * Signs and submits as the silo's rebalancer, defaulting `sender` to the signing wallet: the
   * only address that can satisfy {@link buildUnsigned}'s rebalancer check for a broadcast tx, and
   * the address the tokens are sent to. See {@link EVMOperation.resolveWalletSender} for why a
   * divergent `sender` is rejected rather than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet is not the silo's rebalancer
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain, e.g.
   * `InsufficientLiquidity`
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<WithdrawSiloedLiquidityParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
