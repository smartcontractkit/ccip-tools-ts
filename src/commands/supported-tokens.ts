/* eslint-disable @typescript-eslint/no-base-to-string */
import { type Addressable, type JsonRpcApiProvider, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import { chunk } from 'lodash-es'

import TokenABI from '../abi/BurnMintERC677Token.js'
import TokenPoolABI from '../abi/BurnMintTokenPool_1_5.js'
import RouterABI from '../abi/Router.js'
import TokenAdminRegistryABI from '../abi/TokenAdminRegistry_1_5.js'

import {
  CCIPVersion_1_2,
  bigIntReplacer,
  chainIdFromName,
  chainNameFromId,
  chainSelectorFromId,
  getOnRampLane,
} from '../lib/index.js'
import type { Providers } from '../providers.js'
import {
  type CCIPSupportedToken,
  type PoolSupportCheck,
  type TokenChunk,
  type TokenDetailsError,
  type TokenDetailsResult,
  type TokenPoolDetails,
  Format,
} from './types.js'

// Configuration constants for fine-tuning performance and behavior
const CONFIG = {
  BATCH_SIZE: 100,
  PARALLEL_POOL_CHECKS: 5,
  PARALLEL_POOL_DETAILS: 3,
} as const

function isSuccessResult(
  result: TokenDetailsResult,
): result is { success: CCIPSupportedToken; error: null } {
  return result.success !== null
}

function isErrorResult(
  result: TokenDetailsResult,
): result is { success: null; error: TokenDetailsError } {
  return result.error !== null
}

/**
 * Fetch details about a specific pool (remote token, rate limiters, etc.).
 */
async function getPoolDetails(
  pool: TypedContract<typeof TokenPoolABI>,
  destSelector: bigint,
): Promise<TokenPoolDetails | null> {
  try {
    const [remoteToken, remotePools, outboundState, inboundState] = await Promise.all([
      pool.getRemoteToken(destSelector),
      pool.getRemotePools(destSelector),
      pool.getCurrentOutboundRateLimiterState(destSelector),
      pool.getCurrentInboundRateLimiterState(destSelector),
    ])

    return {
      remoteToken: remoteToken.toString(),
      remotePools: remotePools.map((p) => p.toString()),
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
    }
  } catch (error) {
    console.error(
      `[ERROR] Failed to fetch pool details for pool ${await pool.getAddress()}:`,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

/**
 * 1) Parse CLI arguments into chain IDs and providers.
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
 * 2) Check chain support to ensure the lane is valid.
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
 * 3) Retrieve the TokenAdminRegistry contract from onRamp's static config.
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
 * 4) Fetch all registered tokens from the registry in a paginated manner.
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
 * 5) Check which tokens are supported on the destination chain.
 */

async function findSupportedTokens(
  registry: TypedContract<typeof TokenAdminRegistryABI>,
  allTokens: Array<string | Addressable>,
  sourceProvider: JsonRpcApiProvider,
  destSelector: bigint,
) {
  const tokenToPoolMap: Record<string, string> = {}
  // Split `allTokens` into slices of size `CONFIG.PARALLEL_POOL_CHECKS`
  const tokenChunks = chunk(allTokens, CONFIG.PARALLEL_POOL_CHECKS)

  for (const chunkTokens of tokenChunks) {
    // We fetch pools for these chunk tokens
    const poolsChunk = await registry.getPools(chunkTokens)

    const supportChecks: PoolSupportCheck[] = await Promise.all(
      poolsChunk.map(async (poolAddress, idx) => {
        try {
          const pool = new Contract(
            poolAddress.toString(),
            TokenPoolABI,
            sourceProvider,
          ) as unknown as TypedContract<typeof TokenPoolABI>

          const isSupported = await pool.isSupportedChain(destSelector)
          return {
            token: chunkTokens[idx].toString(),
            pool: poolAddress.toString(),
            isSupported,
            error: null,
          } satisfies PoolSupportCheck
        } catch (error) {
          console.error(
            `[ERROR] Failed to check support for pool ${poolAddress.toString()} | token ${chunkTokens[
              idx
            ].toString()}`,
            error,
          )
          return {
            token: chunkTokens[idx].toString(),
            pool: poolAddress.toString(),
            isSupported: false,
            error: error instanceof Error ? error : new Error(String(error)),
          } satisfies PoolSupportCheck
        }
      }),
    )

    // Collect results
    for (const { token, pool, isSupported } of supportChecks) {
      if (isSupported) {
        tokenToPoolMap[token] = pool
      }
    }
  }

  return tokenToPoolMap
}

/**
 * 6) Fetch details (ERC20 + pool details) for each supported token.
 */
async function fetchTokenDetailsForSupportedTokens(
  tokenToPoolMap: Record<string, string>,
  sourceProvider: JsonRpcApiProvider,
  destSelector: bigint,
): Promise<TokenDetailsResult[]> {
  // chunk tokens for parallel fetching
  const tokens = Object.keys(tokenToPoolMap)
  const tokenDetails = (
    await Promise.all(
      chunk(tokens, CONFIG.PARALLEL_POOL_DETAILS).map(
        async (tokenChunk: TokenChunk): Promise<TokenDetailsResult[]> => {
          const chunkResults: TokenDetailsResult[] = await Promise.all(
            tokenChunk.map(async (token: string): Promise<TokenDetailsResult> => {
              try {
                const erc20 = new Contract(
                  token,
                  TokenABI,
                  sourceProvider,
                ) as unknown as TypedContract<typeof TokenABI>
                const pool = new Contract(
                  tokenToPoolMap[token],
                  TokenPoolABI,
                  sourceProvider,
                ) as unknown as TypedContract<typeof TokenPoolABI>

                const [name, symbol, decimalsBI, poolDetails] = await Promise.all([
                  erc20.name(),
                  erc20.symbol(),
                  erc20.decimals(),
                  getPoolDetails(pool, destSelector),
                ])

                const decimals = Number(decimalsBI)

                console.log(
                  `[INFO] Successfully fetched details for token ${name} (${symbol}) and its pool`,
                )

                return {
                  success: {
                    name,
                    symbol,
                    decimals,
                    address: token,
                    pool: tokenToPoolMap[token],
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
          return chunkResults
        },
      ),
    )
  ).flat()

  return tokenDetails
}

/**
 * Consolidate successful / failed tokens into an object for final reporting.
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
 * 7) Main function: Orchestrates the entire flow while keeping the logic the same.
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
  const tokenToPoolMap = await findSupportedTokens(
    registry,
    allTokens,
    sourceProvider,
    destSelector,
  )

  const supportedTokenCount = Object.keys(tokenToPoolMap).length
  console.log(
    `[SUMMARY] Scanned ${totalScanned} tokens, found ${supportedTokenCount} supported for "${chainNameFromId(
      sourceChainId,
    )}" -> "${chainNameFromId(destChainId)}"`,
  )

  // Step 6) Fetch detailed token + pool info for the supported tokens
  console.log('[INFO] Fetching detailed token and pool information')
  const tokenDetails = await fetchTokenDetailsForSupportedTokens(
    tokenToPoolMap,
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
          `[INFO] Token: ${token.name} (${token.symbol}) at ${token.address}, decimals=${token.decimals}, pool=${token.pool}`,
        )
        if (token.poolDetails) {
          console.log(`  Remote Token: ${token.poolDetails.remoteToken}`)
          console.log(`  Remote Pools: ${token.poolDetails.remotePools.join(', ')}`)
          console.log('  Rate Limiters:')
          console.log('    Outbound:')
          console.log(`      Enabled: ${token.poolDetails.outboundRateLimiter.isEnabled}`)
          console.log(`      Tokens: ${token.poolDetails.outboundRateLimiter.tokens}`)
          console.log(`      Capacity: ${token.poolDetails.outboundRateLimiter.capacity}`)
          console.log(`      Rate: ${token.poolDetails.outboundRateLimiter.rate}/sec`)
          console.log('    Inbound:')
          console.log(`      Enabled: ${token.poolDetails.inboundRateLimiter.isEnabled}`)
          console.log(`      Tokens: ${token.poolDetails.inboundRateLimiter.tokens}`)
          console.log(`      Capacity: ${token.poolDetails.inboundRateLimiter.capacity}`)
          console.log(`      Rate: ${token.poolDetails.inboundRateLimiter.rate}/sec`)
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
