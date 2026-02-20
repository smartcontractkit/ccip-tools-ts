import { memoize } from 'micro-memoize'

import { CCIPAPIClient, isExecutionInputsV2 } from './api/index.ts'
import type { Chain, ChainGetter } from './chain.ts'
import {
  CCIPApiRequiredError,
  CCIPArgumentInvalidError,
  CCIPMerkleRootMismatchError,
  CCIPMessageNotFoundInTxError,
  CCIPMessageNotInBatchError,
  CCIPOffRampNotFoundError,
  CCIPOnchainCommitRequiredError,
  CCIPRpcNotFoundError,
  CCIPTransactionNotFoundError,
} from './errors/index.ts'
import { Tree, getLeafHasher, proofFlagsToBits } from './hasher/index.ts'
import { decodeMessage } from './requests.ts'
import { supportedChains } from './supported-chains.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type ExecutionReport,
  type Lane,
  type Logger,
  type WithLogger,
  CCIPVersion,
} from './types.ts'
import { networkInfo } from './utils.ts'

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
 * Optional configuration for the {@link execute} function.
 */
export type ExecuteOptions = {
  /**
   * Source transaction hash containing the CCIP request.
   * Only required when the API is disabled (`api: false`). When the API is enabled
   * (default), this is derived automatically from the API response.
   */
  txHash?: string
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
  /**
   * Use CCIP API to fetch execution inputs.
   * Falls back to RPC if API is unreachable (defaults to true).
   */
  api?: boolean
  /**
   * Override the default CCIP API URL.
   */
  apiUrlOverride?: string
}

/**
 * Discover chains from RPC URLs and find the source transaction.
 *
 * @internal
 */
function discoverChains(
  rpcs: readonly string[],
  txHash: string,
): [
  getChain: ChainGetter,
  sourceTx: Promise<[Chain, ChainTransaction]>,
  cleanup: () => Promise<void>,
] {
  const chains = new Map<string, Chain>()

  let resolveTx!: (v: [Chain, ChainTransaction]) => void
  let rejectTx!: (e: unknown) => void
  const sourceTx = new Promise<[Chain, ChainTransaction]>((resolve, reject) => {
    resolveTx = resolve
    rejectTx = reject
  })

  const matchingFamilies = Object.values(supportedChains).filter((C) => C.isTxHash(txHash))

  const tryUrl = async (C: (typeof matchingFamilies)[number], url: string): Promise<void> => {
    const chain = await C.fromUrl(url)
    if (chains.has(chain.network.name)) {
      await chain.destroy?.()
      return
    }
    chains.set(chain.network.name, chain)
    const tx = await chain.getTransaction(txHash)
    resolveTx([chain, tx])
  }

  const discoveryDone = Promise.allSettled(
    matchingFamilies.flatMap((C) => rpcs.map((url) => tryUrl(C, url))),
  )
  void discoveryDone.then(() => rejectTx(new CCIPTransactionNotFoundError(txHash)))

  const getChain: ChainGetter = async (idOrSelectorOrName) => {
    const network = networkInfo(idOrSelectorOrName)
    if (chains.has(network.name)) return chains.get(network.name)!

    await discoveryDone
    if (chains.has(network.name)) return chains.get(network.name)!

    // Chain not discovered — try all URLs for its family
    const C = supportedChains[network.family]
    if (!C) throw new CCIPRpcNotFoundError(network.name)

    for (const url of rpcs) {
      try {
        const chain = await C.fromUrl(url)
        if (chain.network.name === network.name) {
          chains.set(network.name, chain)
          return chain
        }
        if (!chains.has(chain.network.name)) {
          chains.set(chain.network.name, chain)
        } else {
          await chain.destroy?.()
        }
      } catch {
        // URL doesn't work for this family
      }
    }
    throw new CCIPRpcNotFoundError(network.name)
  }

  const cleanup = async () => {
    await Promise.all([...chains.values()].map((c) => c.destroy?.() ?? Promise.resolve()))
  }

  return [getChain, sourceTx, cleanup]
}

/**
 * Reconnect an EVM wallet to the destination chain's provider.
 * Duck-types the wallet for an ethers-compatible `.connect()` method.
 *
 * @internal
 */
function reconnectWallet(wallet: unknown, dest: Chain): unknown {
  if (
    typeof wallet === 'object' &&
    wallet !== null &&
    'connect' in wallet &&
    typeof wallet.connect === 'function' &&
    'provider' in dest
  ) {
    return (wallet.connect as (provider: unknown) => unknown)(
      (dest as unknown as { provider: unknown }).provider,
    )
  }
  return wallet
}

/**
 * Data fetched from the CCIP API for manual execution.
 * @internal
 */
type APIExecutionData =
  | {
      version: 'v1'
      request?: CCIPRequest
      offRamp?: string
      messagesInBatch?: CCIPMessage[]
    }
  | {
      version: 'v2'
      request?: CCIPRequest
      offRamp: string
      encodedMessage: string
      ccvAddresses: string[]
      verifierResults: string[]
    }

