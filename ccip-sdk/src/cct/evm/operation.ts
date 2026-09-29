/**
 * EVM {@link Operation} lifecycle: prepare (validate → parse) → encode → report
 * ({@link EVMOperation.preconditions}) → submit, plus the shared wallet-sender pre-flight
 * ({@link EVMOperation.resolveWalletSender}). Deployment ops extend {@link EVMDeployOperation},
 * which also resolves the deployed address.
 *
 * @remarks Two channels, deliberately: a malformed parameter always throws from `validate`/`parse`
 * before any RPC, while chain state an earlier transaction could still change is collected by
 * {@link EVMOperation.preconditions} and raised as a {@link CCTPreconditionError} that carries the
 * built transaction — so an op can be planned ahead of the state it needs.
 *
 * @remarks The per-contract probes those overrides call live in the layer that owns the contract,
 * as free `check*` helpers (`checkPoolOwner` in `token-pool/contracts.ts`), so this generic base
 * carries no dependency on a specific operation.
 *
 * @packageDocumentation
 */

import { type Interface, getAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { type EVMChain, isSigner } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily } from '../../networks.ts'
import {
  type PreconditionError,
  CCTParamsInvalidError,
  CCTPreconditionError,
  CCTTxFailedError,
} from '../errors.ts'
import { type ExecuteParams, type TransactionResult, Operation } from '../operation.ts'
import { submit } from './submit.ts'
import { validateAddress } from './validate.ts'

/** Assembles a contract-deployment tx (no `to`): creation bytecode + ABI-encoded ctor args. */
export function deployTx(bytecode: `0x${string}`, ctorArgs: string): UnsignedEVMTx {
  return {
    family: ChainFamily.EVM,
    transactions: [{ data: bytecode + ctorArgs.slice(2) }],
  }
}

/** Assembles an unsigned call to an existing contract: `to` + ABI-encoded calldata. */
export function callTx(to: string, data: string): UnsignedEVMTx {
  return { family: ChainFamily.EVM, transactions: [{ to, data }] }
}

/**
 * Collects what the `check*` probes found into the array
 * {@link EVMOperation.preconditions} returns, dropping the ones that passed. Flattens, so a probe
 * that reports several requirements at once passes straight through.
 * @example
 * ```typescript
 * return unmet(...(await Promise.all([
 *   checkPoolOwner(chain, poolAddress, sender),
 *   checkPoolLiquidity(chain, poolAddress, amount),
 * ])))
 * ```
 */
export function unmet(
  ...found: (PreconditionError | PreconditionError[] | undefined)[]
): PreconditionError[] {
  return found.flat().filter((error) => error !== undefined)
}

/**
 * The deploy-side inputs a block explorer needs to verify a contract's source: its name and
 * ABI-encoded constructor args, captured while deploying with no extra RPC.
 * @remarks A constructor-args companion, *not* proof of verification — nothing here is read back
 * from the chain or submitted anywhere. A full submission also needs the source/compiler side
 * (standard-json input plus the matching solc version and settings), which this SDK does not
 * vendor; those ship in the `@chainlink/contracts-ccip` package.
 *
 * Only available from `execute`, which deploys and so learns the address. The
 * `generateUnsigned*` builders return the unsigned tx alone.
 * @example Verifying on Etherscan, whose "Constructor Arguments" field wants the args bare:
 * ```typescript
 * const { contractAddress, verification } = await cct.deployTokenPool({ ...params, wallet })
 * console.log(verification.contract) // 'LockReleaseTokenPool'
 * console.log(verification.encodedConstructorArgs.slice(2)) // drop the `0x`
 * ```
 */
