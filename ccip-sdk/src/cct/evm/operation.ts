/**
 * EVM {@link Operation} lifecycle: validate → encode → submit.
 * Concrete ops implement {@link EVMOperation.buildUnsigned}; the base wires
 * {@link generate} and {@link execute}. Deployment ops instead extend
 * {@link EVMDeployOperation}, supplying a {@link DeployArtifact} and constructor-arg
 * encoding while inheriting a deploy-aware {@link execute} that also returns the
 * deployed address, reusing {@link submit}.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTTxFailedError } from '../errors.ts'
import { type ExecuteParams, type TransactionResult, Operation } from '../operation.ts'
import { submit } from './submit.ts'
import { validateAddress } from './validate.ts'

/** Assembles a contract-deployment tx (no `to`): creation bytecode + ABI-encoded ctor args. */
export function deployTx(bytecode: `0x${string}`, ctorArgs: string): UnsignedEVMTx {
  return { family: ChainFamily.EVM, transactions: [{ data: bytecode + ctorArgs.slice(2) }] }
}

/** Assembles an unsigned call to an existing contract: `to` + ABI-encoded calldata. */
export function callTx(to: string, data: string): UnsignedEVMTx {
  return { family: ChainFamily.EVM, transactions: [{ to, data }] }
}

/** Block-explorer verification handle for a deployed contract: its name and ABI-encoded ctor args. */
export interface DeployVerification {
  contract: string
  encodedConstructorArgs: string
}

/**
 * Recovers the verification handle from a deployment's init-code with no extra RPC.
 * {@link deployTx} builds `data = bytecode + ctorArgs.slice(2)`, so slicing off
 * `bytecode.length` chars recovers the (0x-prefixed) ABI-encoded constructor args.
 */
export function buildDeployVerification(
  contract: string,
  deployData: string,
  bytecode: string,
): DeployVerification {
  return { contract, encodedConstructorArgs: `0x${deployData.slice(bytecode.length)}` }
}

/**
 * A contract deploy artifact: the contract name (for verification), the cached constructor
 * {@link Interface}, and the creation bytecode. Field is `iface` (not `interface`, a reserved word).
 */
export interface DeployArtifact {
  contract: string
  iface: Interface
  bytecode: `0x${string}`
}

/** EVM {@link ExecuteParams} — EVM ops need nothing beyond the signing `wallet`. */
export type EVMExecuteParams<P extends object> = ExecuteParams<P>

/**
 * Result of a successful EVM deployment write: the tx hash plus the deployed
 * contract address (token, pool, etc.). Also carries a {@link DeployVerification}
 * handle (contract name + ABI-encoded ctor args) recovered from the init-code at
 * deploy time — additive, so readers of `{ hash, contractAddress }` are unaffected.
 */
export type DeployResult = TransactionResult & {
  contractAddress: string
  verification: DeployVerification
}

/**
 * EVM CCT write base. Subclasses supply {@link validate} and {@link buildUnsigned};
 * {@link execute} signs and submits, returning the confirmed tx hash. Ops that
 * resolve to more (e.g. a deployed address) extend {@link EVMDeployOperation}.
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
  async execute(chain: EVMChain, params: EVMExecuteParams<P>): Promise<TransactionResult> {
    const { response } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    return { hash: response.hash }
  }
}

/**
 * EVM contract-deployment base. Subclasses supply {@link validate}, {@link artifact} (name +
 * ctor {@link Interface} + creation bytecode), and {@link encode}; the base wires
 * {@link buildUnsigned} (init-code = bytecode + encoded ctor args) and {@link execute} (submit,
 * then read the deployed address and recover a {@link DeployVerification} from the init-code).
 */
export abstract class EVMDeployOperation<P extends { sender?: string }> extends EVMOperation<P> {
  /** Contract name, ctor {@link Interface}, and creation bytecode for this deployment. */
  protected abstract artifact(params: P): DeployArtifact

  /** ABI-encodes the constructor args (0x-prefixed) for this deployment. */
  protected abstract encode(iface: Interface, params: P): string

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, params: P): UnsignedEVMTx {
    const a = this.artifact(params)
    return deployTx(a.bytecode, this.encode(a.iface, params))
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly deployed
   * contract address (read from the mined receipt), plus a {@link DeployVerification} handle
   * recovered from the init-code.
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(chain: EVMChain, params: EVMExecuteParams<P>): Promise<DeployResult> {
    const unsigned = await this.generate(chain, params)
    const data = unsigned.transactions[0]?.data
    if (data == null) throw new CCTTxFailedError(this.name, 'deployment tx has no init-code')
    const { contract, bytecode } = this.artifact(params)
    const { response, receipt } = await submit(chain, params.wallet, unsigned, this.name)
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'deployment produced no contract address', {
        context: { txHash: response.hash },
      })
    return {
      hash: response.hash,
      contractAddress: receipt.contractAddress,
      verification: buildDeployVerification(contract, data, bytecode),
    }
  }
}
