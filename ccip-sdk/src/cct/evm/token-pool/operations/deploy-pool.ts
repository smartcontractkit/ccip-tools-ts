/**
 * deployPool — deploys a canonical CCT v2.0 CCIP token pool (BurnMint or LockRelease).
 *
 * Signed `execute` (multi-step for lock-release): auto-deploys an `ERC20LockBox` bound
 * to the token (if none supplied), deploys the pool, then authorizes the pool as a
 * caller on the lockbox. Returns the deployed `poolAddress` (+ `lockBoxAddress`).
 *
 * The unsigned `generate` path builds only the pool-creation tx and requires an existing
 * `lockBoxAddress` for lock-release (it cannot predict an auto-deployed lockbox address).
 *
 * @packageDocumentation
 */

import { type TransactionReceipt, AbiCoder, Contract, ZeroAddress, concat } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import { type EVMChain, isSigner, submitTransaction } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { type DeployVerification, buildDeployVerification } from '../../deploy-verification.ts'
import { EVMOperation } from '../../operation.ts'
import { submitForReceipt } from '../../submit.ts'
import { BURN_MINT_TOKEN_POOL_BYTECODE } from '../bytecodes/BurnMintTokenPool.ts'
import { ERC20_LOCK_BOX_BYTECODE } from '../bytecodes/ERC20LockBox.ts'
import { LOCK_RELEASE_TOKEN_POOL_BYTECODE } from '../bytecodes/LockReleaseTokenPool.ts'

/** Which pool contract to deploy. */
export type EVMPoolType = 'burn-mint' | 'lock-release'

/** Parameters for `deployPool`. */
export type DeployPoolParams = {
  poolType: EVMPoolType
  tokenAddress: string
  localTokenDecimals: number
  /** CCIP Router; `rmnProxy` is derived from it via `Router.getArmProxy()`. */
  routerAddress: string
  /** Advanced pool hooks contract. Defaults to the zero address. */
  advancedPoolHooks?: string
  /**
   * `lock-release` only: an existing `ERC20LockBox`. Required on the unsigned path;
   * the signed path auto-deploys one when omitted.
   */
  lockBoxAddress?: string
  sender?: string
}

/** Result of a signed `deployPool`: tx hash, deployed pool address, and (lock-release) lockbox. */
export type DeployPoolResult = TransactionHash & {
  poolAddress: string
  /** EVM lock-release only: the `ERC20LockBox` bound to the token. */
  lockBoxAddress?: string
  /** Block-explorer verification handle for the deployed pool. */
  verification: DeployVerification
  /** Verification handle for the auto-deployed `ERC20LockBox` (lock-release only). */
  lockBoxVerification?: DeployVerification
}

/** Deploys a CCIP token pool (BurnMint or LockRelease). */
export class DeployPool extends EVMOperation<DeployPoolParams, DeployPoolResult> {
  readonly name = 'deployPool'

  /** Validates pool params (lockBoxAddress required on the unsigned lock-release path). */
  protected validate(p: DeployPoolParams): void {
    if (p.poolType !== 'burn-mint' && p.poolType !== 'lock-release')
      throw new CCTParamsInvalidError(
        this.name,
        'poolType',
        "must be 'burn-mint' or 'lock-release'",
      )
    if (!p.tokenAddress || p.tokenAddress.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'tokenAddress', 'must be non-empty')
    if (!p.routerAddress || p.routerAddress.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'routerAddress', 'must be non-empty')
    if (p.localTokenDecimals < 0 || p.localTokenDecimals > 255)
      throw new CCTParamsInvalidError(this.name, 'localTokenDecimals', 'must be 0-255')
    if (
      p.poolType === 'lock-release' &&
      (!p.lockBoxAddress || p.lockBoxAddress.trim().length === 0)
    )
      throw new CCTParamsInvalidError(
        this.name,
        'lockBoxAddress',
        'required to build a lock-release pool deploy (the signed deployPool auto-deploys an ERC20LockBox)',
      )
  }

  /** Reads `rmnProxy` from the router via `Router.getArmProxy()`. */
  private async deriveRmnProxy(chain: EVMChain, routerAddress: string): Promise<string> {
    const router = new Contract(routerAddress, interfaces.Router, chain.provider)
    return (await router.getFunction('getArmProxy')()) as string
  }