export interface ExplorerVerificationInput {
  /** Contract name as compiled, e.g. `BurnMintTokenPool`; unqualified, matching the artifact. */
  contract: string
  /** 0x-prefixed ABI-encoded constructor args, or just `0x` when the constructor takes none. */
  encodedConstructorArgs: string
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
 * contract address (token, pool, etc.). Also carries the
 * {@link ExplorerVerificationInput} needed to verify the contract's source on a
 * block explorer — additive, so readers of `{ hash, contractAddress }` are unaffected.
 */
export type DeployResult = TransactionResult & {
  contractAddress: string
  verification: ExplorerVerificationInput
}

/**
 * EVM CCT write base. Subclasses supply {@link parse} (or {@link validate}) and
 * {@link buildUnsigned}; {@link execute} signs and submits, returning the confirmed tx hash. Ops
 * that resolve to more (e.g. a deployed address) extend {@link EVMDeployOperation}.
 */
export abstract class EVMOperation<P extends { sender?: string }, Parsed = P> extends Operation<
  EVMChain,
  P,
  UnsignedEVMTx,
  TransactionResult,
  Parsed
> {
  /** Build calldata into an unsigned tx; versioned ops resolve their encoder here. */
  protected abstract buildUnsigned(
    chain: EVMChain,
    params: Parsed,
  ): Promise<UnsignedEVMTx> | UnsignedEVMTx

  /**
   * Report on-chain requirements this op needs met that currently are not — `sender` is not the
   * pool owner, no administrator is pending, the pool holds no liquidity. Runs after
   * {@link buildUnsigned} and after `sender` has been applied, so the tx handed to
   * {@link CCTPreconditionError} is the one the happy path would have returned. `tx` is passed for
   * an override that needs what the builder produced; most instead re-derive from `params`, since
   * the reads behind that are memoized on {@link EVMChain} and `tx.transactions[0].to` is only
   * typed as a loose `AddressLike`.
   *
   * None by default. Overriding ops return **every** unmet requirement rather than the first, so a
   * caller planning a transaction sees the whole gap in one pass; batch the reads with
   * `Promise.all` where they are independent. An empty array means the chain is ready now.
   *
   * @remarks Only *report* state an earlier transaction could change. A requirement fixed at
   * deployment (`allowlistEnabled`, `acceptLiquidity`) or one that decides *which* calldata to
   * build belongs in {@link buildUnsigned} as a throw — there is no plan in which reporting it
   * helps. An override may still throw for a fatal finding that shares a read with a reportable
   * one, rather than paying for the same `eth_call` in both places: `mint`'s single `isMinter`
   * read is both its contract-family check (fatal) and its role check (reported).
   */
  protected preconditions(
    _chain: EVMChain,
    _params: Parsed,
    _tx: UnsignedEVMTx,
  ): Promise<PreconditionError[]> | PreconditionError[] {
    return []
  }

  /**
   * Run {@link prepare} and {@link buildUnsigned}, applying optional `sender`; no signing.
   * @throws {@link CCTPreconditionError} if {@link preconditions} reports unmet on-chain state —
   * carrying the built tx, so a caller batching this behind the step that satisfies it can still
   * take the calldata
   */
  async generate(chain: EVMChain, params: P): Promise<UnsignedEVMTx> {
    const parsed = this.prepare(params)
    if (params.sender !== undefined) validateAddress(this.name, 'sender', params.sender)
    const unsigned = await this.buildUnsigned(chain, parsed)
    if (params.sender && unsigned.transactions[0]) unsigned.transactions[0].from = params.sender
    const found = await this.preconditions(chain, parsed, unsigned)
    if (found.length) throw new CCTPreconditionError(this.name, found, unsigned)
    return unsigned
  }

  /**
   * Resolves the address a signed submission is authorized against: the signing wallet's own.
   * The chain gates on `msg.sender`, and {@link submit} clears any builder-set `tx.from` before
   * populating the tx (so ethers' own from/signer guard never fires) — an explicit `sender` that
   * differs from the wallet would therefore let an op's pre-tx checks authorize one address while
   * a different one actually signs, passing every local guard and reverting on-chain. Ops that
   * gate on an on-chain role call this from `execute`; build with `generateUnsigned*` instead
   * when the eventual signer isn't known yet, where `sender` is trusted as given.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address
   */
  protected async resolveWalletSender(wallet: unknown, sender?: string): Promise<string> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)
    const walletAddress = await wallet.getAddress()
    if (sender === undefined) return walletAddress
    // Validated before `getAddress`, which throws a raw ethers TypeError on a malformed string.
    // This runs ahead of `generate`'s own validate(), so without it the documented
    // CCTParamsInvalidError contract would leak an ethers error for a bad `sender`.
    validateAddress(this.name, 'sender', sender)
    if (getAddress(sender) !== getAddress(walletAddress))
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must be the executing wallet address (${walletAddress}) — use generateUnsigned${this.name[0]!.toUpperCase()}${this.name.slice(
          1,
        )} for externally-signed transactions`,
      )
    return sender
  }

  /** {@link generate}, then sign and submit; returns the confirmed tx hash. */
  async execute(chain: EVMChain, params: EVMExecuteParams<P>): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    const { response } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, { ...params, sender }),
      this.name,
    )
    return { hash: response.hash }
  }
}

/**
 * EVM contract-deployment base. Subclasses supply {@link validate}, {@link artifact} (name +
 * ctor {@link Interface} + creation bytecode), and {@link encode}; the base wires
 * {@link buildUnsigned} (init-code = bytecode + encoded ctor args) and {@link execute} (submit,
 * then read the deployed address and pair it with an {@link ExplorerVerificationInput}).
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
   * contract address (read from the mined receipt), plus the
   * {@link ExplorerVerificationInput} for verifying its source on a block explorer.
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(chain: EVMChain, params: EVMExecuteParams<P>): Promise<DeployResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    const executionParams = { ...params, sender }

    const unsigned = await this.generate(chain, executionParams)
    const { contract, iface } = this.artifact(executionParams)
    // Same value `buildUnsigned` appended to the bytecode. Taken from `encode` rather than
    // sliced back out of the init-code, so it stays correct regardless of the tx layout.
    const encodedConstructorArgs = this.encode(iface, executionParams)
    const { response, receipt } = await submit(chain, params.wallet, unsigned, this.name)
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'deployment produced no contract address', {
        context: { txHash: response.hash },
      })
    return {
      hash: response.hash,
      contractAddress: receipt.contractAddress,
      verification: { contract, encodedConstructorArgs },
    }
  }
}
