/**
 * EVM {@link Operation} lifecycle: validate → encode → submit.
 * Concrete ops implement {@link EVMOperation.encode}; this base wires
 * {@link generate} and {@link execute}.
 *
 * @packageDocumentation
 */

import type { TransactionReceipt } from 'ethers'

import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { type TransactionHash, Operation } from '../operation.ts'
import { submitForReceipt } from './submit.ts'

/**
 * EVM CCT write base. Subclasses supply {@link validate} and {@link buildUnsigned}.
 * `Result` defaults to {@link TransactionHash}; deploy ops widen it (e.g. to add
 * `tokenAddress`) and override {@link resultFromReceipt} to read the mined receipt.
 */
export abstract class EVMOperation<
  P extends { sender?: string },
  Result = TransactionHash,
> extends Operation<EVMChain, P, UnsignedEVMTx, Result> {
  /** Build calldata into an unsigned tx; versioned ops resolve their encoder here. */
  protected abstract buildUnsigned(
    chain: EVMChain,
    params: P,
  ): Promise<UnsignedEVMTx> | UnsignedEVMTx

  /**
   * Map the confirmed hash + mined receipt of the last submitted tx to the op's
   * result. Default returns just the hash; deploy ops override to add the deployed
   * address (`receipt.contractAddress`) and, from the submitted `unsigned` calldata,
   * a block-explorer `verification` handle.
   */
  protected resultFromReceipt(
    hash: TransactionHash,
    _receipt: TransactionReceipt,
    _unsigned: UnsignedEVMTx,
  ): Result {
    return hash as Result
  }

  /** Run {@link validate} and {@link buildUnsigned}, applying optional `sender`; no signing. */
  async generate(chain: EVMChain, params: P): Promise<UnsignedEVMTx> {
    this.validate(params)
    const unsigned = await this.buildUnsigned(chain, params)
    if (params.sender && unsigned.transactions[0]) unsigned.transactions[0].from = params.sender
    return unsigned
  }

  /** {@link generate}, then sign and submit; returns once confirmed. */
  async execute(chain: EVMChain, params: P & { wallet: unknown }): Promise<Result> {
    const unsigned = await this.generate(chain, params)
    const { hash, receipt } = await submitForReceipt(chain, params.wallet, unsigned, this.name)
    return this.resultFromReceipt({ hash }, receipt, unsigned)
  }
}
