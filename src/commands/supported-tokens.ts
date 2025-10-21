/**
 * CCIP Token Discovery Service
 *
 * Discovers and validates tokens that can be transferred between chains using Chainlink's CCIP.
 * The service handles pagination, parallel processing, and comprehensive error collection.
 *
 * Architecture:
 * 1. Chain & Contract Setup: Validates cross-chain paths and initializes core contracts
 * 2. Token Discovery: Fetches all registered tokens with pagination
 * 3. Support Validation: Checks token support for destination chain
 * 4. Detail Collection: Gathers token and pool information in parallel
 *
 * Performance Considerations:
 * - Uses batching to prevent RPC timeouts (configurable batch sizes)
 * - Implements parallel processing with rate limiting
 * - Memory-efficient token processing through pagination
 *
 * Error Handling:
 * - Individual token failures don't halt the process
 * - Errors are collected and reported comprehensively
 * - Detailed error reporting for debugging
 *
 * @module supported-tokens
 */

/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  type Addressable,
  type JsonRpcApiProvider,
  Contract,
  ZeroAddress,
  formatUnits,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { Format } from './types.ts'
import { formatArray, formatDuration, yieldResolved } from './utils.ts'
import TokenABI from '../abi/BurnMintERC677Token.ts'
import TokenPool_1_5_ABI from '../abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_5_1_ABI from '../abi/LockReleaseTokenPool_1_5_1.ts'
import RouterABI from '../abi/Router.ts'
import TokenAdminRegistryABI from '../abi/TokenAdminRegistry_1_5.ts'
import {
  bigIntReplacer,
  chainIdFromName,
  chainNameFromSelector,
  chainSelectorFromId,
  decodeAddress,
  networkInfo,
} from '../lib/index.ts'

/**
 * Maximum tokens per registry request.
 */
const BATCH_SIZE = 100

type TokenPoolContract =
  | TypedContract<typeof TokenPool_1_5_ABI>
  | TypedContract<typeof TokenPool_1_5_1_ABI>

// Extended token info with pool details for CCIP
interface CCIPSupportedToken {
  name: string
  symbol: string
  decimals: number
  token: string
  pool: string
  poolTypeAndVersion: string
  poolDetails: TokenPoolLane
}

// First, let's add the necessary types
interface TokenBucket {
  tokens: bigint // amount
  lastUpdated: number
  isEnabled: boolean
  capacity: bigint
  rate: bigint
}

interface TokenPoolLane {
  remoteToken: string
  remotePools: readonly string[]
  outboundRateLimiter: TokenBucket
  inboundRateLimiter: TokenBucket
  remoteChainSelector: bigint
}

/**
 * Fetches detailed information about a token pool
 *
 * Retrieves:
 * - Remote token address
 * - Associated remote pools
 * - Rate limiter configurations (inbound/outbound)
 * - Pool type and version information
 *
 * @param poolInfo - Pool contract and metadata
 * @param destSelector - Destination chain selector
 * @returns Pool details or null if fetching fails
 */
async function getPoolLaneDetails(
  contract: TokenPoolContract,
  destSelector: bigint,
): Promise<TokenPoolLane> {
  const [remoteToken, remotePools, outboundState, inboundState] = await Promise.all([
    contract.getRemoteToken(destSelector),
    'getRemotePools' in contract
      ? contract.getRemotePools(destSelector)
      : contract.getRemotePool(destSelector).then((pool) => [pool]),
    contract.getCurrentOutboundRateLimiterState(destSelector),
    contract.getCurrentInboundRateLimiterState(destSelector),
  ])

  return {
    remoteToken: remoteToken.toString(),
    remotePools,
    outboundRateLimiter: {
      tokens: outboundState.tokens,
      lastUpdated: Number(outboundState.lastUpdated),
      isEnabled: outboundState.isEnabled,
      capacity: outboundState.capacity,
      rate: outboundState.rate,
    },
    inboundRateLimiter: {
      tokens: inboundState.tokens,
      lastUpdated: Number(inboundState.lastUpdated),
      isEnabled: inboundState.isEnabled,
      capacity: inboundState.capacity,
      rate: inboundState.rate,
    },
    remoteChainSelector: destSelector,
  }
}

/**
 * Resolves chain identifiers and initializes required providers.
 *
 * @throws {Error} If chain identifiers are invalid or providers unavailable
 */
async function parseLaneRouter(
  providers: Providers,
  argv: { source: string; dest: string; router: string },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const sourceProvider = await providers.forChainId(sourceChainId)

  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const destSelector = chainSelectorFromId(destChainId)

  return { sourceChainId, destChainId, sourceProvider, destSelector }
}

/**
 * Retrieves the TokenAdminRegistry contract from the onRamp's configuration.
 *
 * @throws {Error} If using deprecated CCIP version
 */
