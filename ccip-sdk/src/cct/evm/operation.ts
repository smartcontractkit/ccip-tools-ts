/**
 * EVM {@link Operation} lifecycle: prepare (validate → parse) → encode → submit, plus the shared
 * wallet-sender pre-flight ({@link EVMOperation.resolveWalletSender}). Deployment ops extend
 * {@link EVMDeployOperation}, which also resolves the deployed address.
 *
 * @remarks The pre-flight *checks* live next to the contracts they read (`checkPoolOwner` in
 * `token-pool/contracts.ts`, `checkTokenOwner` in `token/contracts.ts`), so this generic base
 * carries no dependency on a specific operation. Each returns an {@link UnmetPrecondition} rather
 * than throwing; {@link EVMOperation.recordPreflight} here decides what happens to it.
 *
 * @packageDocumentation
 */

import { type Interface, getAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { type EVMChain, isSigner } from '../../evm/index.ts'
import type { UnmetPrecondition, UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../errors.ts'
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

/**
 * How a build should treat an on-chain requirement the current state does not meet.
 *
 * @remarks Applies only to pre-flight checks — reads of chain state an op performs to confirm the
 * chain is ready for its calldata (is the token registered, is `sender` the current admin). It has
 * no effect on parameter validation: a malformed address or an out-of-range `uint256` still throws
 * from `validate`/`parse` under either mode, because those invalidate the calldata itself.
 */
export type PreflightMode =
  /** Throw {@link CCTParamsInvalidError} on the first unmet requirement. The default. */
  | 'throw'
  /**
   * Return the calldata with the unmet requirements attached as
   * {@link UnsignedEVMTx.preconditions}.
   *
   * For building a transaction to be reviewed and signed later, where "not ready yet" is
   * information rather than an error — an earlier transaction in the same plan is often exactly
   * what makes the requirement true. {@link EVMOperation.execute} rejects them regardless of this
   * setting, since there "now" is the question being asked.
   */
  | 'report'

/** Mixin for op params that run pre-flight checks against chain state. */
export type PreflightParams = {
  /**
   * How to treat a pre-flight check the chain does not currently satisfy. Defaults to `'throw'`,
   * matching the behaviour of ops that predate this option.
   */
  preflight?: PreflightMode
}

/**
 * Rejects a transaction whose recorded requirements the chain does not currently meet — the
 * execute-path counterpart to `'report'`.
 *
 * @remarks Reports the first unmet requirement, matching the error the same state raises under
 * `'throw'`, so a caller sees one error for one chain state either way.
 * @throws {@link CCTParamsInvalidError} if `tx` carries any unmet precondition
 */
export function assertPreconditionsMet(operation: string, tx: UnsignedEVMTx): void {
  const unmet = tx.preconditions?.[0]
  if (unmet) throw new CCTParamsInvalidError(operation, unmet.param, unmet.reason)
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
   * Records the outcome of one pre-flight check, honouring the caller's {@link PreflightMode}:
   * a met requirement returns `tx` untouched, an unmet one throws under `'throw'` (the default)
   * or is attached to `tx` under `'report'`.
   *
   * @remarks Called from {@link buildUnsigned} *after* the calldata is encoded, so the `'report'`
   * path has something to attach to. Only for requirements whose failure says nothing about the
   * calldata — the bytes are correct either way, the question is whether the chain is ready for
   * them right now. Anything that invalidates the calldata belongs in `validate`/`parse`, which
   * throws under both modes.
   *
   * Chain ops that run several checks thread `tx` through one call each, rather than gathering
   * findings first. That keeps `'throw'` byte-for-byte what it was: the first unmet requirement
   * throws before the next check's RPC is issued, so the default mode makes exactly the reads,
   * in the order, it always did. Only `'report'` pays for the rest.
   * @param tx - The already-encoded transaction to attach to (or discard, when throwing).
   * @param preflight - The caller's mode; `undefined` means `'throw'`.
   * @param unmet - What the check found, or `undefined` if the chain satisfies it.
   * @param raise - Error to throw under `'throw'`. Defaults to {@link CCTParamsInvalidError}; the
   * liquidity checks pass their own so a converted call site keeps throwing the class it always
   * threw.
   * @throws whatever `raise` builds, unless `preflight` is `'report'`
   */
  protected recordPreflight(
    tx: UnsignedEVMTx,
    preflight: PreflightMode | undefined,
    unmet: UnmetPrecondition | undefined,
    raise?: (unmet: UnmetPrecondition) => Error,
  ): UnsignedEVMTx {
    if (!unmet) return tx
    if (preflight !== 'report')
      throw raise?.(unmet) ?? new CCTParamsInvalidError(this.name, unmet.param, unmet.reason)
    return { ...tx, preconditions: [...(tx.preconditions ?? []), unmet] }
  }

  /** Run {@link prepare} and {@link buildUnsigned}, applying optional `sender`; no signing. */
  async generate(chain: EVMChain, params: P): Promise<UnsignedEVMTx> {
    const parsed = this.prepare(params)
    if (params.sender !== undefined) validateAddress(this.name, 'sender', params.sender)
    const unsigned = await this.buildUnsigned(chain, parsed)
    if (params.sender && unsigned.transactions[0]) unsigned.transactions[0].from = params.sender
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
        `must be the executing wallet address (${walletAddress}) — use generateUnsigned${this.name[0]!.toUpperCase()}${this.name.slice(1)} for externally-signed transactions`,
      )
    return sender
  }

  /**
   * {@link generate}, then sign and submit; returns the confirmed tx hash.
   *
   * @remarks Any {@link UnmetPrecondition} the builder recorded is fatal here, unlike on the
   * `generateUnsigned*` path: submitting now means the current chain state is the one that
   * counts, and sending a transaction whose requirement is unmet just buys an on-chain revert.
   * @throws {@link CCTParamsInvalidError} if the chain does not currently satisfy a requirement
   * the op recorded while building
   */
  async execute(chain: EVMChain, params: EVMExecuteParams<P>): Promise<TransactionResult> {
    const unsigned = await this.generate(chain, params)
    assertPreconditionsMet(this.name, unsigned)
    const { response } = await submit(chain, params.wallet, unsigned, this.name)
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
    const unsigned = await this.generate(chain, params)
    const { contract, iface } = this.artifact(params)
    // Same value `buildUnsigned` appended to the bytecode. Taken from `encode` rather than
    // sliced back out of the init-code, so it stays correct regardless of the tx layout.
    const encodedConstructorArgs = this.encode(iface, params)
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
