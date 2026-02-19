import { memoize } from 'micro-memoize'

import type { Chain } from './chain.ts'
import {
  CCIPMerkleRootMismatchError,
  CCIPMessageNotFoundInTxError,
  CCIPMessageNotInBatchError,
  CCIPOffRampNotFoundError,
  CCIPOnchainCommitRequiredError,
} from './errors/index.ts'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.ts'
import type {
  CCIPExecution,
  CCIPMessage,
  CCIPVersion,
  ExecutionReport,
  Lane,
  WithLogger,
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
            if (offRampsOnRamp === onRamp) {
              return offRamp
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

/**
 * Options for the {@link execute} function.
 */
export type ExecuteOpts = {
  /** Source chain instance */
  source: Chain
  /** Destination chain instance */
  dest: Chain
  /** Message ID to execute */
  messageId: string
  /** Source transaction hash containing the CCIP request */
  txHash: string
  /** Chain-specific wallet/signer for the destination chain */
  wallet: unknown
  /** Override gas limit for ccipReceive callback (0 keeps original) */
  gasLimit?: number
  /** Override gas limit for tokenPool releaseOrMint calls (EVM only) */
  tokensGasLimit?: number
  /** Estimate gas limit with percentage margin to add (conflicts with gasLimit) */
  estimateGasLimit?: number
  /** Forces usage of buffering for Solana execution */
  forceBuffer?: boolean
  /** Forces creation & usage of an ad-hoc lookup table for Solana execution */
  forceLookupTable?: boolean
}

/**
 * Execute a CCIP message manually on the destination chain.
 *
 * Orchestrates the full manual execution flow: fetches the message from the source
 * transaction, discovers the OffRamp, retrieves the commit report, calculates the
 * merkle proof, fetches offchain token data, and executes the report on the
 * destination chain.
 *
 * @param opts - {@link ExecuteOpts} with source/dest chains, message ID, tx hash, and wallet
 * @returns Promise resolving to the execution result
 *
 * @throws {@link CCIPMessageNotFoundInTxError} if no message with the given messageId exists in the transaction
 * @throws {@link CCIPOnchainCommitRequiredError} if offchain verification (v2.0) is found instead of an onchain commit
 * @throws {@link CCIPOffRampNotFoundError} if no matching OffRamp is found
 * @throws {@link CCIPCommitNotFoundError} if no commit report is found for the message
 * @throws {@link CCIPMessageNotInBatchError} if messageId is not in the commit batch
 * @throws {@link CCIPMerkleRootMismatchError} if merkle proof validation fails
 * @throws {@link CCIPExecTxRevertedError} if the execution transaction reverts
 *
 * @example
 * ```typescript
 * import { execute, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const dest = await EVMChain.fromUrl('https://rpc.fuji.avax.network')
 *
 * const result = await execute({
 *   source,
 *   dest,
 *   messageId: '0x...',
 *   txHash: '0x...',
 *   wallet: signer,
 * })
 * console.log(`Executed: ${result.log.transactionHash}`)
 * ```
 *
 * @see {@link calculateManualExecProof} - Lower-level proof calculation
 * @see {@link discoverOffRamp} - OffRamp discovery
 */
export async function execute(opts: ExecuteOpts): Promise<CCIPExecution> {
  const {
    source,
    dest,
    messageId,
    txHash,
    wallet,
    gasLimit,
    tokensGasLimit,
    estimateGasLimit,
    forceBuffer,
    forceLookupTable,
  } = opts

  // 1. Get messages from source tx
  const requests = await source.getMessagesInTx(txHash)

  // 2. Find request by messageId
  const request = requests.find((r) => r.message.messageId === messageId)
  if (!request) {
    throw new CCIPMessageNotFoundInTxError(txHash, {
      context: { messageId },
    })
  }

  // 3. Discover OffRamp on destination chain
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)

  // 4. Get commit store
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)

  // 5. Get verification/commit report
  const commit = await dest.getVerifications({ commitStore, request })

  // 6. Validate onchain commit (v2.0 not yet supported)
  if (!('report' in commit)) {
    throw new CCIPOnchainCommitRequiredError(messageId)
  }

  // 7. Get all messages in the commit batch
  const messagesInBatch = await source.getMessagesInBatch(request, commit.report)

  // 8. Calculate merkle proof
  const execReportProof = calculateManualExecProof(
    messagesInBatch,
    request.lane,
    messageId,
    commit.report.merkleRoot,
    dest,
  )

  // 9. Get offchain token data (USDC/LBTC attestations)
  const offchainTokenData = await source.getOffchainTokenData(request)

  // 10. Assemble execution report
  const execReport: ExecutionReport = {
    ...execReportProof,
    message: request.message,
    offchainTokenData,
  }

  // 11. Optional gas estimation
  let effectiveGasLimit = gasLimit
  if (estimateGasLimit != null) {
    const { estimateReceiveExecution } = await import('./gas.ts')
    let estimated = await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: offRamp,
      message: request.message,
    })
    estimated += Math.ceil((estimated * estimateGasLimit) / 100)
    const origLimit = Number(
      'gasLimit' in request.message
        ? request.message.gasLimit
        : 'executionGasLimit' in request.message
          ? request.message.executionGasLimit
          : (request.message as Record<string, unknown>).computeUnits,
    )
    if (origLimit < estimated) {
      effectiveGasLimit = estimated
    }
  }

  // 12. Execute on destination chain
  return dest.executeReport({
    offRamp,
    execReport,
    wallet,
    gasLimit: effectiveGasLimit,
    tokensGasLimit,
    forceBuffer,
    forceLookupTable,
  })
}
