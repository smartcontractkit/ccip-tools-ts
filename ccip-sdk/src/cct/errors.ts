/**
 * CCT-specific error classes for write operations (validate → encode → submit).
 * Shared CCIP errors (`CCIPWalletInvalidError`, etc.) live in `../errors/`.
 *
 * @packageDocumentation
 */

import { type CCIPErrorOptions, CCIPError, CCIPErrorCode } from '../errors/index.ts'
import type { UnsignedEVMTx } from '../evm/types.ts'

// Parameter validation

/**
 * Thrown before any RPC when operation params fail validation. Permanent.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.setPool({ tokenAddress: 'not-an-address', poolAddress, address, wallet })
 * } catch (error) {
 *   if (error instanceof CCTParamsInvalidError) {
 *     console.log(`Invalid ${error.context.operation} param "${error.context.param}"`)
 *   }
 * }
 * ```
 */
export class CCTParamsInvalidError extends CCIPError {
  // Widened to `string`, as on {@link CCIPError} itself, because {@link CCTPreconditionError}
  // narrows it further; a literal type here would claim every instance is the base class.
  override readonly name: string = 'CCTParamsInvalidError'
  /** Creates a params-invalid error. */
  constructor(operation: string, param: string, reason: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_PARAMS_INVALID,
      `Invalid ${operation} parameter "${param}": ${reason}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, operation, param, reason },
      },
    )
  }
}

/**
 * Thrown when a supplied SPL token account belongs to a different mint than requested.
 *
 * `context.requestedMint` is the requested mint; `context.resolvedMint` is decoded from the supplied
 * token account. This is permanent: supply an account for the requested mint.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.generateUnsignedApproveToken({ payer, tokenAddress, tokenAccount, delegate, amount })
 * } catch (error) {
 *   if (error instanceof CCTTokenAccountMintMismatchError) {
 *     console.log(error.context.requestedMint, error.context.resolvedMint)
 *   }
 * }
 * ```
 */
export class CCTTokenAccountMintMismatchError extends CCIPError {
  override readonly name = 'CCTTokenAccountMintMismatchError'
  /** Creates a token-account mint-mismatch error. */
  constructor(tokenAccount: string, requestedMint: string, resolvedMint: string) {
    super(
      CCIPErrorCode.CCT_TOKEN_ACCOUNT_MINT_MISMATCH,
      `Token account mint mismatch for ${tokenAccount}: expected ${requestedMint}, got ${resolvedMint}`,
      {
        isTransient: false,
        context: { tokenAccount, requestedMint, resolvedMint },
      },
    )
  }
}

/**
 * One on-chain requirement an operation found unmet, blamed on the parameter a caller would
 * change (or whose value an earlier transaction would have to produce) to satisfy it.
 */
export type PreconditionError = {
  /** Operation parameter the unmet requirement is blamed on, e.g. `'sender'`. */
  param: string
  /** What the chain requires, phrased as a predicate on `param`. */
  reason: string
}

/**
 * Thrown when an operation's params are well-formed but the chain is not in the state the
 * transaction needs — `sender` is not the pool owner yet, no administrator is pending, the pool
 * holds no liquidity to withdraw. Permanent for the state read, but not for the plan: unlike its
 * {@link CCTParamsInvalidError} base, every requirement reported here is one an earlier
 * transaction can satisfy.
 *
 * Carries the calldata it would have returned. The checks run against state as it is *now*, so an
 * op whose prerequisites are created by an earlier step of the same plan reports them here while
 * still handing back a usable {@link CCTPreconditionError.unsigned} — which is what lets
 * `registerAdmin → acceptAdmin`, `setRebalancer → transferLiquidity` or `grantMintRole → mint` be
 * built as one batch and signed later.
 *
 * Extends {@link CCTParamsInvalidError}, so callers that only catch that keep working: `context`
 * carries the first entry's `param` and the reasons joined, and the full list is on
 * {@link CCTPreconditionError.errors}.
 *
 * @example Building a plan step whose prerequisites an earlier step will create
 * ```typescript
 * let unsigned
 * try {
 *   unsigned = await cct.generateUnsignedAcceptAdmin({ tokenAddress, address, sender: safe })
 * } catch (error) {
 *   if (!(error instanceof CCTPreconditionError)) throw error
 *   // e.g. [{ param: 'sender', reason: 'must be the pending token administrator (0x00…00)' }]
 *   console.log(error.errors)
 *   unsigned = error.unsigned // the same calldata the happy path would have returned
 * }
 * ```
 */
export class CCTPreconditionError<Tx = UnsignedEVMTx> extends CCTParamsInvalidError {
  override readonly name: string = 'CCTPreconditionError'
  /** Every unmet requirement found, in check order. Never empty. */
  readonly errors: PreconditionError[]
  /** The transaction the operation built, prerequisites aside — the calldata to plan with. */
  readonly unsigned: Tx

  /**
   * Creates a precondition error.
   * @param errors - every unmet requirement found, in check order; must not be empty
   * @param unsigned - the transaction the operation built, prerequisites aside
   */
  constructor(
    operation: string,
    errors: PreconditionError[],
    unsigned: Tx,
    options?: CCIPErrorOptions,
  ) {
    super(operation, errors[0]!.param, errors.map(({ reason }) => reason).join('; '), options)
    this.errors = errors
    this.unsigned = unsigned
  }
}

// Transaction submission

/**
 * Thrown when a CCT write fails before broadcast, the transaction reverts after mining,
 * or it mines without the expected effect (e.g. a deployment that produced no contract
 * address). Pre-broadcast failures (signing/RPC) may set `isTransient: true` for network
 * errors; reverts and post-mining anomalies are permanent and include `context.txHash`. For a
 * split Solana operation, `context.committedHashes` contains confirmed prior transaction hashes;
 * state is partially applied and those transactions are permanent.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.setPool({ ...opts, wallet })
 * } catch (error) {
 *   if (error instanceof CCTTxFailedError) {
 *     console.log(`${error.context.operation} failed: ${error.context.reason}`)
 *   }
 * }
 * ```
 */
export class CCTTxFailedError extends CCIPError {
  override readonly name = 'CCTTxFailedError'
  /** Creates a tx-failed error. */
  constructor(operation: string, reason: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_TX_FAILED,
      `${partialApplicationPrefix(options?.context)}${operation} failed: ${reason}`,
      {
        ...options,
        isTransient: options?.isTransient ?? false,
        context: { ...options?.context, operation, reason },
      },
    )
  }
}

/**
 * Thrown when a transaction was broadcast but not confirmed within the timeout.
 * Transient — it may still mine; check `context.txHash` before resubmitting. For a split Solana
 * operation, `context.committedHashes` contains confirmed prior transaction hashes; state is
 * partially applied and those transactions are permanent.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.setPool({ ...opts, wallet })
 * } catch (error) {
 *   if (error instanceof CCTTxNotConfirmedError) {
 *     console.log(`Not confirmed (tx ${error.context.txHash}); retry in ${error.retryAfterMs}ms`)
 *   }
 * }
 * ```
 */
export class CCTTxNotConfirmedError extends CCIPError {
  override readonly name = 'CCTTxNotConfirmedError'
  /** Creates a tx-not-confirmed error. */
  constructor(operation: string, txHash: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_TX_NOT_CONFIRMED,
      `${partialApplicationPrefix(options?.context)}${operation} transaction not confirmed within timeout: ${txHash}`,
      {
        ...options,
        isTransient: true,
        retryAfterMs: 5000,
        context: { ...options?.context, operation, txHash },
      },
    )
  }
}

