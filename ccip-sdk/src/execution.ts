import { memoize } from 'micro-memoize'

import type { Chain, ChainStatic } from './chain.ts'
import {
  CCIPMerkleRootMismatchError,
  CCIPMessageNotInBatchError,
  CCIPOffRampNotFoundError,
} from './errors/index.ts'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.ts'
import {
  type CCIPCommit,
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type CCIPVersion,
  type ExecutionReport,
  type Lane,
  type WithLogger,
  ExecutionState,
} from './types.ts'

/**
 * Pure/sync function to calculate/generate OffRamp.executeManually report for messageIds
 *
 * @param messagesInBatch - Array containing all messages in batch, ordered
 * @param lane - Arguments for leafHasher (lane info)
 * @param messageId - Message ID to prove for manual execution
 * @param merkleRoot - Optional merkleRoot of the CommitReport, for validation
 * @param ctx - Context for logging
 * @returns ManualExec report arguments
 **/
export function calculateManualExecProof<V extends CCIPVersion = CCIPVersion>(
  messagesInBatch: readonly CCIPMessage<V>[],
  lane: Lane<V>,
  messageId: string,
  merkleRoot?: string,
  ctx?: WithLogger,
): Omit<ExecutionReport, 'offchainTokenData' | 'message'> {
  const hasher = getLeafHasher(lane, ctx)

  const msgIdx = messagesInBatch.findIndex((message) => message.messageId === messageId)
  if (msgIdx < 0) {
    throw new CCIPMessageNotInBatchError(messageId, {
      min: messagesInBatch[0].sequenceNumber,
      max: messagesInBatch[messagesInBatch.length - 1].sequenceNumber,
    })
  }

  const leaves = messagesInBatch.map((message) => hasher(message))

  // Create multi-merkle tree
  const tree = new Tree(leaves)
  if (merkleRoot && tree.root() !== merkleRoot) {
    throw new CCIPMerkleRootMismatchError(merkleRoot, tree.root())
  }

  // Generate proof from multi-merkle tree
  const proof = tree.prove([msgIdx])

  return {
    proofs: proof.hashes,
    proofFlagBits: proofFlagsToBits(proof.sourceFlags),
    merkleRoot: tree.root(),
  }
}

export const discoverOffRamp = memoize(
  async function discoverOffRamp_(
    source: Chain,
    dest: Chain,
    onRamp: string,
    { logger = console }: WithLogger = {},
  ): Promise<string> {
    const sourceRouter = await source.getRouterForOnRamp(onRamp, dest.network.chainSelector)
    const sourceOffRamps = await source.getOffRampsForRouter(
      sourceRouter,
      dest.network.chainSelector,
    )
    for (const offRamp of sourceOffRamps) {
      const destOnRamp = await source.getOnRampForOffRamp(offRamp, dest.network.chainSelector)
      const destRouter = await dest.getRouterForOnRamp(destOnRamp, source.network.chainSelector)
      const destOffRamps = await dest.getOffRampsForRouter(destRouter, source.network.chainSelector)
      for (const offRamp of destOffRamps) {
        const offRampsOnRamp = await dest.getOnRampForOffRamp(offRamp, source.network.chainSelector)
        if (offRampsOnRamp === onRamp) {
          logger.debug(
            'discoverOffRamp: found, from',
            { sourceRouter, sourceOffRamps, destOnRamp, destOffRamps, offRampsOnRamp },
            '=',
            offRamp,
          )
          return offRamp
        }
      }
    }
    throw new CCIPOffRampNotFoundError(onRamp, dest.network.name)
  },
  {
    transformKey: ([source, dest, onRamp]) =>
      [source.network.chainSelector, dest.network.chainSelector, onRamp] as const,
  },
)

/**
 * Generic implementation for fetching ExecutionReceipts for given requests.
 * If more than one request is given, may yield them interleaved.
 * Completes as soon as there's no more work to be done.
 *
 * Two possible behaviors:
 * - if `startBlock|startTime` is given, pages forward from that block up;
 *   completes when success (final) receipt is found for all requests (or reach latest block)
 * - otherwise, pages backwards and returns only the most recent receipt per request;
 *   completes when receipts for all requests were seen
 *
 * @param dest - Provider to page through.
 * @param offRamp - OffRamp contract address.
 * @param request - CCIP request to search executions for.
 * @param commit - Optional commit info to narrow down search.
 * @param hints - Optional hints (e.g., `page` for getLogs pagination range).
 */
export async function* getExecutionReceipts(
  dest: Chain,
  offRamp: string,
  request: CCIPRequest,
  commit?: CCIPCommit,
  hints?: { page?: number },
): AsyncGenerator<CCIPExecution> {
  const onlyLast = !commit?.log.blockNumber && !request.tx.timestamp // backwards
  for await (const log of dest.getLogs({
    startBlock: commit?.log.blockNumber,
    startTime: request.tx.timestamp,
    address: offRamp,
    topics: ['ExecutionStateChanged'],
    ...hints,
  })) {
    const receipt = (dest.constructor as ChainStatic).decodeReceipt(log)
    if (!receipt || receipt.messageId !== request.message.messageId) continue

    const timestamp = log.tx?.timestamp ?? (await dest.getBlockTimestamp(log.blockNumber))
    yield { receipt, log, timestamp }
    if (onlyLast || receipt.state === ExecutionState.Success) break
  }
}