async function getRegistryContract(
  sourceProvider: JsonRpcApiProvider,
  router: string,
  destSelector: bigint,
) {
  const routerContract = new Contract(
    router,
    RouterABI,
    sourceProvider,
  ) as unknown as TypedContract<typeof RouterABI>

  // Get onRamp address from router
  const onRampAddress = (await routerContract.getOnRamp(destSelector)) as string

  if (onRampAddress === ZeroAddress) {
    throw new Error(
      `Lane "${(await getProviderNetwork(sourceProvider)).name}" -> "${chainNameFromSelector(destSelector)}" is not supported by router ${await routerContract.getAddress()}`,
    )
  }

  const [lane, onRampContract] = await getOnRampLane(sourceProvider, onRampAddress, destSelector)
  if ('applyPoolUpdates' in onRampContract) {
    throw new Error(`Deprecated CCIP onRamp version: ${lane.version}`) // v1.2
  }
  const staticConfig = await onRampContract.getStaticConfig()
  const registryAddress = staticConfig.tokenAdminRegistry as string
  const [, , typeAndVersion] = await getTypeAndVersion(sourceProvider, registryAddress)

  console.info('[INFO] Using', typeAndVersion, 'at', registryAddress, 'from router', router)

  return new Contract(
    registryAddress,
    TokenAdminRegistryABI,
    sourceProvider,
  ) as unknown as TypedContract<typeof TokenAdminRegistryABI>
}

/**
 * Fetches all registered tokens using pagination to handle large sets. Yield batches.
 *
 * Performance Notes:
 * - Uses BATCH_SIZE to limit request size
 * - Implements pagination to handle any number of tokens
 * - Memory-efficient through incremental processing
 */
async function* fetchAllRegisteredTokens(
  registry: TypedContract<typeof TokenAdminRegistryABI>,
  batchSize = BATCH_SIZE,
) {
  let startIndex = 0
  let tokensBatch

  console.debug(
    `[INFO] Fetching all registered tokens using TokenAdminRegistry ${await registry.getAddress()}`,
  )

  do {
    console.debug(`[INFO] Fetching batch: offset=${startIndex}, limit=${batchSize}`)
    tokensBatch = await registry.getAllConfiguredTokens(BigInt(startIndex), BigInt(batchSize))
    yield tokensBatch
    startIndex += tokensBatch.length
  } while (tokensBatch.length === batchSize)
}

/**
 * Identifies supported tokens for cross-chain transfer
 *
 * Process:
 * 1. Fetches pool addresses for tokens
 * 2. Validates pool contracts and versions
 * 3. Checks destination chain support
 * 4. Collects pool information for supported tokens
 *
 * @param registry - Token registry contract
 * @param allTokens - List of token addresses to check
 * @param sourceProvider - Source chain provider
 * @param destSelector - Destination chain selector
 * @returns Mapping of token addresses to their pool information
 */
async function findSupportedTokens(
  registry: TypedContract<typeof TokenAdminRegistryABI>,
  tokensBatch: readonly (string | Addressable)[],
  destSelector: bigint,
): Promise<Record<string, TokenPoolContract>> {
  const sourceProvider = registry.runner!.provider!
  const tokenToPoolInfo: Record<string, TokenPoolContract> = {}

  const rawPoolsChunk = await registry.getPools([...tokensBatch])

  // Filter out zero addresses and map to corresponding tokens
  const validPools = rawPoolsChunk
    .map((pool, idx) => ({
      pool: pool.toString(),
      token: tokensBatch[idx].toString(),
    }))
    .filter(({ pool }) => pool !== ZeroAddress)

  await Promise.allSettled(
    validPools.map(async ({ token, pool }) => {
      const [, version, typeAndVersion] = await getTypeAndVersion(sourceProvider, pool)
      let contract: TokenPoolContract
      switch (version) {
        case '1.5.0':
          contract = new Contract(
            pool,
            TokenPool_1_5_ABI,
            sourceProvider,
          ) as unknown as TypedContract<typeof TokenPool_1_5_ABI>
          break
        case '1.5.1':
        case '1.6.0': // SiloedLockReleaseTokenPool 1.6 is compatible with 1.5.1 functions we need
          contract = new Contract(
            pool,
            TokenPool_1_5_1_ABI,
            sourceProvider,
          ) as unknown as TypedContract<typeof TokenPool_1_5_1_ABI>
          break
        default:
          console.debug(`[ERROR] Unsupported pool version: ${typeAndVersion} for pool ${pool}`)
          throw new Error(`Unsupported pool version: ${version}`)
      }

      if (await contract.isSupportedChain(destSelector)) {
        tokenToPoolInfo[token] = contract
      }
    }),
  )

  return tokenToPoolInfo
}

/**
 * Gathers detailed information about supported tokens and their pools
 *
 * Collects:
 * - Token metadata (name, symbol, decimals)
 * - Pool configuration and status
 * - Rate limiter settings
 * - Remote token and pool information
 *
 * @param tokenPool - Mapping of tokens to their pool information
 * @param sourceProvider - Source chain provider
 * @param destSelector - Destination chain selector
 * @returns Array of token details or error information
 */