function partialApplicationPrefix(context?: Record<string, unknown>): string {
  const committedHashes = context?.committedHashes
  return Array.isArray(committedHashes) && committedHashes.length
    ? `partially applied: ${committedHashes.length} transaction(s) confirmed; `
    : ''
}

// Contract version dispatch

/**
 * Thrown when the contract at an address is not of the expected type.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.transferPoolOwnership({ poolAddress, newOwner, wallet })
 * } catch (error) {
 *   if (error instanceof CCTContractTypeInvalidError) {
 *     console.log(`Expected ${error.context.expected} at ${error.context.address}, got "${error.context.actual}"`)
 *   }
 * }
 * ```
 */
export class CCTContractTypeInvalidError extends CCIPError {
  override readonly name = 'CCTContractTypeInvalidError'
  /**
   * Creates a contract-type-invalid error. `reason` is appended to the message and kept in
   * `context`; pass it when `actual` is a recognized type rejected on its own grounds, so the
   * message does not read as "wrong address".
   */
  constructor(
    address: string,
    expected: string,
    actual: string,
    reason?: string,
    options?: CCIPErrorOptions,
  ) {
    super(
      CCIPErrorCode.CONTRACT_TYPE_INVALID,
      `Expected a ${expected} contract at ${address}, got "${actual}"` +
        (reason ? ` — ${reason}` : ''),
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, address, expected, actual, ...(reason && { reason }) },
      },
    )
  }
}

/**
 * Thrown when a contract reports a version string the SDK does not recognize. Permanent.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.transferPoolOwnership({ poolAddress, newOwner, wallet })
 * } catch (error) {
 *   if (error instanceof CCTContractVersionUnsupportedError) {
 *     console.log(`Unsupported ${error.context.contractType} version: ${error.context.version}`)
 *   }
 * }
 * ```
 */
export class CCTContractVersionUnsupportedError extends CCIPError {
  override readonly name = 'CCTContractVersionUnsupportedError'
  /** Creates a contract-version-unsupported error. */
  constructor(contractType: string, version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_CONTRACT_VERSION_UNSUPPORTED,
      `Unsupported ${contractType} version: ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, contractType, version },
      },
    )
  }
}

/**
 * Thrown when no implementation is registered for an operation at or below the contract's
 * version (floor-match miss). Permanent for that contract version.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.transferPoolOwnership({ poolAddress, newOwner, wallet })
 * } catch (error) {
 *   if (error instanceof CCTOperationUnsupportedError) {
 *     console.log(`${error.context.operation} unsupported at version ${error.context.version}`)
 *   }
 * }
 * ```
 */
export class CCTOperationUnsupportedError extends CCIPError {
  override readonly name = 'CCTOperationUnsupportedError'
  /** Creates an operation-unsupported error. */
  constructor(operation: string, version: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.CCT_OPERATION_UNSUPPORTED,
      `${operation} is not supported at contract version ${version}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, operation, version },
      },
    )
  }
}

/**
 * Thrown when CCT account data cannot be decoded.
 *
 * @example
 * ```typescript
 * try {
 *   await cct.getTokenPoolState({ tokenAddress: mint, poolType: 'burn-mint' })
 * } catch (error) {
 *   if (error instanceof CCTDataDecodeError) {
 *     console.log(error.message)
 *   }
 * }
 * ```
 */
export class CCTDataDecodeError extends CCIPError {
  override readonly name = 'CCTDataDecodeError'
  /** Creates a CCT data decode error. */
  constructor(account: string, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.CCT_DATA_DECODE_FAILED, `Unable to decode CCT data at ${account}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, account },
    })
  }
}
