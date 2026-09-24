/**
 * transferLiquidity — moves liquidity from an older LockRelease pool into this one
 * (v1.5.0–v1.6.1). The pool-upgrade primitive.
 *
 * @remarks Owner-only on the *destination* pool (`poolAddress`), and it works by calling
 * `withdrawLiquidity` on the source pool (`from`), which pays out to `msg.sender` — the
 * destination pool. That only works if the destination pool is the source pool's rebalancer, so
 * the migration is two steps: {@link SetRebalancer} on the old pool to point at the new one,
 * then this op on the new one. Both are checked before any calldata is built.
 *
 * @remarks Everything the source pool decides is read up front ({@link assertSourcePool}): its
 * rebalancer, its liquidity, and that it escrows the same token as the destination. That last one
 * has no on-chain guard, and a mismatch moves an asset the destination pool does not manage.
 *
 * @remarks `SiloedLockReleaseTokenPool` does not declare `transferLiquidity` — its liquidity is
 * partitioned per lane — so a siloed destination is rejected by type rather than by version.
 *
 * @remarks **Removed in v2.0.0**, where a LockRelease pool escrows through an external
 * `ERC20LockBox` instead of holding liquidity itself.
 *
 * @packageDocumentation
 */

import { type Interface, MaxUint256, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnmetPrecondition, UnsignedEVMTx } from '../../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type EVMExecuteParams,
  type PreflightParams,
  EVMOperation,
  callTx,
} from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256 } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertLockReleasePool,
  checkPoolOwner,
  getTokenPoolInterface,
  readTokenPoolLiquidity,
  readTokenPoolRebalancer,
  readTokenPoolToken,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link TransferLiquidity}. */
export type TransferLiquidityParams = PreflightParams & {
  /** Destination LockRelease pool — the one being written to, and the one that receives the
   * liquidity. Must be non-zero: it is the tx `to`. */
  poolAddress: string
  /**
   * **Source pool** — not the tx sender, which is `sender`. The pool liquidity is pulled *out
   * of*, typically the one being replaced; `poolAddress` is where it lands. Named after the
   * on-chain `transferLiquidity(address from, uint256 amount)` parameter.
   *
   * Must already have `poolAddress` set as its rebalancer, which is what authorizes the
   * withdrawal.
   */
  from: string
  /**
   * Amount of the pool's token to move (`uint256`), in the token's smallest unit.
   * @remarks `MaxUint256` is a v1.6.1 sentinel meaning "the source pool's whole balance". A
   * v1.5.x pool has no such branch and would try to withdraw that literal amount, so it is
   * rejected there rather than left to revert.
   */
  amount: bigint
  /**
   * Owner of the destination pool. Sets `tx.from` for offline / multisig signing, and when
   * supplied is checked against that pool's on-chain `owner()` before any calldata is built.
   * Optional for {@link TransferLiquidity.generate}; {@link TransferLiquidity.execute} defaults
   * it to the signing wallet, so the owner check always runs on a broadcast tx.
   */
  sender?: string
}

/** Encodes `transferLiquidity` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: TransferLiquidityParams) => UnsignedEVMTx

const encodeTransferLiquidity: Encoder = (iface, { poolAddress, from, amount }) =>
  callTx(poolAddress, iface.encodeFunctionData('transferLiquidity', [from, amount]))

/** Migrates liquidity from an older LockRelease pool into this one (v1.5.0–v1.6.1). Owner-only. */
/** What the *source* pool's three pre-flight checks are decided from, read in one batch. */
type SourcePoolState = {
  /** The token the destination pool escrows. */
  destinationToken: string
  /** The source pool's escrowed token and its balance of it. */
  source: { token: string; liquidity: bigint }
  /** The source pool's configured rebalancer — the only address it pays out to. */
  rebalancer: string
}

/**
 * Reads everything the source-pool checks compare, in one batch.
 *
 * @remarks Split from the checks themselves so all three are decided from a single round of RPC
 * regardless of {@link PreflightMode} — under `'throw'` the first failing check still throws, and
 * under `'report'` the other two cost nothing extra.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param destination - The pool being written to, which must be `from`'s rebalancer.
 * @param from - Source pool.
 * @throws {@link CCTContractTypeInvalidError} if `from` is not a LockRelease pool — a contract
 * shape, not chain state, so it throws under either mode
 */
async function readSourcePool(
  operation: string,
  chain: EVMChain,
  destination: string,
  from: string,
): Promise<SourcePoolState> {
  const { type } = await resolveTokenPool(chain, from)
  assertLockReleasePool(operation, from, type)

  const [{ token: destinationToken }, source, rebalancer] = await Promise.all([
    readTokenPoolToken(chain, destination),
    readTokenPoolLiquidity(chain, from),
    readTokenPoolRebalancer(chain, from),
  ])
  return { destinationToken, source, rebalancer }
}

/**
 * Checks that `from` escrows the same token the destination does.
 *
 * @remarks The one check with no on-chain counterpart. A mismatch does not revert: the destination
 * takes whatever `from.withdrawLiquidity` pays out, so it silently receives an asset it does not
 * escrow.
 * @returns The unmet requirement, or `undefined` if both pools escrow the same token.
 */
function checkSourceToken(
  { destinationToken, source }: SourcePoolState,
  destination: string,
  from: string,
): UnmetPrecondition | undefined {
  if (source.token === destinationToken) return undefined
  return {
    param: 'from',
    reason: `${from} escrows ${source.token} but ${destination} escrows ${destinationToken}; transferring between them would move a token the destination pool does not manage`,
  }
}

