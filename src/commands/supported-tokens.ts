/* eslint-disable @typescript-eslint/no-base-to-string */
import { type Addressable, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

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
import { type CCIPSupportedToken, type PoolSupportCheck, Format } from './types.js'

// Configuration constants for fine-tuning performance and behavior
const CONFIG = {
  /**
   * Maximum number of tokens to fetch in a single registry request.
   * This limit helps avoid:
   * - RPC timeout issues
   * - Memory pressure on the client
   * Adjust based on network conditions and RPC provider limits.
   */
  BATCH_SIZE: 100,

  /**
   * Number of pools to check in parallel for chain support.
   * This chunk size balances between:
   * - RPC rate limits (avoid too many parallel requests)
   * - Performance (process multiple tokens simultaneously)
   * - Memory usage (keep Promise.all() batches reasonable)
   * Increase for faster processing if your RPC can handle it.
   * Decrease if you encounter rate limits or timeouts.
   */
  PARALLEL_POOL_CHECKS: 5,
} as const

export async function showSupportedTokens(
  providers: Providers,
  argv: { source: string; router: string; dest: string; format: Format },
) {
  console.log('[INFO] Starting token discovery for cross-chain transfers')
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const sourceProvider = await providers.forChainId(sourceChainId)

  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const destSelector = chainSelectorFromId(destChainId)

  const router = new Contract(argv.router, RouterABI, sourceProvider) as unknown as TypedContract<
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

  // Get onRamp address from router
  const onRampAddress = await router.getOnRamp(destSelector)
  const [lane, onrampContract] = await getOnRampLane(sourceProvider, onRampAddress.toString())

  // Get registry address from onRamp's static config
  const staticConfig = await onrampContract.getStaticConfig()

  // Get registry address based on version
  if (lane.version === CCIPVersion_1_2) throw new Error('Deprecated CCIP onRamp version')
  const registryAddress = (staticConfig as { tokenAdminRegistry: string | Addressable })
    .tokenAdminRegistry

  console.log(`[INFO] Using TokenAdminRegistry at ${registryAddress.toString()}`)
  const registry = new Contract(
    registryAddress,
    TokenAdminRegistryABI,
    sourceProvider,
  ) as unknown as TypedContract<typeof TokenAdminRegistryABI>

  // Handle pagination
  let startIndex = 0n
  const maxCount = CONFIG.BATCH_SIZE
  const tokenToPoolMap: Record<string, string> = {}
  let tokensBatch: Array<string | Addressable> = []
  let totalScanned = 0

  console.log(
    `[INFO] Fetching all registered tokens from "${chainNameFromId(sourceChainId)}" using TokenAdminRegistry`,
  )

  do {
    console.log(`[INFO] Fetching batch: offset=${startIndex}, limit=${maxCount}`)
    tokensBatch = [...(await registry.getAllConfiguredTokens(startIndex, BigInt(maxCount)))]
    totalScanned += tokensBatch.length
    console.log(`[INFO] Found ${tokensBatch.length} tokens (total scanned: ${totalScanned})`)

    if (tokensBatch.length > 0) {
      console.log(
        `[INFO] Checking CCIP support for ${tokensBatch.length} tokens on "${chainNameFromId(destChainId)}"`,
      )
      const pools = await registry.getPools(tokensBatch)

      for (let i = 0; i < tokensBatch.length; i += CONFIG.PARALLEL_POOL_CHECKS) {
        const chunkEnd = Math.min(i + CONFIG.PARALLEL_POOL_CHECKS, tokensBatch.length)
        const chunk = tokensBatch.slice(i, chunkEnd)
        const poolsChunk = pools.slice(i, chunkEnd)

        const supportChecks = await Promise.all(
          poolsChunk.map(async (poolAddress, idx) => {
            try {
              const pool = new Contract(
                poolAddress.toString(),
                TokenPoolABI,
                sourceProvider,
              ) as unknown as TypedContract<typeof TokenPoolABI>

              const isSupported = await pool.isSupportedChain(destSelector)
              return {
                token: chunk[idx].toString(),
                pool: poolAddress.toString(),
                isSupported,
                error: null,
              } satisfies PoolSupportCheck
            } catch (error) {
              console.error(
                `[ERROR] Failed to check support for pool ${poolAddress.toString()} | token ${chunk[idx].toString()}`,
                error,
              )
              return {
                token: chunk[idx].toString(),
                pool: poolAddress.toString(),
                isSupported: false,
                error: error instanceof Error ? error : new Error(String(error)),
              } satisfies PoolSupportCheck
            }
          }),
        )

        for (const { token, pool, isSupported } of supportChecks) {
          if (isSupported) {
            tokenToPoolMap[token] = pool
          }
        }
      }
    }

    startIndex += BigInt(tokensBatch.length)
  } while (tokensBatch.length === maxCount)

  const supportedTokenCount = Object.keys(tokenToPoolMap).length
  console.log(
    `[SUMMARY] Scanned ${totalScanned} tokens, found ${supportedTokenCount} supported for "${chainNameFromId(sourceChainId)}" -> "${chainNameFromId(destChainId)}"`,
  )

  // Get metadata for supported tokens
  const tokenDetails = await Promise.all(
    Array.from(Object.keys(tokenToPoolMap)).map(
      async (
        token,
      ): Promise<{
        success: CCIPSupportedToken | null
        error: { token: string; error: Error } | null
      }> => {
        try {
          const erc20 = new Contract(token, TokenABI, sourceProvider) as unknown as TypedContract<
            typeof TokenABI
          >
          const [name, symbol, decimals] = await Promise.all([
            erc20.name(),
            erc20.symbol(),
            erc20.decimals(),
          ])
          return {
            success: {
              name,
              symbol,
              decimals,
              address: token,
              pool: tokenToPoolMap[token],
            },
            error: null,
          }
        } catch (error) {
          return {
            success: null,
            error: {
              token,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          }
        }
      },
    ),
  )

  const successfulTokens = tokenDetails
    .filter((result) => result.success)
    .map((result) => result.success!)
  const failedTokens = tokenDetails.filter((result) => result.error).map((result) => result.error!)

  // Create metadata structure once
  const summary = {
    metadata: {
      timestamp: new Date().toISOString(),
      source: {
        chain: chainNameFromId(sourceChainId),
        chainId: sourceChainId,
        router: argv.router,
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

  // Log successful tokens
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
      }

      // Log failed tokens
      if (failedTokens.length > 0) {
        console.log('\n=== Failed Tokens ===')
        for (const { token, error } of failedTokens) {
          console.error(`[ERROR] Token: ${token}, Error:`, error)
        }
      }
  }

  // Log errors
  if (failedTokens.length > 0) {
    console.error('[ERROR] Failed to fetch metadata for some tokens:')
    for (const { token, error } of failedTokens) {
      console.error(`[ERROR] Token: ${token}, Error:`, error)
    }
  }
}
