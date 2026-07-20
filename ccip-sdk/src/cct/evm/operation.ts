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
import { ChainFamily } from '../../networks.ts'
import { type ExecuteParams, type TransactionResult, Operation } from '../operation.ts'
import { submit } from './submit.ts'
import { validateAddress } from './validate.ts'

/** Assembles a contract-deployment tx (no `to`): creation bytecode + ABI-encoded ctor args. */
export function deploymentTx(bytecode: `0x${string}`, ctorArgs: string): UnsignedEVMTx {
  return { family: ChainFamily.EVM, transactions: [{ data: bytecode + ctorArgs.slice(2) }] }
}

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
    if (params.sender !== undefined) validateAddress(this.name, 'sender', params.sender)
    const unsigned = await this.buildUnsigned(chain, params)
    if (params.sender && unsigned.transactions[0]) unsigned.transactions[0].from = params.sender
    return unsigned
  }

  /** {@link generate}, then sign and submit; returns the confirmed tx hash. */
  async execute(chain: EVMChain, params: ExecuteParams<P>): Promise<TransactionResult> {
    const { response } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    return { hash: response.hash }
  }
}