/**
 * Checks that the destination pool is `from`'s rebalancer — the wiring `setRebalancer` installs,
 * and the most likely thing an earlier step of the same plan is there to do.
 * @returns The unmet requirement, or `undefined` if the wiring is in place.
 */
function checkSourceRebalancer(
  { rebalancer }: SourcePoolState,
  destination: string,
  from: string,
): UnmetPrecondition | undefined {
  if (rebalancer === getAddress(destination)) return undefined
  return {
    param: 'from',
    reason: `pool ${destination} must be the rebalancer of ${from} to withdraw from it, but its rebalancer is ${rebalancer}; call setRebalancer on ${from} first`,
  }
}

/**
 * Checks that `from` holds `amount`.
 * @param amount - Transfer amount, or `undefined` for the transfer-all sentinel, where the pool
 * substitutes the source's own balance and there is nothing to compare.
 * @returns The unmet requirement, or `undefined` if the source holds enough (or there is nothing
 * to compare).
 */
function checkSourceLiquidity(
  { source }: SourcePoolState,
  from: string,
  amount: bigint | undefined,
): UnmetPrecondition | undefined {
  if (amount === undefined || source.liquidity >= amount) return undefined
  return {
    param: 'amount',
    reason: `source pool ${from} holds ${source.liquidity} of ${source.token}, but ${amount} is required; the withdrawal it makes would revert InsufficientLiquidity`,
  }
}

export class TransferLiquidity extends EVMOperation<TransferLiquidityParams> {
  readonly name = 'transferLiquidity'

  /**
   * One 1.5.0 entry covers 1.5.1 and 1.6.1 by floor-match — 1.6.1 added the `MaxUint256`
   * transfer-all branch but kept the signature — and the explicit `null` at 2.0.0 marks the
   * removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeTransferLiquidity,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /**
   * Validates both pool addresses and the amount before any RPC. `from` must differ from
   * `poolAddress`: a pool is never its own rebalancer, so a self-transfer can only revert.
   */
  protected override validate({ poolAddress, from, amount }: TransferLiquidityParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateNonZeroAddress(this.name, 'from', from)
    validatePositiveUint256(this.name, 'amount', amount)
    if (getAddress(poolAddress) === getAddress(from))
      throw new CCTParamsInvalidError(
        this.name,
        'from',
        'must be a different pool than poolAddress; a pool cannot withdraw its own liquidity',
      )
  }

  /**
   * Resolves the destination pool's type/version, floor-matches the encoder, then pre-flights
   * what the two pools decide: {@link assertSourcePool} for everything about `from`, and
   * `sender` (when given) owning the destination pool.
   * @remarks Both live here, not in {@link execute}, so the offline / multisig path gets them
   * too. Getting the rebalancer wiring wrong is this op's most likely failure, and would
   * otherwise surface as an `Unauthorized` revert from a nested call.
   * @throws {@link CCTContractTypeInvalidError} if either pool is a BurnMint pool, or the
   * destination is siloed
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 destination pool, which escrows
   * through an `ERC20LockBox` instead
   * @throws {@link CCTParamsInvalidError} if `amount` is `MaxUint256` on a v1.5.x pool, the pools
   * escrow different tokens, `from` does not have the destination pool as its rebalancer, or
   * `sender` is given and does not own the destination pool
   * @throws {@link CCTTxFailedError} if `from` holds less than `amount`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: TransferLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    assertLockReleasePool(this.name, params.poolAddress, type)
    if (type === 'SiloedLockReleaseTokenPool')
      throw new CCTContractTypeInvalidError(
        params.poolAddress,
        'LockReleaseTokenPool',
        type,
        'a siloed pool partitions liquidity per lane and does not declare transferLiquidity',
        { context: { operation: this.name } },
      )
    const encode = resolveEncoder(this.encoders, version, this.name)
    if (params.amount === MaxUint256 && version !== TokenPoolVersion.V1_6_1)
      throw new CCTParamsInvalidError(
        this.name,
        'amount',
        `MaxUint256 means "transfer everything" only from v1.6.1; a ${version} pool would try to withdraw that amount and revert with InsufficientLiquidity`,
      )
    let tx = encode(getTokenPoolInterface(type, version), params)

    const state = await readSourcePool(this.name, chain, params.poolAddress, params.from)
    tx = this.recordPreflight(
      tx,
      params.preflight,
      checkSourceToken(state, params.poolAddress, params.from),
    )
    tx = this.recordPreflight(
      tx,
      params.preflight,
      checkSourceRebalancer(state, params.poolAddress, params.from),
    )
    // Keeps raising CCTTxFailedError under `'throw'`, the class this shortfall always raised.
    tx = this.recordPreflight(
      tx,
      params.preflight,
      checkSourceLiquidity(
        state,
        params.from,
        params.amount === MaxUint256 ? undefined : params.amount,
      ),
      ({ reason }) => new CCTTxFailedError(this.name, reason),
    )
    if (params.sender === undefined) return tx
    return this.recordPreflight(
      tx,
      params.preflight,
      await checkPoolOwner(chain, params.poolAddress, params.sender),
    )
  }

  /**
   * Signs and submits as the destination pool's owner, defaulting `sender` to the signing wallet
   * — the only address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx.
   * See {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or the wallet does not own the destination pool
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain, e.g.
   * `InsufficientLiquidity` when the source pool holds less than `amount`
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<TransferLiquidityParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