async function fetchSupportedTokenDetails(
  token: string,
  pool: TokenPoolContract,
  destSelector: bigint,
): Promise<CCIPSupportedToken> {
  const erc20 = new Contract(token, TokenABI, pool.runner!.provider) as unknown as TypedContract<
    typeof TokenABI
  >
  const [name, symbol, decimalsBI] = await getContractProperties(
    erc20,
    'name',
    'symbol',
    'decimals',
  )
  const poolDetails = await getPoolLaneDetails(pool, destSelector)

  const decimals = Number(decimalsBI)

  console.debug(
    `[INFO] Successfully fetched details for token ${name} (${symbol}) at ${token} | pool ${await pool.getAddress()}`,
  )

  return {
    name,
    symbol,
    decimals,
    token,
    pool: await pool.getAddress(),
    poolTypeAndVersion: (await getTypeAndVersion(pool))[2],
    poolDetails,
  }
}

export function prettySupportedToken(token: CCIPSupportedToken) {
  console.table({
    address: token.token,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    pool: token.pool,
    'pool.typeAndVersion': token.poolTypeAndVersion,
    remoteToken: decodeAddress(
      token.poolDetails.remoteToken,
      networkInfo(token.poolDetails.remoteChainSelector).family,
    ),
    ...formatArray(
      'remotePools',
      token.poolDetails.remotePools.map((pool) =>
        decodeAddress(pool, networkInfo(token.poolDetails.remoteChainSelector).family),
      ),
    ),
    ...(!token.poolDetails.outboundRateLimiter.isEnabled
      ? { 'rateLimiters.outbound': 'disabled' }
      : {
          'rateLimiters.outbound.tokens': formatUnits(
            token.poolDetails.outboundRateLimiter.tokens,
            token.decimals,
          ),
          'rateLimiters.outbound.capacity': formatUnits(
            token.poolDetails.outboundRateLimiter.capacity,
            token.decimals,
          ),
          'rateLimiters.outbound.rate': formatUnits(
            token.poolDetails.outboundRateLimiter.rate,
            token.decimals,
          ),
          'rateLimiters.outbound.timeToRefill': formatDuration(
            Number(token.poolDetails.outboundRateLimiter.capacity) /
              Number(token.poolDetails.outboundRateLimiter.rate),
          ),
        }),
    ...(!token.poolDetails.inboundRateLimiter.isEnabled
      ? { 'rateLimiters.inbound': 'disabled' }
      : {
          'rateLimiters.inbound.tokens': formatUnits(
            token.poolDetails.inboundRateLimiter.tokens,
            token.decimals,
          ),
          'rateLimiters.inbound.capacity': formatUnits(
            token.poolDetails.inboundRateLimiter.capacity,
            token.decimals,
          ),
          'rateLimiters.inbound.rate': formatUnits(
            token.poolDetails.inboundRateLimiter.rate,
            token.decimals,
          ),
          'rateLimiters.inbound.timeToRefill': formatDuration(
            Number(token.poolDetails.inboundRateLimiter.capacity) /
              Number(token.poolDetails.inboundRateLimiter.rate),
          ),
        }),
  })
}

/**
 * Main entry point for token discovery process.
 *
 * Process Flow:
 * 1. Chain setup and validation
 * 2. Registry contract initialization
 * 3. Token discovery and filtering
 * 4. Detailed information gathering
 * 5. Result compilation and reporting
 *
 * Error Handling:
 * - Critical errors (chain/contract setup) halt the process
 * - Non-critical errors (individual tokens) are collected and reported
 * - Comprehensive error reporting for debugging
 *
 * Output Formats:
 * - json: Machine-readable complete output
 * - log: Basic console logging
 * - pretty: Formatted human-readable output
 */
export async function showSupportedTokens(
  providers: Providers,
  argv: { source: string; router: string; dest: string; format: Format },
) {
  console.log('[INFO] Starting token discovery for cross-chain transfers')

  const { sourceProvider, destSelector } = await parseLaneRouter(providers, argv)

  const registry = await getRegistryContract(sourceProvider, argv.router, destSelector)

  let totalTokens = 0,
    supportedTokens = 0
  for await (const tokenBatch of fetchAllRegisteredTokens(registry)) {
    totalTokens += tokenBatch.length

    const tokenPools = await findSupportedTokens(registry, tokenBatch, destSelector)
    supportedTokens += Object.keys(tokenPools).length

    for await (const tokenDetails of yieldResolved(
      Object.entries(tokenPools).map(([token, pool]) =>
        fetchSupportedTokenDetails(token, pool, destSelector),
      ),
    )) {
      switch (argv.format) {
        case Format.pretty:
          prettySupportedToken(tokenDetails)
          break
        case Format.log:
          console.log(tokenDetails)
          break
        case Format.json:
          console.log(JSON.stringify(tokenDetails, bigIntReplacer, 2))
          break
      }
    }
  }

  console.info('Summary: totalTokens =', totalTokens, ', supportedTokens =', supportedTokens)
}
