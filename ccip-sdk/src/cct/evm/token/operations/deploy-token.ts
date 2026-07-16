/**
 * deployToken — deploys a `BurnMintERC677Token` (v1.5.1) via raw init-code.
 * The tx has no `to`; `execute` returns the deployed contract address.
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTTxFailedError } from '../../../errors.ts'
import { type DeployResult, type EVMExecuteParams, EVMOperation } from '../../operation.ts'
import { submit } from '../../submit.ts'
import { validateNonEmptyString, validateUint256, validateUint8 } from '../../validate.ts'
import { BURN_MINT_ERC677_BYTECODE } from '../bytecode.ts'

/** Parameters for {@link DeployToken}. */
export interface DeployTokenParams {
  name: string
  symbol: string
  decimals: number
  /** Max supply cap; `0n` means unlimited. */
  maxSupply: bigint
  sender?: string
}

/** Deploys a `BurnMintERC677Token`; `execute` resolves to `{ hash, address }`. */
export class DeployToken extends EVMOperation<DeployTokenParams> {
  readonly name = 'deployToken'

  /** Validates the constructor params before building init-code. */
  protected validate({ name, symbol, decimals, maxSupply }: DeployTokenParams): void {
    validateNonEmptyString(this.name, 'name', name)
    validateNonEmptyString(this.name, 'symbol', symbol)
    validateUint8(this.name, 'decimals', decimals)
    validateUint256(this.name, 'maxSupply', maxSupply)
  }

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, p: DeployTokenParams): UnsignedEVMTx {
    const args = interfaces.Token.encodeDeploy([p.name, p.symbol, p.decimals, p.maxSupply])
    const data = BURN_MINT_ERC677_BYTECODE + args.slice(2)
    return { family: ChainFamily.EVM, transactions: [{ data }] }
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly
   * deployed contract address (read from the mined receipt).
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<DeployTokenParams>,
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
        // override the default CCT_TX_FAILED hint to point tx has mined but receipt carried no address
        recovery:
          'Deployment mined but the receipt carried no contract address; re-fetch it by tx hash or retry against a different RPC.',
      })
    return { hash: response.hash, contractAddress: receipt.contractAddress }
  }
}
