/**
 * deployLockbox — deploys an `ERC20LockBox` (v2.0.0) via raw init-code. The tx has no
 * `to`; `execute` returns the deployed contract address. A lockbox escrows a single token
 * for `LockReleaseTokenPool`s; deploy it before the pool, then authorize the pool on it via
 * `authorizeLockboxCallers`. Mirrors `token-pool/operations/deploy-token-pool.ts`.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import {
  type DeployResult,
  type EVMExecuteParams,
  EVMOperation,
  deploymentTx,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import { validateAddress } from '../../validate.ts'
import { LOCKBOX_BYTECODE, LOCKBOX_INTERFACE } from '../interface.ts'

/** Parameters for {@link DeployLockbox} — deploys `ERC20LockBox` (v2.0.0). */
export interface DeployLockboxParams {
  /** Address of the token the lockbox escrows; the v2.0.0 constructor reverts on the zero address. */
  token: string
  /** Deployer address; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Deploys an `ERC20LockBox`; `execute` resolves to `{ hash, contractAddress }`. */
export class DeployLockbox extends EVMOperation<DeployLockboxParams> {
  readonly name = 'deployLockbox'

  /** Validates the constructor params before building init-code. */
  protected validate(params: DeployLockboxParams): void {
    validateAddress(this.name, 'token', params.token)
    if (params.token === ZeroAddress)
      throw new CCTParamsInvalidError(this.name, 'token', 'must not be the zero address')
  }

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, params: DeployLockboxParams): UnsignedEVMTx {
    return deploymentTx(LOCKBOX_BYTECODE, LOCKBOX_INTERFACE.encodeDeploy([params.token]))
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly deployed
   * lockbox address (read from the mined receipt).
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<DeployLockboxParams>,
  ): Promise<DeployResult> {
    const { response, receipt } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'deployment produced no contract address', {
        context: { txHash: response.hash },
      })
    return { hash: response.hash, contractAddress: receipt.contractAddress }
  }
}
