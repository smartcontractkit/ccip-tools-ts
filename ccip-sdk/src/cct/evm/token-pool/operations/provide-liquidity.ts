/**
 * provideLiquidity — funds a lock-release token pool with liquidity so it can release
 * tokens on inbound CCIP transfers. **EVM lock-release pools only** (burn-mint pools
 * mint on demand and hold no liquidity).
 *
 * Emits **two** transactions, `[approveTx, provideTx]` (the shared submit runs them
 * sequentially and returns the second, provide/deposit, hash):
 * 1. ERC20 `approve(spender, amount)` on the pool's token.
 * 2. The version-specific provide call:
 *    - **v1.5 / v1.6**: `pool.provideLiquidity(amount)` — liquidity held by the pool,
 *      spender is the pool (caller must be the pool's rebalancer).
 *    - **v2.0**: `lockBox.deposit(token, 0, amount)` on the pool's `ERC20LockBox`
 *      (resolved via `pool.getLockBox()`), spender is the lock box. The
 *      `remoteChainSelector` deposit arg is unused on-chain (passed as `0`).
 *
 * @packageDocumentation
 */

import { Contract, Interface } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import { type EVMChain, isSigner } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { EVMOperation } from '../../operation.ts'
import { submitForReceipt } from '../../submit.ts'
import { validateAddress } from '../../validate.ts'

/** Minimal ERC20 approve interface — spender depends on the pool version. */
const ERC20_APPROVE_IFACE = new Interface(['function approve(address spender, uint256 amount)'])

/** Parameters for `provideLiquidity`. */
export type ProvideLiquidityParams = {
  /** Local lock-release pool address. */
  poolAddress: string
  /** Amount of token (in smallest units) to provide as liquidity. Must be greater than 0. */
  amount: bigint
  sender?: string
}

/** Resolves the version-appropriate cached pool interface for reads/encoding. */
function poolInterface(version: string): Interface {
  if (version <= CCIPVersion.V1_5) return interfaces.TokenPool_v1_5
  if (version < CCIPVersion.V2_0) return interfaces.TokenPool_v1_6
  return interfaces.TokenPool_v2_0
}

/** Provides liquidity to an EVM lock-release token pool (approve + provide/deposit). */
export class ProvideLiquidity extends EVMOperation<ProvideLiquidityParams> {
  readonly name = 'provideLiquidity'

  /** Validates the pool address and amount before any RPC. */
  protected validate(p: ProvideLiquidityParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    if (p.amount <= 0n) {
      throw new CCTParamsInvalidError(this.name, 'amount', 'must be greater than 0')
    }
  }

  /** Builds `[approveTx, provideTx]`; rejects non-lock-release pools. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: ProvideLiquidityParams,
  ): Promise<UnsignedEVMTx> {
    // DX guard: provide-liquidity is meaningful only for lock-release pools.
    const [poolType, version] = await chain.typeAndVersion(p.poolAddress)
    if (!poolType.includes('LockRelease')) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        `provide-liquidity is only supported for lock-release pools (got ${poolType})`,
      )
    }

    const iface = poolInterface(version)
    const poolContract = new Contract(p.poolAddress, iface, chain.provider)
    const token = (await poolContract.getFunction('getToken')()) as string

    let spender: string
    let provideTx: { to: string; data: string }
    if (version >= CCIPVersion.V2_0) {
      // v2.0: liquidity lives in a separate ERC20LockBox whose deposit() is gated on
      // authorized callers; the signed `execute` path pre-authorizes the caller when needed.
      const lockBox = (await poolContract.getFunction('getLockBox')()) as string
      spender = lockBox
      // deposit(address token, uint64 remoteChainSelector, uint256 amount) — selector arg unused.
      provideTx = {
        to: lockBox,
        data: interfaces.ERC20LockBox_v2_0.encodeFunctionData('deposit', [token, 0n, p.amount]),
      }
    } else {
      // v1.5/v1.6: liquidity held by the pool itself; caller must be the rebalancer.
      spender = p.poolAddress
      provideTx = {
        to: p.poolAddress,
        data: iface.encodeFunctionData('provideLiquidity', [p.amount]),
      }
    }

    const approveTx = {
      to: token,
      data: ERC20_APPROVE_IFACE.encodeFunctionData('approve', [spender, p.amount]),
    }

    return { family: ChainFamily.EVM, transactions: [approveTx, provideTx] }
  }

  /**
   * Signed flow with a pre-step for v2.0 lock-release pools: `ERC20LockBox.deposit()` is
   * gated on authorized callers, so a first-time provider's deposit would revert. Before the
   * normal approve+deposit, this reads the lockbox's `getAllAuthorizedCallers()` and, if the
   * caller is not yet authorized, submits `applyAuthorizedCallerUpdates` to add it (requires
   * the caller to be the lockbox owner). Non-lock-release / already-authorized callers and
   * v1.5/v1.6 pools take no extra transaction.
   */
  override async execute(
    chain: EVMChain,
    params: ProvideLiquidityParams & { wallet: unknown },
  ): Promise<TransactionHash> {
    const { wallet } = params
    const [poolType, version] = await chain.typeAndVersion(params.poolAddress)
    if (version >= CCIPVersion.V2_0 && poolType.includes('LockRelease')) {
      if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)
      const poolContract = new Contract(
        params.poolAddress,
        interfaces.TokenPool_v2_0,
        chain.provider,
      )
      const lockBox = (await poolContract.getFunction('getLockBox')()) as string
      const lockBoxContract = new Contract(lockBox, interfaces.ERC20LockBox_v2_0, chain.provider)
      const caller = params.sender ?? (await wallet.getAddress())
      const authorized = (await lockBoxContract
        .getFunction('getAllAuthorizedCallers')()
        .catch(() => [] as string[])) as string[]
      if (!authorized.some((a) => a.toLowerCase() === caller.toLowerCase())) {
        chain.logger.debug(`${this.name}: authorizing caller on lockbox`, lockBox)
        const authData = interfaces.ERC20LockBox_v2_0.encodeFunctionData(
          'applyAuthorizedCallerUpdates',
          [{ addedCallers: [caller], removedCallers: [] }],
        )
        const authUnsigned: UnsignedEVMTx = {
          family: ChainFamily.EVM,
          transactions: [{ to: lockBox, data: authData }],
        }
        await submitForReceipt(chain, wallet, authUnsigned, `${this.name}: authorizeCaller`)
      }
    }
    return super.execute(chain, params)
  }
}
