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
import { type Addressable, type JsonRpcApiProvider, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { chunk } from 'lodash-es'

import TokenABI from '../abi/BurnMintERC677Token.js'
import RouterABI from '../abi/Router.js'
import TokenAdminRegistryABI from '../abi/TokenAdminRegistry_1_5.js'

import {
  type CCIPContractType,
  type CCIPTokenPoolsVersion,
  type CCIPVersion,
  CCIPContractTypeBurnMintTokenPool,
  CCIPContractTypeTokenPool,
  CCIPVersion_1_2,
  CCIPVersion_1_5_1,
  CCIP_ABIs,
  bigIntReplacer,
  chainIdFromName,
  chainNameFromId,
  chainSelectorFromId,
  getOnRampLane,
} from '../lib/index.js'
import { getTypeAndVersion } from '../lib/utils.js'
import type { Providers } from '../providers.js'
import {
  type CCIPSupportedToken,
  type TokenChunk,
  type TokenDetailsError,
  type TokenDetailsResult,
  type TokenPoolDetails,
  type VersionedTokenPool,
  Format,
} from './types.js'

/**
 * Performance and reliability configuration.
 * Adjust these values based on network conditions and RPC provider capabilities.
 */
const CONFIG = {
  /**
   * Maximum tokens per registry request.
   */
  BATCH_SIZE: 100,

  /**
   * Parallel pool support checks.
   * - Increase: If RPC can handle more concurrent requests
   * - Decrease: If hitting rate limits or timeouts
   */
  PARALLEL_POOL_CHECKS: 5,

  /**
   * Parallel pool detail fetching.
   * Separate from POOL_CHECKS as these calls are heavier.
   */
  PARALLEL_POOL_DETAILS: 3,
} as const

/**
 * Type guard for successful token discovery results
 *
 * @param result - Token discovery result to check
 * @returns True if result contains successful token discovery
 */
function isSuccessResult(
  result: TokenDetailsResult,
): result is { success: CCIPSupportedToken; error: null } {
  return result.success !== null
}

/**
 * Type guard for failed token discovery results
 *
 * @param result - Token discovery result to check
 * @returns True if result contains token discovery error
 */
function isErrorResult(
  result: TokenDetailsResult,
): result is { success: null; error: TokenDetailsError } {
  return result.error !== null
}

/**
 * Pool information interface
 * Contains version, type, and contract details for a token pool
 */
interface PoolInfo {
  type: CCIPContractTypeTokenPool
  version: CCIPTokenPoolsVersion
  contract: TypedContract<(typeof CCIP_ABIs)[CCIPContractTypeTokenPool][CCIPTokenPoolsVersion]>
  address: string
  isCustomPool?: boolean
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
async function getPoolDetails(
  poolInfo: PoolInfo,
  destSelector: bigint,
): Promise<TokenPoolDetails | null> {
  try {
    const [remoteToken, remotePools, outboundState, inboundState] = await Promise.all([
      poolInfo.contract.getRemoteToken(destSelector),
      getRemotePoolsForVersion(poolInfo, destSelector),
      poolInfo.contract.getCurrentOutboundRateLimiterState(destSelector),
      poolInfo.contract.getCurrentInboundRateLimiterState(destSelector),
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
      isCustomPool: poolInfo.isCustomPool,
      type: poolInfo.type,
      version: poolInfo.version,
    }
  } catch (error) {
    console.error(
      `[ERROR] Failed to fetch pool details for pool ${poolInfo.address} | type ${poolInfo.type} v${poolInfo.version}:`,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

/**
 * Resolves chain identifiers and initializes required providers.
 *
 * @throws {Error} If chain identifiers are invalid or providers unavailable
 */
async function parseChainIds(
  providers: Providers,
  argv: { source: string; dest: string; router: string; format: Format },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const sourceProvider = await providers.forChainId(sourceChainId)

  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const destSelector = chainSelectorFromId(destChainId)

  return { sourceChainId, destChainId, sourceProvider, destSelector }
}

/**
 * Validates that the specified cross-chain lane is supported.
 *
 * @throws {Error} If the lane is not supported by CCIP
 */
async function checkChainSupport(
  routerAddress: string,
  sourceProvider: JsonRpcApiProvider,
  destSelector: bigint,
  sourceChainId: number,
  destChainId: number,
) {
  const router = new Contract(routerAddress, RouterABI, sourceProvider) as unknown as TypedContract<
    typeof RouterABI
  >

  const isChainSupported = await router.isChainSupported(destSelector)
  if (!isChainSupported) {
    throw new Error(
      `Lane "${chainNameFromId(sourceChainId)}" -> "${chainNameFromId(destChainId)}" is not supported`,
    )
  }

  console.log(
    `[INFO] Lane "${chainNameFromId(sourceChainId)}" -> "${chainNameFromId(destChainId)}" is supported`,
  )

  return router
}

/**
 * Retrieves the TokenAdminRegistry contract from the onRamp's configuration.
 *
 * @throws {Error} If using deprecated CCIP version
 */
async function getRegistryContract(
  router: TypedContract<typeof RouterABI>,
  sourceProvider: JsonRpcApiProvider,
  destSelector: bigint,
) {
  // Get onRamp address from router
  const onRampAddress = await router.getOnRamp(destSelector)
  const [lane, onrampContract] = await getOnRampLane(sourceProvider, onRampAddress.toString())

  // Get registry address from onRamp's static config
  const staticConfig = await onrampContract.getStaticConfig()
  if (lane.version === CCIPVersion_1_2) {
    throw new Error('Deprecated CCIP onRamp version')
  }

  const registryAddress = (staticConfig as { tokenAdminRegistry: string | Addressable })
    .tokenAdminRegistry

  console.log(`[INFO] Using TokenAdminRegistry at ${registryAddress.toString()}`)

  const registry = new Contract(
    registryAddress,
    TokenAdminRegistryABI,
    sourceProvider,
  ) as unknown as TypedContract<typeof TokenAdminRegistryABI>

  return registry
}

/**
 * Fetches all registered tokens using pagination to handle large sets.
 *
 * Performance Notes:
 * - Uses BATCH_SIZE to limit request size
 * - Implements pagination to handle any number of tokens
 * - Memory-efficient through incremental processing
 */
async function fetchAllRegisteredTokens(
  registry: TypedContract<typeof TokenAdminRegistryABI>,
  sourceChainId: number,
) {
  let startIndex = 0n
  const maxCount = CONFIG.BATCH_SIZE
  let tokensBatch: Array<string | Addressable> = []
  let totalScanned = 0
  const allTokens: Array<string | Addressable> = []

  console.log(
    `[INFO] Fetching all registered tokens from "${chainNameFromId(sourceChainId)}" using TokenAdminRegistry`,
  )

  do {
    console.log(`[INFO] Fetching batch: offset=${startIndex}, limit=${maxCount}`)
    tokensBatch = [...(await registry.getAllConfiguredTokens(startIndex, BigInt(maxCount)))]
    totalScanned += tokensBatch.length
    console.log(`[INFO] Found ${tokensBatch.length} tokens (total scanned: ${totalScanned})`)

    allTokens.push(...tokensBatch)
    startIndex += BigInt(tokensBatch.length)
  } while (tokensBatch.length === maxCount)

  return { allTokens, totalScanned }
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
  allTokens: Array<string | Addressable>,
  sourceProvider: JsonRpcApiProvider,
  destSelector: bigint,
): Promise<Record<string, PoolInfo>> {
  const tokenToPoolInfo: Record<string, PoolInfo> = {}
  const tokenChunks = chunk(allTokens, CONFIG.PARALLEL_POOL_CHECKS)

  for (const chunkTokens of tokenChunks) {
    const poolsChunk = await registry.getPools(chunkTokens)

    const supportChecks = await Promise.all(
      poolsChunk.map(async (poolAddress, idx) => {
        const result = await getVersionedPoolContract(poolAddress.toString(), sourceProvider)

        if ('error' in result) {
          console.error(
            `[ERROR] Failed to initialize pool ${poolAddress.toString()} | token ${chunkTokens[idx].toString()}}`,
            result.error,
          )
          return {
            token: chunkTokens[idx].toString(),
            isSupported: false,
            error: result.error,
          }
        }

        try {
          const isSupported = await result.contract.isSupportedChain(destSelector)
          return {
            token: chunkTokens[idx].toString(),
            pool: {
              ...result,
              address: poolAddress.toString(),
            },
            isSupported,
            error: null,
          }
        } catch (error) {
          console.error(
            `[ERROR] Failed to check support for pool ${poolAddress.toString()} | type ${result.type} | version ${result.version} | token ${chunkTokens[idx].toString()}`,
            error,
          )
          return {
            token: chunkTokens[idx].toString(),
            isSupported: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }
        }
      }),
    )

    // Collect results
    for (const check of supportChecks) {
      if (check.isSupported && 'pool' in check) {
        tokenToPoolInfo[check.token] = check.pool as PoolInfo
      }
    }
  }

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
 * @param tokenToPoolInfo - Mapping of tokens to their pool information
 * @param sourceProvider - Source chain provider
 * @param destSelector - Destination chain selector
 * @returns Array of token details or error information
 */
async function fetchTokenDetailsForSupportedTokens(
  tokenToPoolInfo: Record<string, PoolInfo>,
  sourceProvider: JsonRpcApiProvider,
  destSelector: bigint,
): Promise<TokenDetailsResult[]> {
  const tokens = Object.keys(tokenToPoolInfo)
  return (
    await Promise.all(
      chunk(tokens, CONFIG.PARALLEL_POOL_DETAILS).map(async (tokenChunk: TokenChunk) => {
        return Promise.all(
          tokenChunk.map(async (token: string): Promise<TokenDetailsResult> => {
            try {
              const erc20 = new Contract(
                token,
                TokenABI,
                sourceProvider,
              ) as unknown as TypedContract<typeof TokenABI>
              const poolInfo = tokenToPoolInfo[token]

              const [name, symbol, decimalsBI, poolDetails] = await Promise.all([
                erc20.name(),
                erc20.symbol(),
                erc20.decimals(),
                getPoolDetails(poolInfo, destSelector),
              ])

              const decimals = Number(decimalsBI)

              console.log(
                `[INFO] Successfully fetched details for token ${name} (${symbol}) at ${token} | pool ${poolInfo.address} | type ${poolInfo.type} v${poolInfo.version}`,
              )

              return {
                success: {
                  name,
                  symbol,
                  decimals,
                  address: token,
                  pool: poolInfo.address,
                  poolDetails: poolDetails ?? undefined,
                },
                error: null,
              } satisfies TokenDetailsResult
            } catch (error: unknown) {
              const actualError = error instanceof Error ? error : new Error(String(error))
              return {
                success: null,
                error: {
                  token,
                  error: actualError,
                },
              } satisfies TokenDetailsResult
            }
          }),
        )
      }),
    )
  ).flat()
}

/**
 * Prepares the final discovery report
 *
 * Generates:
 * - Process metadata (timestamp, chains, router)
 * - Statistical summary
 * - Supported token details
 * - Failed token information
 *
 * @param tokenDetails - Array of token discovery results
 * @param totalScanned - Total number of tokens checked
 * @param sourceChainId - Source chain identifier
 * @param destChainId - Destination chain identifier
 * @param routerAddress - CCIP router address
 * @returns Formatted summary and categorized results
 */
function prepareSummary(
  tokenDetails: TokenDetailsResult[],
  totalScanned: number,
  sourceChainId: number,
  destChainId: number,
  routerAddress: string,
): {
  summary: {
    metadata: {
      timestamp: string
      source: {
        chain: string
        chainId: number
        router: string
      }
      destination: {
        chain: string
        chainId: number
      }
      stats: {
        totalScanned: number
        supported: number
        failed: number
      }
    }
    tokens: CCIPSupportedToken[]
    failedTokens: { address: string; error: string }[]
  }
  successfulTokens: CCIPSupportedToken[]
  failedTokens: { token: string; error: Error }[]
} {
  const successfulTokens: CCIPSupportedToken[] = []
  const failedTokens: { token: string; error: Error }[] = []

  tokenDetails.forEach((detail) => {
    if (isSuccessResult(detail)) {
      successfulTokens.push(detail.success)
    } else if (isErrorResult(detail)) {
      failedTokens.push(detail.error)
    }
  })

  const summary = {
    metadata: {
      timestamp: new Date().toISOString(),
      source: {
        chain: chainNameFromId(sourceChainId),
        chainId: sourceChainId,
        router: routerAddress,
      },
      destination: {
        chain: chainNameFromId(destChainId),
        chainId: destChainId,
      },
      stats: {
        totalScanned,
        supported: successfulTokens.length,
        failed: failedTokens.length,
      },
    },
    tokens: successfulTokens,
    failedTokens: failedTokens.map(({ token, error }) => ({
      address: token,
      error: error.message,
    })),
  }

  return { summary, successfulTokens, failedTokens }
}

/**
 * Pool version detection utility
 *
 * Attempts to detect the pool type and version. Falls back to BurnMintTokenPool
 * with latest version if detection fails.
 *
 * @param address - The pool contract address
 * @param provider - JSON RPC provider instance
 * @returns Pool type, version and custom pool flag
 */
async function detectPoolVersion(
  address: string,
  provider: JsonRpcApiProvider,
): Promise<{ type: CCIPContractType; version: CCIPVersion; isCustomPool: boolean }> {
  try {
    const [type_, version] = await getTypeAndVersion(provider, address)
    return { type: type_, version, isCustomPool: false }
  } catch (versionError) {
    console.warn(
      `[WARN] Could not determine pool type and version for pool ${address}. Error: ${
        versionError instanceof Error ? versionError.message : String(versionError)
      }`,
    )
    console.warn('[WARN] Assuming this is a custom pool, will try with latest version')

    return {
      type: CCIPContractTypeBurnMintTokenPool,
      version: CCIPVersion_1_5_1,
      isCustomPool: true,
    }
  }
}

/**
 * Pool contract instantiation utility
 *
 * Creates a typed contract instance for a token pool with the correct ABI.
 *
 * @param address - The pool contract address
 * @param provider - JSON RPC provider instance
 * @param type_ - The pool contract type
 * @param version - The pool contract version
 * @param abi - The contract ABI matching the type and version
 * @returns Typed contract instance
 */
function createPoolContract(
  address: string,
  provider: JsonRpcApiProvider,
  type_: CCIPContractTypeTokenPool,
  version: CCIPTokenPoolsVersion,
  abi: (typeof CCIP_ABIs)[CCIPContractTypeTokenPool][CCIPTokenPoolsVersion],
): TypedContract<typeof abi> {
  return new Contract(address, abi, provider) as unknown as TypedContract<typeof abi>
}

/**
 * Version-aware pool contract factory
 *
 * Creates a version-aware pool contract instance with proper typing and error handling.
 * Handles custom pools by falling back to latest known compatible ABI.
 *
 * @param address - The pool contract address
 * @param provider - JSON RPC provider instance
 * @returns Version-aware pool contract or error details
 *
 * @throws Will not throw, returns error object instead
 */
async function getVersionedPoolContract(
  address: string,
  provider: JsonRpcApiProvider,
): Promise<VersionedTokenPool | { error: Error }> {
  try {
    const { type: type_, version, isCustomPool } = await detectPoolVersion(address, provider)

    // Validate pool type
    if (!CCIPContractTypeTokenPool.includes(type_)) {
      throw new Error(
        `Not a token pool: ${address} is "${type_} ${version}" - Supported types: ${CCIPContractTypeTokenPool.join(
          ', ',
        )}}`,
      )
    }

    // Get correct ABI based on type and version
    const abi = CCIP_ABIs[type_ as CCIPContractTypeTokenPool][version as CCIPTokenPoolsVersion]
    if (!abi) {
      throw new Error(`Unsupported pool version: ${version} for type ${type_}`)
    }

    const contract = createPoolContract(
      address,
      provider,
      type_ as CCIPContractTypeTokenPool,
      version as CCIPTokenPoolsVersion,
      abi,
    )

    return {
      version: version as CCIPTokenPoolsVersion,
      type: type_ as CCIPContractTypeTokenPool,
      contract,
      isCustomPool,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error
          : new Error(error instanceof Object ? JSON.stringify(error) : String(error)),
    }
  }
}

/**
 * Gets remote pools based on contract version
 *
 * Handles different remote pool retrieval methods based on contract version:
 * - v1.5.0: Single remote pool via getRemotePool
 * - v1.5.1: Multiple remote pools via getRemotePools
 *
 * @param versionedPool - The version-aware pool contract
 * @param destSelector - Destination chain selector
 * @returns Array of remote pool addresses
 */
async function getRemotePoolsForVersion(
  versionedPool: VersionedTokenPool,
  destSelector: bigint,
): Promise<string[]> {
  try {
    switch (versionedPool.version) {
      case '1.5.0': {
        const remotePool = await versionedPool.contract.getRemotePool(destSelector)
        return [remotePool.toString()]
      }
      case '1.5.1': {
        const remotePools = await versionedPool.contract.getRemotePools(destSelector)
        return remotePools.map((pool) => pool.toString())
      }
    }
  } catch (error) {
    console.error(
      `[ERROR] Failed to get remote pools for ${await versionedPool.contract.getAddress()} | type ${versionedPool.type} v${versionedPool.version}:`,
      error instanceof Error ? error.message : String(error),
    )
    return []
  }
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

  // Step 1) Parse chain IDs & providers
  const { sourceChainId, destChainId, sourceProvider, destSelector } = await parseChainIds(
    providers,
    argv,
  )

  // Step 2) Check chain support
  const router = await checkChainSupport(
    argv.router,
    sourceProvider,
    destSelector,
    sourceChainId,
    destChainId,
  )

  // Step 3) Get registry contract
  const registry = await getRegistryContract(router, sourceProvider, destSelector)

  // Step 4) Fetch all tokens (paginated) from registry
  const { allTokens, totalScanned } = await fetchAllRegisteredTokens(registry, sourceChainId)

  // Step 5) Check which tokens are supported on the destination chain
  const tokenToPoolInfo = await findSupportedTokens(
    registry,
    allTokens,
    sourceProvider,
    destSelector,
  )

  const supportedTokenCount = Object.keys(tokenToPoolInfo).length
  console.log(
    `[SUMMARY] Scanned ${totalScanned} tokens, found ${supportedTokenCount} supported for "${chainNameFromId(
      sourceChainId,
    )}" -> "${chainNameFromId(destChainId)}"`,
  )

  // Step 6) Fetch detailed token + pool info for the supported tokens
  console.log('[INFO] Fetching detailed token and pool information')
  const tokenDetails = await fetchTokenDetailsForSupportedTokens(
    tokenToPoolInfo,
    sourceProvider,
    destSelector,
  )

  // Step 7) Prepare summary structure
  const { summary, successfulTokens, failedTokens } = prepareSummary(
    tokenDetails,
    totalScanned,
    sourceChainId,
    destChainId,
    argv.router,
  )

  // Step 8) Output results
  switch (argv.format) {
    case Format.json:
      console.log(JSON.stringify(summary, bigIntReplacer, 2))
      break

    case Format.log:
      console.log('Supported tokens:', successfulTokens)
      break

    case Format.pretty:
    default:
      // Log metadata first
      console.log('\n=== Summary ===')
      console.log(`Timestamp: ${summary.metadata.timestamp}`)
      console.log('\nSource:')
      console.log(`  Chain: ${summary.metadata.source.chain} (${summary.metadata.source.chainId})`)
      console.log(`  Router: ${summary.metadata.source.router}`)
      console.log('\nDestination:')
      console.log(
        `  Chain: ${summary.metadata.destination.chain} (${summary.metadata.destination.chainId})`,
      )
      console.log('\nStats:')
      console.log(`  Total Scanned: ${summary.metadata.stats.totalScanned}`)
      console.log(`  Supported: ${summary.metadata.stats.supported}`)
      console.log(`  Failed: ${summary.metadata.stats.failed}`)

      // Log tokens
      console.log('\n=== Supported Tokens ===')
      for (const token of successfulTokens) {
        console.log(
          `[INFO] Token: ${token.name} (${token.symbol}) at ${token.address}, decimals=${token.decimals}`,
        )
        console.log(
          `  Pool: ${token.pool}${
            token.poolDetails?.isCustomPool
              ? ' (Custom Pool)'
              : ` (${token.poolDetails?.type} v${token.poolDetails?.version})`
          }`,
        )

        if (token.poolDetails) {
          console.log(`  Remote Token: ${token.poolDetails.remoteToken}`)
          console.log(`  Remote Pools: ${token.poolDetails.remotePools.join(', ')}`)
          console.log('  Rate Limiters:')
          console.log('    Outbound:')
          console.log(`      Enabled: ${token.poolDetails.outboundRateLimiter.isEnabled}`)
          console.log(`      Tokens: ${token.poolDetails.outboundRateLimiter.tokens}`)
          console.log(`      Capacity: ${token.poolDetails.outboundRateLimiter.capacity}`)
          console.log(`      Rate: ${token.poolDetails.outboundRateLimiter.rate}`)
          console.log('    Inbound:')
          console.log(`      Enabled: ${token.poolDetails.inboundRateLimiter.isEnabled}`)
          console.log(`      Tokens: ${token.poolDetails.inboundRateLimiter.tokens}`)
          console.log(`      Capacity: ${token.poolDetails.inboundRateLimiter.capacity}`)
          console.log(`      Rate: ${token.poolDetails.inboundRateLimiter.rate}`)
        }
        console.log('---')
      }

      // Log failed tokens
      if (failedTokens.length > 0) {
        console.log('\n=== Failed Tokens ===')
        for (const { token, error } of failedTokens) {
          console.error(`[ERROR] Token: ${token}, Error:`, error)
        }
      }
  }

  if (failedTokens.length > 0) {
    console.error('[ERROR] Failed to fetch metadata for some tokens:')
    for (const { token, error } of failedTokens) {
      console.error(`[ERROR] Token: ${token}, Error:`, error)
    }
  }
}