  /** Builds the pool contract-creation tx (constructor args + bytecode). */
  protected async buildUnsigned(chain: EVMChain, p: DeployPoolParams): Promise<UnsignedEVMTx> {
    const rmnProxy = await this.deriveRmnProxy(chain, p.routerAddress)
    const advancedPoolHooks = p.advancedPoolHooks ?? ZeroAddress
    const coder = AbiCoder.defaultAbiCoder()

    let data: string
    if (p.poolType === 'burn-mint') {
      const encodedArgs = coder.encode(
        ['address', 'uint8', 'address', 'address', 'address'],
        [p.tokenAddress, p.localTokenDecimals, advancedPoolHooks, rmnProxy, p.routerAddress],
      )
      data = concat([BURN_MINT_TOKEN_POOL_BYTECODE, encodedArgs])
    } else {
      const encodedArgs = coder.encode(
        ['address', 'uint8', 'address', 'address', 'address', 'address'],
        [
          p.tokenAddress,
          p.localTokenDecimals,
          advancedPoolHooks,
          rmnProxy,
          p.routerAddress,
          p.lockBoxAddress!,
        ],
      )
      data = concat([LOCK_RELEASE_TOKEN_POOL_BYTECODE, encodedArgs])
    }
    return { family: ChainFamily.EVM, transactions: [{ to: null, data }] }
  }

  /**
   * Signed multi-step deploy: (1) auto-deploy an ERC20LockBox for lock-release pools
   * without one, (2) deploy the pool, (3) authorize the pool on the auto-deployed lockbox.
   */
  override async execute(
    chain: EVMChain,
    params: DeployPoolParams & { wallet: unknown },
  ): Promise<DeployPoolResult> {
    const { wallet } = params
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    // (1) auto-deploy the ERC20LockBox for lock-release pools lacking one.
    let lockBoxAddress = params.lockBoxAddress
    let autoDeployedLockBox = false
    let lockBoxVerification: DeployVerification | undefined
    if (params.poolType === 'lock-release' && !lockBoxAddress) {
      const lockBoxArgs = AbiCoder.defaultAbiCoder().encode(['address'], [params.tokenAddress])
      const lockBoxData = concat([ERC20_LOCK_BOX_BYTECODE, lockBoxArgs])
      const { receipt } = await submitForReceipt(
        chain,
        wallet,
        { family: ChainFamily.EVM, transactions: [{ to: null, data: lockBoxData }] },
        `${this.name}: ERC20LockBox`,
      )
      lockBoxAddress = this.#contractAddress(receipt, 'ERC20LockBox')
      autoDeployedLockBox = true
      lockBoxVerification = buildDeployVerification(
        'ERC20LockBox',
        lockBoxData,
        ERC20_LOCK_BOX_BYTECODE,
      )
    }

    // (2) deploy the pool.
    const unsigned = await this.generate(chain, { ...params, lockBoxAddress })
    const { hash, receipt } = await submitForReceipt(chain, wallet, unsigned, this.name)
    const poolAddress = this.#contractAddress(receipt, 'pool')
    const verification = buildDeployVerification(
      params.poolType === 'burn-mint' ? 'BurnMintTokenPool' : 'LockReleaseTokenPool',
      unsigned.transactions[0]!.data!,
      params.poolType === 'burn-mint'
        ? BURN_MINT_TOKEN_POOL_BYTECODE
        : LOCK_RELEASE_TOKEN_POOL_BYTECODE,
    )

    // (3) authorize the pool as a caller on the auto-deployed lockbox.
    if (autoDeployedLockBox && lockBoxAddress) {
      const authData = interfaces.ERC20LockBox_v2_0.encodeFunctionData(
        'applyAuthorizedCallerUpdates',
        [{ addedCallers: [poolAddress], removedCallers: [] }],
      )
      const authTx = await wallet.populateTransaction({ to: lockBoxAddress, data: authData })
      authTx.from = undefined
      const response = await submitTransaction(wallet, authTx, chain.provider)
      await response.wait(1, 60_000)
    }

    return {
      hash,
      poolAddress,
      ...(lockBoxAddress ? { lockBoxAddress } : {}),
      verification,
      ...(lockBoxVerification ? { lockBoxVerification } : {}),
    }
  }

  /** Returns the deployed contract address from a creation receipt, or throws. */
  #contractAddress(receipt: TransactionReceipt, what: string): string {
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, `no ${what} address in deploy receipt`, {
        context: { txHash: receipt.hash },
      })
    return receipt.contractAddress
  }
}
