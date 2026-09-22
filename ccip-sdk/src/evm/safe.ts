/**
 * Serialises unsigned transactions into a batch file for the Safe Transaction Builder.
 *
 * @remarks Serialisation, not encoding: the Safe app reads the file, packs the entries into a
 * `MultiSend` delegatecall itself, and proposes the result to the signers. Nothing here touches a
 * contract, an ABI, or a chain.
 *
 * @packageDocumentation
 */

import { CCIPArgumentInvalidError } from '../errors/index.ts'
import type { UnsignedEVMTx } from './types.ts'

/** The Transaction Builder version this file format targets. */
const TX_BUILDER_VERSION = '1.16.5'

/** Normalises a leg's `BigNumberish` value to the decimal string the batch format requires. */
function toDecimalWei(value: bigint | number | string | null | undefined, index: number): string {
  if (value == null) return '0'
  try {
    return BigInt(value).toString()
  } catch (cause) {
    throw new CCIPArgumentInvalidError(`txs[${index}].value`, 'not a whole number of wei', {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
}

/**
 * One entry in a {@link SafeBatch}: a single call, already encoded.
 *
 * @remarks `contractMethod` and `contractInputsValues` carry the Transaction Builder's decoded
 * form, used by batches assembled in its UI from an ABI. Ours arrive pre-encoded, so both are
 * `null` — present rather than omitted, because the importer reads them.
 */
export type SafeBatchTransaction = {
  /** Recipient address. */
  to: string
  /** Wei, as a decimal string. */
  value: string
  /** Hex-encoded calldata, or `0x` for a plain value transfer. */
  data: string
  contractMethod: null
  contractInputsValues: null
}

/**
 * A batch in Safe Transaction Builder import format, as produced by {@link buildSafeBatch}.
 *
 * @remarks `JSON.stringify` it to a file and import that file in the Transaction Builder app.
 */
export type SafeBatch = {
  version: '1.0'
  /** Decimal string; the Transaction Builder rejects a numeric chain id. */
  chainId: string
  /** Unix epoch milliseconds, for the Safe UI only. */
  createdAt: number
  meta: {
    /** Batch title, shown in the Safe UI. */
    name: string
    description?: string
    txBuilderVersion: string
    createdFromSafeAddress: string
  }
  transactions: SafeBatchTransaction[]
}

/** Options for {@link buildSafeBatch}. */
export type BuildSafeBatchOptions = {
  /** Chain the Safe lives on. The Transaction Builder refuses an import from another chain. */
  chainId: bigint | number
  /** The Safe that will execute the batch. */
  safeAddress: string
  /** Shown as the batch title in the Safe UI. */
  name: string
  /** Optional detail line; useful for the parameters that are not readable from the calldata. */
  description?: string
}

/**
 * Collects one or more unsigned transactions into a single Safe batch, in order.
 *
 * @remarks Every leg of every operation becomes one entry, so operations that already produce
 * several transactions flatten naturally and composing them is an array literal — there is no
 * builder to hold.
 *
 * Order is preserved and is significant: the Safe executes the entries sequentially within one
 * transaction, which is what lets a call target a contract an earlier entry in the same batch
 * creates.
 *
 * `from` and `gasLimit` are dropped — the Safe is the sender by construction, and gas is
 * estimated when the batch executes rather than when it is built.
 *
 * @param txs - Unsigned transactions, in execution order
 * @param opts - Chain, Safe, and the metadata shown in the Safe UI
 * @returns The batch, ready to `JSON.stringify` into a file
 * @throws {@link CCIPArgumentInvalidError} if the batch is empty; if a leg has no `to` (every
 * entry needs a recipient — contract creation goes through a factory instead) or an unresolved
 * `Addressable` one; or if a leg's `value` is not a whole number of wei
 * @example Deploy a pool from a Safe and take ownership of it, as one on-chain transaction:
 * ```typescript
 * const deploy = await cct.generateUnsignedDeployTokenPoolViaCreateX({
 *   ...poolArgs,
 *   sender: safe,
 *   salt,
 *   init: { transferOwnership: safe },
 * })
 * // The pool address is known before anything is signed, so the accept can be batched with the
 * // deployment that creates its target.
 * const accept = encodeAcceptPoolOwnership(getTokenPoolArtifact(poolArgs.type).iface, {
 *   poolAddress: deploy.address,
 * })
 *
 * const batch = buildSafeBatch([deploy.transaction, accept], {
 *   chainId: 84532n,
 *   safeAddress: safe,
 *   name: `Deploy ${poolArgs.type} and accept ownership`,
 *   description: `Pool ${deploy.address}, salt "${salt}"`,
 * })
 * writeFileSync('safe-batch.json', JSON.stringify(batch, null, 2))
 * ```
 */
export function buildSafeBatch(
  txs: readonly UnsignedEVMTx[],
  opts: BuildSafeBatchOptions,
): SafeBatch {
  const legs = txs.flatMap(({ transactions }) => transactions)
  if (legs.length === 0)
    throw new CCIPArgumentInvalidError('txs', 'a Safe batch needs at least one transaction')

  const transactions = legs.map((leg, index): SafeBatchTransaction => {
    if (!leg.to)
      throw new CCIPArgumentInvalidError(
        `txs[${index}].to`,
        'every Safe batch entry needs a recipient; deploy through a factory instead',
      )
    // `TransactionRequest['to']` also admits an `Addressable`, whose address is only reachable
    // asynchronously. Resolving it here would make a pure serialiser async, so require it
    // resolved: every `generateUnsigned*` in this SDK already returns a plain address string.
    if (typeof leg.to !== 'string')
      throw new CCIPArgumentInvalidError(
        `txs[${index}].to`,
        'must be an address string; resolve an Addressable with getAddress() first',
      )
    return {
      to: leg.to,
      // `value` is a `BigNumberish`, so it may arrive hex-encoded. The Transaction Builder reads
      // this field as decimal, and would take "0x16345785d8a0000" for 16345785180000 wei.
      value: toDecimalWei(leg.value, index),
      data: leg.data ?? '0x',
      contractMethod: null,
      contractInputsValues: null,
    }
  })

  return {
    version: '1.0',
    chainId: opts.chainId.toString(),
    createdAt: Date.now(),
    meta: {
      name: opts.name,
      ...(opts.description !== undefined && { description: opts.description }),
      txBuilderVersion: TX_BUILDER_VERSION,
      createdFromSafeAddress: opts.safeAddress,
    },
    transactions,
  }
}
