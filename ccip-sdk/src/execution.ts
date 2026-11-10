import { memoize } from 'micro-memoize'

import type { Chain } from './chain.ts'
import {
  CCIPMerkleRootMismatchError,
  CCIPMessageNotInBatchError,
  CCIPOffRampNotFoundError,
  shouldRetry,
} from './errors/index.ts'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.ts'
import { ChainFamily } from './networks.ts'
import { type CCIPMessage, type Lane, type WithLogger, CCIPVersion } from './types.ts'
import { decodeAddress, decodeOnRampAddress } from './utils.ts'

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
 * The returned proof can be used with `execute` to manually execute a stuck message.
 *
 * @example
 * ```typescript
 * import { calculateManualExecProof, EVMChain } from '@chainlink/ccip-sdk'
 *
 * // Fetch the request and all messages in its batch
 * const request = (await source.getMessagesInTx(txHash))[0]
 * const verifications = await dest.getVerifications({ offRamp, request })
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
 * @see {@link execute} - Execute the report on destination chain
 * @see {@link generateUnsignedExecute} - Build unsigned execution tx
 **/
export function calculateManualExecProof<V extends CCIPVersion = CCIPVersion>(
  messagesInBatch: readonly CCIPMessage<V>[],
  lane: Lane<V>,
  messageId: string,
  merkleRoot?: string,
  ctx?: WithLogger,
) {
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
 * Discover the OffRamp address for a given lane (OnRamp and protocol version) on a destination
 * chain.
 * Results are memoized for performance.
 *
 * @remarks
 * One OnRamp can serve more than one lane version to the same destination. For example, a
 * Solana 2.0 Router (which is also the OnRamp) keeps its 1.6 entrypoint next to the 2.0 one, and
 * the destination has a 1.6 OffRamp and a 2.0 OffRamp that both accept that Router. The lane
 * version selects between them: a 2.0 lane gives a 2.0 OffRamp, and a pre-2.0 lane gives a pre-2.0
 * OffRamp. Use `request.lane` for a sent message: its version comes from the message shape.
 *
 * @param source - Source chain instance.
 * @param dest - Destination chain instance.
 * @param lane - Lane to discover the OffRamp for: `onRamp` (OnRamp address on source chain) and
 *   `version` (CCIP protocol version of the lane, e.g. `request.lane.version`).
 * @param ctx - Optional context with logger.
 * @returns OffRamp address on destination chain.
 * @throws CCIPOffRampNotFoundError - When no OffRamp of the lane's version accepts the OnRamp
 * @example
 * ```typescript
 * import { discoverOffRamp, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const dest = await EVMChain.fromUrl('https://rpc.fuji.avax.network')
 *
 * const [request] = await source.getMessagesInTx(txHash)
 * const offRamp = await discoverOffRamp(source, dest, request.lane)
 * console.log('OffRamp on destination:', offRamp)
 * ```
 * @see {@link calculateManualExecProof} - Use with OffRamp for manual execution
 * @see {@link execute} - Execute on destination chain
 * @see {@link getExecutionReceipts} - Check execution status
 */
export const discoverOffRamp = memoize(
  async function discoverOffRamp_(
    source: Chain,
    dest: Chain,
    { onRamp, version }: Pick<Lane, 'onRamp' | 'version'>,
    { logger = console }: WithLogger = {},
  ): Promise<string> {
    try {
      onRamp = decodeOnRampAddress(onRamp, source.network.family)
    } catch {
      // pass
    }
    const isV2 = version >= CCIPVersion.V2_0

    // OnRamp v2.0 has `offRamp` config; only a 2.0 lane's config gives a 2.0 OffRamp
    const onRampConfig: { typeAndVersion: string; offramp?: string; offRamp?: string } =
      await source.getOnRampConfig(onRamp, dest.network.chainSelector, { version })
    if (isV2 && (onRampConfig.offramp || onRampConfig.offRamp)) {
      let decoded = decodeAddress(
        onRampConfig.offramp || onRampConfig.offRamp!,
        dest.network.family,
      )
      if (
        (dest.network.family === ChainFamily.Aptos || dest.network.family === ChainFamily.Sui) &&
        !decoded.includes('::')
      )
        decoded += '::offramp'
      return decoded
    }

    // fallback to pairing routers offramps
    const sourceRouter = await source.getRouterForOnRamp(onRamp, dest.network.chainSelector)
    // every (destOnRamp, dest offRamp, onRamp it accepts) triplet considered,
    // reported in the error if none of them accepts our onRamp
    const examined: { destOnRamp: string; offRamp: string; accepts: string; version?: string }[] =
      []
    // every lookup that failed on the way; a transient one (e.g. a rate-limited RPC) makes the
    // final not-found transient too, so callers retry instead of reporting a missing lane
    const skipped: { step: string; address: string; error: unknown }[] = []
    let sourceOffRamps: string[] = []
    try {
      sourceOffRamps = await source.getOffRampsForRouter(sourceRouter, dest.network.chainSelector)
    } catch (err) {
      skipped.push({ step: 'source offRamps', address: sourceRouter, error: err })
      // Source-side offRamp enumeration can be impossible (e.g. Sui on
      // history-pruned RPCs); fall through to dest-side discovery below
      logger.debug(
        'discoverOffRamp: source-side offRamp enumeration failed; trying dest-side only',
        err,
      )
    }
    for (const offRamp of sourceOffRamps) {
      let destOnRamps
      try {
        destOnRamps = await source.getOnRampsForOffRamp(offRamp, dest.network.chainSelector)
      } catch (err) {
        skipped.push({ step: 'source offRamp config', address: offRamp, error: err })
        logger.debug(
          'discoverOffRamp: skipping offRamp',
          offRamp,
          '(no valid source chain config)',
          err,
        )
        continue
      }
      for (const destOnRamp of destOnRamps) {
        let destOffRamps
        try {
          const destRouter = await dest.getRouterForOnRamp(destOnRamp, source.network.chainSelector)
          destOffRamps = await dest.getOffRampsForRouter(destRouter, source.network.chainSelector)
        } catch (err) {
          skipped.push({ step: 'dest offRamps', address: destOnRamp, error: err })
          logger.debug(
            'discoverOffRamp: skipping dest onRamp',
            destOnRamp,
            '(dest-side offRamp enumeration failed)',
            err,
          )
          continue
        }
        for (const offRamp of destOffRamps) {
          let offRampsOnRamps
          try {
            offRampsOnRamps = await dest.getOnRampsForOffRamp(offRamp, source.network.chainSelector)
          } catch (err) {
            skipped.push({ step: 'dest offRamp config', address: offRamp, error: err })
            logger.debug(
              'discoverOffRamp: skipping dest offRamp',
              offRamp,
              '(no valid source chain config)',
              err,
            )
            continue
          }
          for (const offRampsOnRamp of offRampsOnRamps) {
            logger.debug('discoverOffRamp: checking dest offRamp', {
              sourceOnRamp: onRamp,
              sourceRouter,
              sourceOffRamps,
              destOnRamp,
              destOffRamps,
              offRamp,
              offRampsOnRamp,
            })
            // both sides are in their source family's canonical onRamp form:
            // this one because every getOffRampConfig decodes it with
            // decodeOnRampAddress, ours because it was normalized above
            if (offRampsOnRamp !== onRamp) {
              examined.push({ destOnRamp, offRamp, accepts: offRampsOnRamp })
              continue
            }
            // OffRamps of different versions can accept the same onRamp (e.g. a Solana 2.0
            // Router serves 1.6 and 2.0 lanes): keep the one of the lane's version
            const offRampVersion = await dest.typeAndVersion(offRamp).then(
              ([, v]) => v,
              (err: unknown) => {
                logger.debug('discoverOffRamp: no typeAndVersion for dest offRamp', offRamp, err)
                return undefined
              },
            )
            examined.push({
              destOnRamp,
              offRamp,
              accepts: offRampsOnRamp,
              ...(offRampVersion && { version: offRampVersion }),
            })
            if (offRampVersion == null || offRampVersion >= CCIPVersion.V2_0 === isV2) {
              return offRamp
            }
          }
        }
      }
    }
    // Report which dest offRamps were reachable and which onRamp each accepts:
    // when a lane is half-wired (the dest's offRamp pairs with a *different*
    // source onRamp) that pairing is the answer, and it is otherwise only
    // visible with debug logging on.
    const transient = skipped.filter(({ error }) => shouldRetry(error))
    throw new CCIPOffRampNotFoundError(onRamp, dest.network.name, {
      context: {
        version,
        sourceRouter,
        sourceOffRamps,
        examined,
        ...(skipped.length && {
          skipped: skipped.map(({ step, address, error }) => ({
            step,
            address,
            error: error instanceof Error ? error.message : String(error),
          })),
        }),
      },
      ...(transient.length && {
        isTransient: true,
        cause: transient[0]!.error instanceof Error ? transient[0]!.error : undefined,
      }),
    })
  },
  {
    transformKey: ([source, dest, { onRamp, version }]) =>
      [source.network.chainSelector, dest.network.chainSelector, onRamp, version] as const,
    maxSize: 50,
    // evict rejections, so a transient RPC error or a half-deployed lane is retried
    async: true,
  },
)
