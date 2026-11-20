import { type Address, type Transaction, Cell, beginCell, contractAddress } from '@ton/core'
import type { TonClient } from '@ton/ton'

import type { Logger } from '../types.ts'

/**
 * Execution discovery through the per-commit `MerkleRoot` contract.
 *
 * A TON OffRamp keeps no per-message state of its own. Each committed merkle root
 * gets its own small contract, deployed by the OffRamp at an address DERIVED from
 * `(OffRamp address, merkle root)`, and every execution of a message under that root
 * passes through it:
 *
 * ```
 * commit:   OffRamp --Deployable_Initialize--> MerkleRoot          (OffRamp tx emits CommitReportAccepted)
 * execute:  OffRamp --MerkleRoot_Validate----> MerkleRoot
 *           MerkleRoot --OffRamp_ExecuteValidated--> OffRamp        (this OffRamp tx emits ExecutionStateChanged: InProgress)
 *           ... ReceiveExecutor / Router / receiver round-trips ...
 *           OffRamp --MerkleRoot_MarkState---> MerkleRoot           (the SENDING OffRamp tx emits ExecutionStateChanged: Success | Failure)
 * ```
 *
 * So the OffRamp transactions that emit `ExecutionStateChanged` for a root are exactly
 * the ones adjacent to its MerkleRoot contract: those that CONSUME a message the
 * MerkleRoot sent to the OffRamp, and those that SENT it a `MerkleRoot_MarkState`.
 * The MerkleRoot's own transaction list is tiny (1 + ~2 per execution attempt) and is
 * read newest-first in one call, whatever the OffRamp's traffic and however long ago
 * the commit was — where the alternative is paging the OffRamp's whole history from
 * the commit onward (and, for a message not executed yet, all the way to the tip).
 *
 * Verified in the OffRamp 1.6.0-1.6.2 and 1.7.0 sources (every state emit is paired
 * with one of the two messages above) and on live ton-testnet (1.6.2); callers
 * gate on the contract version (see TONChain.getExecutionReceipts) and fall back to
 * the plain log scan whenever anything here does not check out.
 */

/** `Deployable` namespace of MerkleRoot contracts (lib/deployable/namespace.tolk). */
const NAMESPACE_MERKLE_ROOT = 2
/** `Deployable_Initialize` opcode (lib/deployable/types.tolk): the deployment message. */
const OP_DEPLOYABLE_INITIALIZE = 0xba466447
/** `MerkleRoot_MarkState` opcode (merkle_root/messages.tolk). */
const OP_MERKLE_ROOT_MARK_STATE = 0x019f4cd2
/** One page of the MerkleRoot's transactions; a longer list falls back to the scan. */
const MERKLE_ROOT_TXS_PAGE = 100

type Ctx = { provider: TonClient; logger?: Pick<Logger, 'debug'> }

/**
 * The `Deployable` stub code every per-item contract of this OffRamp is deployed
 * through. Its hash comes from the `deployableHashes` getter; the cell itself is a
 * ref somewhere inside the OffRamp's storage, located BY HASH so the lookup does not
 * depend on the storage layout.
 *
 * @returns the code cell, or undefined when the OffRamp does not expose it.
 */
export async function fetchDeployerCode(
  { provider }: Ctx,
  offRamp: Address,
): Promise<Cell | undefined> {
  // DeployableHashes { merkleRoot, receiveExecutor, deployer } — code cell hashes.
  const { stack } = await provider.runMethod(offRamp, 'deployableHashes')
  stack.skip(2)
  const want = stack.readBigNumber().toString(16).padStart(64, '0')

  const { data } = await provider.getContractState(offRamp)
  if (!data) return undefined
  const pending = [...Cell.fromBoc(data)]
  const visited = new Set<string>()
  for (let cell = pending.pop(); cell; cell = pending.pop()) {
    const hash = cell.hash().toString('hex')
    if (hash === want) return cell
    if (visited.has(hash)) continue
    visited.add(hash)
    pending.push(...cell.refs)
  }
  return undefined
}