/**
 * Fetch execution data from the CCIP API (best-effort).
 * Returns partial data - any failures are logged and silently skipped.
 * @internal
 */
async function fetchExecutionDataFromAPI(
  messageId: string,
  apiUrlOverride: string | undefined,
  logger: Logger,
): Promise<APIExecutionData> {
  const apiClient = CCIPAPIClient.fromUrl(apiUrlOverride, { logger })

  // Make API calls in parallel for efficiency
  const [requestResult, executionInputsResult] = await Promise.allSettled([
    apiClient.getMessageById(messageId),
    apiClient.getExecutionInputs(messageId),
  ])

  // Process getMessageById result (version-agnostic)
  let request: CCIPRequest | undefined
  if (requestResult.status === 'fulfilled') {
    request = requestResult.value
    logger.debug('execute: fetched request via API')
  } else {
    logger.debug('execute: getMessageById failed, will use RPC', {
      error: requestResult.reason as unknown,
    })
  }

  // Process getExecutionInputs result
  if (executionInputsResult.status === 'fulfilled') {
    const executionInputs = executionInputsResult.value

    if (isExecutionInputsV2(executionInputs)) {
      logger.debug('execute: detected V2 execution inputs from API', {
        offRamp: executionInputs.offramp,
      })
      return {
        version: 'v2',
        request,
        offRamp: executionInputs.offramp,
        encodedMessage: executionInputs.encodedMessage,
        ccvAddresses: executionInputs.verifierAddresses,
        verifierResults: executionInputs.ccvData,
      }
    }

    const messagesInBatch = executionInputs.messageBatch.map((rawMsg) => decodeMessage(rawMsg))
    logger.debug('execute: fetched V1 execution inputs via API', {
      offRamp: executionInputs.offramp,
      messageCount: messagesInBatch.length,
    })
    return {
      version: 'v1',
      request,
      offRamp: executionInputs.offramp,
      messagesInBatch,
    }
  }

  logger.debug('execute: getExecutionInputs failed, will use RPC', {
    error: executionInputsResult.reason as unknown,
  })
  return { version: 'v1', request }
}

/**
 * Execute a V1.x CCIP message using commit reports and merkle proofs.
 * @internal
 */
async function executeV1(
  messageId: string,
  source: Chain,
  dest: Chain,
  request: CCIPRequest,
  wallet: unknown,
  apiData: Extract<APIExecutionData, { version: 'v1' }>,
  options: ExecuteOptions,
): Promise<CCIPExecution> {
  // 1. Discover OffRamp (API or RPC)
  const offRamp =
    apiData.offRamp ?? (await discoverOffRamp(source, dest, request.lane.onRamp, source))

  // 2. Get commit store
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)

  // 3. Get commit report (V1 lanes should always have onchain commits)
  const commit = await dest.getVerifications({ commitStore, request })
  if (!('report' in commit)) {
    throw new CCIPOnchainCommitRequiredError(messageId)
  }

  // 4. Get messages in batch (API already fetched, or RPC fallback)
  const messagesInBatch =
    apiData.messagesInBatch ?? (await source.getMessagesInBatch(request, commit.report))

  // 6. Calculate merkle proof
  const execReportProof = calculateManualExecProof(
    messagesInBatch,
    request.lane,
    messageId,
    commit.report.merkleRoot,
    dest,
  )

  // 7. Get offchain token data (USDC/LBTC attestations)
  const offchainTokenData = await source.getOffchainTokenData(request)

  // 8. Assemble execution report
  const execReport: ExecutionReport = {
    ...execReportProof,
    message: request.message,
    offchainTokenData,
  }

  // 9. Optional gas estimation
  let effectiveGasLimit = options.gasLimit
  if (options.estimateGasLimit != null) {
    const { estimateReceiveExecution } = await import('./gas.ts')
    let estimated = await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: offRamp,
      message: request.message,
    })
    estimated += Math.ceil((estimated * options.estimateGasLimit) / 100)
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

  // 10. Execute on destination chain
  return await dest.executeReport({
    offRamp,
    execReport,
    wallet,
    gasLimit: effectiveGasLimit,
    tokensGasLimit: options.tokensGasLimit,
    forceBuffer: options.forceBuffer,
    forceLookupTable: options.forceLookupTable,
  })
}

/**
 * Execute a V2.0 CCIP message using API-provided offchain verification data.
 * A future RPC-only path will retrieve verifications directly, removing the API requirement.
 * @internal
 */
async function executeV2(
  dest: Chain,
  wallet: unknown,
  apiData: Extract<APIExecutionData, { version: 'v2' }>,
  options: ExecuteOptions,
): Promise<CCIPExecution> {
  return await dest.executeV2Message({
    offRamp: apiData.offRamp,
    encodedMessage: apiData.encodedMessage,
    ccvAddresses: apiData.ccvAddresses,
    verifierResults: apiData.verifierResults,
    gasLimit: options.gasLimit != null ? BigInt(options.gasLimit) : undefined,
    wallet,
  })
}

