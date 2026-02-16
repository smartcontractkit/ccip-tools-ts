import { memoize } from 'micro-memoize'

import type { Chain } from './chain.ts'
import {
  CCIPMerkleRootMismatchError,
  CCIPMessageNotInBatchError,
  CCIPOffRampNotFoundError,
} from './errors/index.ts'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.ts'
import type { CCIPMessage, CCIPVersion, ExecutionReport, Lane, WithLogger } from './types.ts'

/**
 * Pure/sync function to calculate/generate OffRamp.executeManually report for messageIds
 *
 * @param messagesInBatch - Array containing all messages in batch, ordered
 * @param lane - Arguments for leafHasher (lane info)
 * @param messageId - Message ID to prove for manual execution
 * @param merkleRoot - Optional merkleRoot of the CommitReport, for validation
 * @param ctx - Context for logging
 * @returns ManualExec report arguments
 * @throws CCIPMessageNotInBatchError - When the messageId is not found in the provided batch
 * @throws CCIPMerkleRootMismatchError - When calculated merkle root doesn't match the provided one
 *
 * @remarks
 * This is a pure/sync function that performs no I/O - all data must be pre-fetched.
 * It builds a merkle tree from the messages, generates a proof for the target messageId,
 * and optionally validates against the provided merkleRoot.
 *
 * The returned proof can be used with `executeReport` to manually execute a stuck message.
 *
 * @example
 * ```typescript
 * import { calculateManualExecProof, EVMChain } from '@chainlink/ccip-sdk'
 *
 * // Fetch the request and all messages in its batch
 * const request = (await source.getMessagesInTx(txHash))[0]
 * const commit = await dest.getCommitReport({ commitStore, request })
 * const messages = await source.getMessagesInBatch(request, commit.report)
 *
 * // Calculate proof for manual execution
 * const proof = calculateManualExecProof(
 *   messages,
 *   request.lane,
 *   request.message.messageId,
 *   commit.report.merkleRoot
 * )
 * console.log('Merkle root:', proof.merkleRoot)
 * console.log('Proofs:', proof.proofs)
 * ```
 * @see {@link discoverOffRamp} - Find the OffRamp for manual execution
 * @see {@link executeReport} - Execute the report on destination chain
 * @see {@link generateUnsignedExecuteReport} - Build unsigned execution tx
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
      min: messagesInBatch[0]!.sequenceNumber,
      max: messagesInBatch[messagesInBatch.length - 1]!.sequenceNumber,
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

/**
 * Discover the OffRamp address for a given OnRamp and destination chain.
 * Results are memoized for performance.
 *
 * @param source - Source chain instance.
 * @param dest - Destination chain instance.
 * @param onRamp - OnRamp contract address on source chain.
 * @param ctx - Optional context with logger.
 * @returns OffRamp address on destination chain.
 * @throws CCIPOffRampNotFoundError - When no matching OffRamp is found for the OnRamp
 * @example
 * ```typescript
 * import { discoverOffRamp, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const dest = await EVMChain.fromUrl('https://rpc.fuji.avax.network')
 *
 * const offRamp = await discoverOffRamp(source, dest, onRampAddress)
 * console.log('OffRamp on destination:', offRamp)
 * ```
 * @see {@link calculateManualExecProof} - Use with OffRamp for manual execution
 * @see {@link executeReport} - Execute on destination chain
 * @see {@link getExecutionReceipts} - Check execution status
 */
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
      let destOnRamps
      try {
        destOnRamps = await source.getOnRampsForOffRamp(offRamp, dest.network.chainSelector)
      } catch (err) {
        logger.debug(
          'discoverOffRamp: skipping offRamp',
          offRamp,
          '(no valid source chain config)',
          err,
        )
        continue
      }
      for (const destOnRamp of destOnRamps) {
        const destRouter = await dest.getRouterForOnRamp(destOnRamp, source.network.chainSelector)
        const destOffRamps = await dest.getOffRampsForRouter(
          destRouter,
          source.network.chainSelector,
        )
        for (const offRamp of destOffRamps) {
          let offRampsOnRamps
          try {
            offRampsOnRamps = await dest.getOnRampsForOffRamp(offRamp, source.network.chainSelector)
          } catch (err) {
            logger.debug(
              'discoverOffRamp: skipping dest offRamp',
              offRamp,
              '(no valid source chain config)',
              err,
            )
            continue
          }
          for (const offRampsOnRamp of offRampsOnRamps) {
            logger.debug(
              'discoverOffRamp: found, from',
              {
                sourceOnRamp: onRamp,
                sourceRouter,
                sourceOffRamps,
                destOnRamp,
                destOffRamps,
                offRampsOnRamp,
              },
              '=',
              offRamp,
            )
            for (const offRamp of destOffRamps) {
              const offRampsOnRamps = await dest.getOnRampsForOffRamp(
                offRamp,
                source.network.chainSelector,
              )
              for (const offRampsOnRamp of offRampsOnRamps) {
                logger.debug(
                  'discoverOffRamp: found, from',
                  {
                    sourceOnRamp: onRamp,
                    sourceRouter,
                    sourceOffRamps,
                    destOnRamp,
                    destOffRamps,
                    offRampsOnRamps,
                  },
                  '=',
                  offRamp,
                )
                if (offRampsOnRamp === onRamp) {
                  return offRamp
                }
              }
            }
          }
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