/**
 * Address of the MerkleRoot contract the OffRamp deploys for `merkleRoot`
 * (`getMerkleRootDeployAddress`): the address of the Deployable stub whose data is
 * `owner: address | namespace: uint32 | id: uint256`.
 */
export function merkleRootAddress(offRamp: Address, merkleRoot: string, deployer: Cell): Address {
  const data = beginCell()
    .storeAddress(offRamp)
    .storeUint(NAMESPACE_MERKLE_ROOT, 32)
    .storeUint(BigInt(merkleRoot), 256)
    .endCell()
  return contractAddress(0, { code: deployer, data })
}

/**
 * The OffRamp transactions that changed the execution state of any message under the
 * root held by `merkleRoot` (see the module comment), oldest first.
 *
 * @returns the transactions (empty: the root was committed and nothing under it was
 *   executed yet), or undefined when this route cannot answer — the account is not
 *   there (never deployed, or deleted since), was not deployed by `offRamp`, has more
 *   transactions than one page, or a hop could not be located. The caller then scans.
 */
export async function locateExecutionTxs(
  { provider, logger }: Ctx,
  offRamp: Address,
  merkleRoot: Address,
): Promise<Transaction[] | undefined> {
  const txs = await provider.getTransactions(merkleRoot, { limit: MERKLE_ROOT_TXS_PAGE })
  // Newest first. The list is only trusted when it is provably WHOLE: its oldest tx
  // is the account's first (no predecessor) and is the OffRamp's deployment message
  // (an account deleted and re-created by a later message would start elsewhere).
  const first = txs[txs.length - 1]
  if (
    !first ||
    txs.length >= MERKLE_ROOT_TXS_PAGE ||
    first.prevTransactionLt !== 0n ||
    first.inMessage?.info.type !== 'internal' ||
    !first.inMessage.info.src.equals(offRamp) ||
    opcodeOf(first.inMessage.body) !== OP_DEPLOYABLE_INITIALIZE
  ) {
    logger?.debug(
      `TON MerkleRoot ${merkleRoot.toRawString()}: tx list unusable (${txs.length} txs), scanning instead`,
    )
    return undefined
  }

  const found = new Map<bigint, Transaction>()
  try {
    for (let i = txs.length - 1; i >= 0; i--) {
      const tx = txs[i]!
      const hops: Promise<Transaction>[] = []
      // OffRamp -> MerkleRoot MarkState: its SOURCE tx emitted the final state.
      const inMsg = tx.inMessage
      if (
        inMsg?.info.type === 'internal' &&
        inMsg.info.src.equals(offRamp) &&
        opcodeOf(inMsg.body) === OP_MERKLE_ROOT_MARK_STATE
      )
        hops.push(provider.tryLocateSourceTx(offRamp, merkleRoot, inMsg.info.createdLt.toString()))
      // MerkleRoot -> OffRamp with a body (ExecuteValidated): its RESULT tx emitted
      // InProgress. The body-less message is the final balance sweep.
      for (const out of tx.outMessages.values()) {
        if (
          out.info.type === 'internal' &&
          out.info.dest.equals(offRamp) &&
          opcodeOf(out.body) !== undefined
        )
          hops.push(provider.tryLocateResultTx(merkleRoot, offRamp, out.info.createdLt.toString()))
      }
      for (const hop of await Promise.all(hops)) found.set(hop.lt, hop)
    }
  } catch (err) {
    logger?.debug(
      `TON MerkleRoot ${merkleRoot.toRawString()}: could not locate an OffRamp hop, scanning instead:`,
      err,
    )
    return undefined
  }
  return [...found.values()].sort((a, b) => (a.lt < b.lt ? -1 : a.lt > b.lt ? 1 : 0))
}

/** First 32 bits of a message body, or undefined for a body shorter than that. */
function opcodeOf(body: Cell): number | undefined {
  const slice = body.beginParse()
  return slice.remainingBits >= 32 ? slice.loadUint(32) : undefined
}