/**
 * Execute a CCIP message manually on the destination chain.
 *
 * Orchestrates the full manual execution flow: auto-discovers source and destination
 * chains from the provided RPC URLs, fetches the message from the source transaction,
 * and executes it on the destination chain. Supports both V1.x (onchain commit reports
 * with merkle proofs) and V2.0 (offchain CCV verification, currently via API) messages.
 *
 * @param messageId - Message ID to execute
 * @param wallet - Chain-specific wallet/signer for the destination chain
 * @param rpcs - RPC endpoint URLs (must cover both source and destination chains)
 * @param options - Optional configuration for gas limits, execution behavior, and source txHash
 * @returns Promise resolving to the execution result
 *
 * @throws {@link CCIPTransactionNotFoundError} if the transaction cannot be found on any chain
 * @throws {@link CCIPRpcNotFoundError} if no RPC is available for the destination chain
 * @throws {@link CCIPMessageNotFoundInTxError} if no message with the given messageId exists in the transaction
 * @throws {@link CCIPApiRequiredError} if the operation requires the API but it is disabled or unreachable
 * @throws {@link CCIPArgumentInvalidError} if txHash is missing and cannot be derived from the API
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
 * // API enabled (default) — txHash is derived automatically
 * const result = await execute(
 *   '0x...',  // messageId
 *   signer,
 *   ['https://rpc.sepolia.org', 'https://rpc.fuji.avax.network'],
 * )
 *
 * // API disabled — txHash must be provided explicitly
 * const result2 = await execute(
 *   '0x...',  // messageId
 *   signer,
 *   ['https://rpc.sepolia.org', 'https://rpc.fuji.avax.network'],
 *   { api: false, txHash: '0x...' },
 * )
 * console.log(`Executed: ${result.log.transactionHash}`)
 * ```
 *
 * @see {@link calculateManualExecProof} - Lower-level proof calculation
 * @see {@link discoverOffRamp} - OffRamp discovery
 */
export async function execute(
  messageId: string,
  wallet: unknown,
  rpcs: readonly string[],
  options: ExecuteOptions = {},
): Promise<CCIPExecution> {
  // Resolve txHash: use provided value, derive from API, or throw
  let effectiveTxHash = options.txHash
  let prefetchedApiData: APIExecutionData | undefined

  if (!effectiveTxHash) {
    if (options.api === false) {
      throw new CCIPArgumentInvalidError(
        'txHash',
        'txHash is required when the API is disabled (api: false). Provide it via options.txHash.',
      )
    }
    // Pre-fetch from API to derive txHash (console as logger since source chain is unknown)
    prefetchedApiData = await fetchExecutionDataFromAPI(messageId, options.apiUrlOverride, console)
    effectiveTxHash = prefetchedApiData.request?.tx.hash
    if (!effectiveTxHash) {
      throw new CCIPArgumentInvalidError(
        'txHash',
        'txHash could not be resolved from the CCIP API. Provide it explicitly via options.txHash.',
      )
    }
  }

  const [getChain, sourceTx, cleanup] = discoverChains(rpcs, effectiveTxHash)
  try {
    const [source] = await sourceTx

    // API Phase: reuse pre-fetched data, or fetch now with the source chain's logger
    const apiData: APIExecutionData =
      prefetchedApiData ??
      (options.api !== false
        ? await fetchExecutionDataFromAPI(messageId, options.apiUrlOverride, source.logger)
        : { version: 'v1' })

    // 1. Get request (API or RPC)
    let request: CCIPRequest
    if (apiData.request) {
      request = apiData.request
    } else {
      const requests = await source.getMessagesInTx(effectiveTxHash)
      const found = requests.find((r) => r.message.messageId === messageId)
      if (!found) {
        throw new CCIPMessageNotFoundInTxError(effectiveTxHash, {
          context: { messageId },
        })
      }
      request = found
    }

    // 2. Resolve dest chain from message's destChainSelector
    const dest = await getChain(request.lane.destChainSelector)

    // 3. Reconnect wallet to dest provider if needed
    const connectedWallet = reconnectWallet(wallet, dest)

    // 4. Branch by lane version
    if (request.lane.version === CCIPVersion.V2_0) {
      if (apiData.version !== 'v2') {
        throw new CCIPApiRequiredError(messageId)
      }
      return await executeV2(dest, connectedWallet, apiData, options)
    }

    // V1 path — if the API unexpectedly returned V2 data for a V1 lane, ignore it
    const v1Data: Extract<APIExecutionData, { version: 'v1' }> =
      apiData.version === 'v1' ? apiData : { version: 'v1' }
    return await executeV1(messageId, source, dest, request, connectedWallet, v1Data, options)
  } finally {
    await cleanup()
  }
}
