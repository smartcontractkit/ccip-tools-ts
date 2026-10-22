/**
 * `simulateEVMTx`: dry-runs a built CCT tx with `eth_call` from its sender and names the revert,
 * before anything is signed. Takes the same `UnsignedEVMTx` the `generateUnsigned*` builders
 * return, as `submit.ts` does.
 *
 * @remarks A free function over the built tx, not an {@link EVMOperation} method, so the shared op
 * base stays unchanged and any builder's output (calls and deploys) can be simulated.
 *
 * @packageDocumentation
 */

import { type Interface, ErrorFragment, Result, isError } from 'ethers'

import { getErrorData, parseWithFragment } from '../../evm/errors.ts'
import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { CCTParamsInvalidError } from '../errors.ts'
import { REGISTRY_MODULE_OWNER_CUSTOM_INTERFACES } from './token-admin-registry/contracts.ts'
import { TOKEN_POOL_FACTORY_INTERFACE } from './token-pool-factory/contracts.ts'
import { validateAddress } from './validate.ts'

const OPERATION = 'simulateEVMTx'

/**
 * Vendored CCT contracts with errors core `parseWithFragment` doesn't know
 * (`InvalidLockBoxToken`, `CanOnlySelfRegister`, `RequiredRoleNotFound`, ...). Every other
 * vendored CCT error decodes through core; `simulate.test.ts` checks each one.
 */
const CCT_ERROR_INTERFACES: readonly Interface[] = [
  TOKEN_POOL_FACTORY_INTERFACE,
  ...Object.values(REGISTRY_MODULE_OWNER_CUSTOM_INTERFACES),
]

/** Options for {@link simulateEVMTx}. */
export type SimulateEVMTxOptions = {
  /**
   * Address to simulate from, overriding the tx's own `from`, so calldata built without `sender`
   * (for a multisig) can be checked against the eventual signer.
   */
  from?: string
}

/** Result of {@link simulateEVMTx}, discriminated on `success`. */
export type SimulateEVMTxResult =
  | {
      /** The call completed without reverting. */
      success: true
    }
  | {
      /** The call reverted. */
      success: false
      /**
       * Decoded error name (`InsufficientLiquidity`, or `Error` for a revert string), `null` when
       * no known ABI declares the selector.
       */
      errorName: string | null
      /**
       * Decoded error arguments keyed by parameter name (by position when unnamed), e.g.
       * `{ remoteChainSelector: 16015286601757825753n }` for `LockBoxNotConfigured`, or
       * `{ 0: 'amount exceeds balance' }` for a revert string. `null` when the error is unknown
       * or its data doesn't decode.
       */
      errorArgs: Record<string, unknown> | null
      /** Raw revert data, `0x` for a revert without data. */
      revertData: string
    }

/** A decoded value as plain data: nested structs become records, arrays become arrays. */
function toPlain(value: unknown): unknown {
  if (!(value instanceof Result)) return value
  try {
    return value.toObject(true)
  } catch {
    // a tuple or array with unnamed members
    return value.toArray(true)
  }
}

/** Maps decoded `args` onto the `fragment` inputs' names, falling back to the position. */
function toErrorArgs(fragment: ErrorFragment, args: Result | undefined) {
  // core only decodes when data follows the selector, which a no-arg error never has
  if (fragment.inputs.length === 0) return {}
  if (!args) return null
  return Object.fromEntries(
    fragment.inputs.map(({ name }, i) => [name || String(i), toPlain(args[i])]),
  )
}

/**
 * Decodes the error `revertData` encodes, trying the core SDK ABIs first, then the CCT-only ones.
 * Function and event fragments sharing the selector are skipped, since a revert only carries
 * errors.
 */
function decodeError(
  revertData: string,
): Pick<Extract<SimulateEVMTxResult, { success: false }>, 'errorName' | 'errorArgs'> {
  if (revertData.length >= 10) {
    const [fragment, , args] = parseWithFragment(revertData) ?? []
    if (fragment instanceof ErrorFragment)
      return { errorName: fragment.name, errorArgs: toErrorArgs(fragment, args) }
    for (const iface of CCT_ERROR_INTERFACES) {
      const fragment = iface.getError(revertData.slice(0, 10))
      if (!fragment) continue
      let args: Result | undefined
      try {
        args = iface.decodeErrorResult(fragment, revertData)
      } catch {
        // known selector, malformed data: keep the name
      }
      return { errorName: fragment.name, errorArgs: toErrorArgs(fragment, args) }
    }
  }
  return { errorName: null, errorArgs: null }
}

/**
 * Simulates the tx in `unsigned` with `eth_call` from `opts.from`, or else the tx's own `from`,
 * and decodes any revert to its error name, with no ABI from the caller.
 *
 * @remarks Every CCT op gates on `msg.sender`, so a tx with no `from` either way is rejected
 * rather than simulated from the zero address. A builder given `sender` already rejects an
 * unauthorized one with {@link CCTParamsInvalidError}; built without it, the same check comes back
 * here as a named revert (`OnlyCallableByOwner`, `Unauthorized`). Deploy txs (no `to`) simulate
 * as a CREATE.
 *
 * @param chain - Chain to simulate on.
 * @param unsigned - A `generateUnsigned*` result holding one transaction.
 * @param opts - Optional `from` override, see {@link SimulateEVMTxOptions}.
 * @returns `{ success: true }`, or the revert's `errorName`, `errorArgs` and raw `revertData`.
 * @throws {@link CCTParamsInvalidError} if `unsigned` doesn't hold exactly one transaction, or
 * neither `opts` nor the tx has a valid `from`
 * @throws The raw provider error on an RPC or transport failure, which says nothing about the tx
 * (as in core `evm/simulate.ts`)
 *
 * @example
 * ```typescript
 * // built without `sender` for a multisig, simulated from the Safe that will sign it
 * const unsigned = await cct.generateUnsignedProvideLiquidity({ poolAddress, amount })
 * const result = await simulateEVMTx(cct.chain, unsigned, { from: safeAddress })
 * if (!result.success) console.log(result.errorName ?? result.revertData, result.errorArgs)
 * ```
 */
export async function simulateEVMTx(
  chain: EVMChain,
  unsigned: UnsignedEVMTx,
  opts: SimulateEVMTxOptions = {},
): Promise<SimulateEVMTxResult> {
  const [tx, ...rest] = unsigned.transactions
  if (!tx || rest.length > 0)
    throw new CCTParamsInvalidError(
      OPERATION,
      'unsigned',
      `must hold exactly one transaction, got ${unsigned.transactions.length}`,
    )
  const { to, data, value } = tx
  const from = opts.from ?? tx.from
  if (typeof from !== 'string')
    throw new CCTParamsInvalidError(
      OPERATION,
      'from',
      'is missing: pass `from` or build with `sender`, as every CCT op gates on `msg.sender`',
    )
  validateAddress(OPERATION, 'from', from)

  try {
    await chain.provider.call({ ...(to != null && { to }), data, from, value })
    return { success: true }
  } catch (error) {
    const revertData = getErrorData(error)
    if (revertData) return { success: false, ...decodeError(revertData), revertData }
    // a revert without data (bare `revert()`, `require` without a reason) has nothing to decode
    if (isError(error, 'CALL_EXCEPTION'))
      return { success: false, errorName: null, errorArgs: null, revertData: '0x' }
    throw error
  }
}
