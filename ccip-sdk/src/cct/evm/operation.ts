/**
 * EVM {@link Operation} lifecycle: validate → encode → submit.
 * Concrete ops implement {@link EVMOperation.buildUnsigned}; the base wires
 * {@link generate} and {@link execute}. Ops needing more than a tx hash (e.g. a
 * deployment's address) override {@link execute}, reusing {@link submit}.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { type TransactionResult, Operation } from '../operation.ts'
import { submit } from './submit.ts'

/**
 * EVM CCT write base. Subclasses supply {@link validate} and {@link buildUnsigned};
 * {@link execute} signs and submits, returning the confirmed tx hash. Ops that
 * resolve to more (e.g. a deployed address) override {@link execute}.
 */
export abstract class EVMOperation<P extends { sender?: string }> extends Operation<
  EVMChain,
  P,
  UnsignedEVMTx,
  TransactionResult
> {
  /** Build calldata into an unsigned tx; versioned ops resolve their encoder here. */
  protected abstract buildUnsigned(
    chain: EVMChain,
    params: P,
  ): Promise<UnsignedEVMTx> | UnsignedEVMTx

  /** Run {@link validate} and {@link buildUnsigned}, applying optional `sender`; no signing. */
  async generate(chain: EVMChain, params: P): Promise<UnsignedEVMTx> {
    this.validate(params)
    const unsigned = await this.buildUnsigned(chain, params)
    if (params.sender && unsigned.transactions[0]) unsigned.transactions[0].from = params.sender
    return unsigned
  }

  /** {@link generate}, then sign and submit; returns the confirmed tx hash. */
  async execute(chain: EVMChain, params: P & { wallet: unknown }): Promise<TransactionResult> {
    const { response } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    return { hash: response.hash }
  }
}
