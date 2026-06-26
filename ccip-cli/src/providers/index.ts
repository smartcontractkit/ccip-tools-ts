import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import {
  type Chain,
  type ChainGetter,
  type ChainTransaction,
  type EVMChain,
  type Logger,
  type NetworkInfo,
  type TONChain,
  CCIPChainFamilyUnsupportedError,
  CCIPRpcNotFoundError,
  CCIPTransactionNotFoundError,
  ChainFamily,
  NetworkType,
  networkInfo,
  signalToPromise,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'

import { loadAptosWallet } from './aptos.ts'
import {
  loadCantonConfig,
  loadCantonWallet,
  resolveCliIndexer,
  resolveCliRouter,
} from './canton.ts'
import { loadEvmWallet } from './evm.ts'
import { loadSolanaWallet } from './solana.ts'
import { loadSuiWallet } from './sui.ts'
import { loadTonWallet } from './ton.ts'
import type { Ctx } from '../commands/index.ts'
import type { GlobalOpts } from '../index.ts'

const RPCS_RE = /\b(?:http|ws)s?:\/\/[\w/\\@&?%~#.,;:=+-]+/
type FetchGlobalArgs = Partial<Pick<GlobalOpts, 'rpcs' | 'rpcsFile' | 'api' | 'cantonConfig'>>

/**
 * True for Canton JSON Ledger API base URLs (not EVM/JSON-RPC endpoints).
 * Used to avoid racing every `--rpc` against every chain family.
 */
export function isCantonLedgerUrl(url: string): boolean {
  try {
    const { pathname, port } = new URL(url)
    if (/\/api\/json\/?$/i.test(pathname)) return true
    if (/\/api\/ledger\/?$/i.test(pathname)) return true
    if (port === '7575') return true
  } catch {
    return false
  }
  return false
}

/** Keep only endpoints that plausibly belong to the requested chain family. */
export function filterEndpointsForFamily(endpoints: Set<string>, family: ChainFamily): Set<string> {
  const urls = [...endpoints]
  if (family === ChainFamily.Canton) {
    return new Set(urls.filter(isCantonLedgerUrl))
  }
  return new Set(urls.filter((url) => !isCantonLedgerUrl(url)))
}

type CantonCliArgs = Partial<Pick<GlobalOpts, 'cantonConfig'>>

/** CLI argv fields used by {@link resolveRouter}. */
export type ResolveRouterArgs = CantonCliArgs & { router?: string }

/** CLI argv fields used by {@link resolveIndexer}. */
export type ResolveIndexerArgs = CantonCliArgs & { indexer?: string[] }

/**
 * Resolve `ccip-cli send -r` for the source chain.
 * Canton source: CCIPSender instance id (CLI or canton-config `senderInstanceId`).
 * EVM source: router contract address (CLI only).
 */
export function resolveRouter(
  argv: ResolveRouterArgs,
  sourceNetwork: NetworkInfo,
  logger?: Logger,
): string | undefined {
  const cantonConfig = loadCantonConfig(argv.cantonConfig, logger)
  return resolveCliRouter(argv.router, cantonConfig, sourceNetwork.family === ChainFamily.Canton)
}

/**
 * Resolve CCIP v2 indexer URLs for verification lookups on manual-exec / show.
 * CLI `--indexer` wins; canton-config `indexerUrl` applies only when the lane involves Canton.
 */
export function resolveIndexer(
  argv: ResolveIndexerArgs,
  dest: Chain,
  logger?: Logger,
  source?: Chain,
): readonly string[] | undefined {
  const cantonConfig = loadCantonConfig(argv.cantonConfig, logger)
  const laneInvolvesCanton =
    dest.network.family === ChainFamily.Canton || source?.network.family === ChainFamily.Canton
  return resolveCliIndexer(argv.indexer, cantonConfig, laneInvolvesCanton)
}

/**
 * Collects RPC endpoints URLs in rpcs array, rpcsFile an `RPC_` env vars, and returns a Set of unique endpoints
 * @param this - Context object containing abort signal and logger properties
 * @param argv - Partial GlobalArgs argv object
 * @returns Promise resolving to a Set of unique RPC endpoint URLs
 */
export async function collectEndpoints(
  this: Ctx,
  { rpcs, rpcsFile }: Pick<FetchGlobalArgs, 'rpcs' | 'rpcsFile'>,
): Promise<Set<string>> {
  const endpoints = new Set<string>(
    rpcs
      ?.map((s) => s.split(','))
      .flat()
      .map((s) => s.trim()) || [],
  )
  for (const [env, val] of Object.entries(process.env)) {
    if (env.startsWith('RPC_') && val && RPCS_RE.test(val)) endpoints.add(val)
  }
  if (rpcsFile && existsSync(rpcsFile)) {
    try {
      const fileContent = await readFile(rpcsFile, 'utf8')
      for (const line of fileContent.toString().split(/(?:\r\n|\r|\n)/g)) {
        if (line.match(/^\s*(#|\/\/)/)) continue // skip commented lines
        const match = line.match(RPCS_RE)
        if (match) endpoints.add(match[0])
      }
    } catch (error) {
      this.logger.debug('Error reading RPCs file', error)
    }
  }
  return endpoints
}

export function fetchChainsFromRpcs(ctx: Ctx, argv: FetchGlobalArgs): ChainGetter
export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: FetchGlobalArgs,
  txHash: string,
): [ChainGetter, Promise<[Chain, ChainTransaction]>]

/**
 * Receives a list of rpcs and/or rpcs file, and loads them concurrently for each chain family
 * If txHash is provided, fetches matching families first and returns [chainGetter, txPromise];
 * Otherwise, spawns racing URLs for each family asked by `getChain` getter
 * @param ctx - Context object containing abort signal and logger properties
 * @param argv - Options containing rpcs (list), rpcs file and noApi flag
 * @param txHash - Optional txHash to fetch concurrently; causes the function to return a [ChainGetter, Promise<ChainTransaction>]
 * @returns a ChainGetter (if txHash was provided), or a tuple of [ChainGetter, Promise<ChainTransaction>]
 */
export function fetchChainsFromRpcs(ctx: Ctx, argv: FetchGlobalArgs, txHash?: string) {
  const cantonConfig = loadCantonConfig(argv.cantonConfig, ctx.logger)
  const chains: Record<string, Promise<Chain>> = {}
  const pendingChainsCbs: Record<
    string,
    readonly [resolve: (value: Chain) => void, reject: (reason?: unknown) => void]
  > = {}
  const finished: Partial<Record<ChainFamily, true>> = {}
  const initFamily$: Partial<Record<ChainFamily, Promise<unknown>>> = {}
  let endpoints$: Promise<Set<string>> | undefined
  let txFoundIn: string | undefined

  const loadChainFamily = (F: ChainFamily, txHash?: string) =>
    (initFamily$[F] ??= (endpoints$ ??= collectEndpoints.call(ctx, argv)).then((endpoints) => {
      const C = supportedChains[F]
      if (!C) throw new CCIPChainFamilyUnsupportedError(F)
      ctx.abort.throwIfAborted()
      const familyEndpoints = filterEndpointsForFamily(endpoints, F)
      ctx.logger.debug(
        'Racing',
        familyEndpoints.size,
        'RPC endpoints for',
        F,
        familyEndpoints.size < endpoints.size ? `(filtered from ${endpoints.size})` : '',
      )

      const chains$: Promise<Chain>[] = []
      const txOnlyRacers = new WeakSet<Chain>()
      for (const url of familyEndpoints) {
        const chain$ = C.fromUrl(url, {
          ...ctx,
          abort: ctx.abort,
          apiClient:
            argv.api === false ? null : typeof argv.api === 'string' ? argv.api : undefined,
          ...(cantonConfig && { cantonConfig }),
        })
        chains$.push(chain$)

        void chain$.then(
          (chain) => {
            endpoints.delete(url) // when resolved, remove from set so it isn't tried for future families
            // winner: provider cleanup is handled automatically by ctx.abort signal
            if (!(chain.network.name in chains)) {
              // chain won for this network, but was not "asked" by getChain (yet?): save
              chains[chain.network.name] = chain$
            } else if (chain.network.name in pendingChainsCbs) {
              // chain detected, and there's a "pending request" by getChain: resolve
              const [resolve] = pendingChainsCbs[chain.network.name]!
              resolve(chain)
            } else if (!txHash || txFoundIn) {
              chain.destroy() // lost race (either network's or tx's)
            } else {
              txOnlyRacers.add(chain) // lost race, but may still find tx before winner and take its place
            }
          },
          () => {},
        )
      }
      let txs$
      if (txHash) {
        txs$ = Promise.any(
          chains$.map(async (chain$) => {
            const chain = await chain$
            chain.abort.throwIfAborted()
            try {
              if (txFoundIn) throw new Error('tx already raced')
              const tx = await chain.getTransaction(txHash)
              if (txFoundIn) {
                if (txFoundIn === chain.network.name) chain.destroy()
                throw new Error('tx already raced')
              }
              txFoundIn = chain.network.name
              // in case tx is first found, prefer it over any previously found chain for this network
              chains[chain.network.name] = chain$
              return [chain, tx] as const
            } catch (err) {
              if (txOnlyRacers.has(chain)) chain.destroy()
              throw err
            }
          }),
        )
      }

      Promise.race([Promise.allSettled(chains$), signalToPromise(ctx.abort)])
        .finally(() => {
          if (finished[F]) return
          finished[F] = true
          Object.entries(pendingChainsCbs)
            .filter(([name]) => networkInfo(name).family === F)
            .forEach(([name, [_, reject]]) => reject(new CCIPRpcNotFoundError(name)))
        })
        .catch(() => {
          // signalToPromise(ctx.abort) rejects with DOMException when the parent
          // context aborts before all race URLs settle; swallow it here so the
          // void-discarded chain doesn't surface as an unhandled rejection.
        })
      return txs$
    }))

  const chainGetter = async (idOrSelectorOrName: number | string | bigint): Promise<Chain> => {
    const network = networkInfo(idOrSelectorOrName)
    if (network.name in chains) return chains[network.name]!
    if (finished[network.family]) throw new CCIPRpcNotFoundError(network.name)

    const { promise, resolve, reject } = Promise.withResolvers<Chain>()
    chains[network.name] = promise
    pendingChainsCbs[network.name] = [resolve, reject]

    void promise
      .finally(() => {
        delete pendingChainsCbs[network.name] // when chain is settled, delete the callbacks
      })
      .catch(() => {}) // rejection already handled by chainGetter caller
    void loadChainFamily(network.family)
    return promise
  }

  if (!txHash) return chainGetter

  // truty txHash means txs$ return branch of loadChainFamily
  const txResult = Promise.any(
    Object.values(supportedChains)
      .filter((C) => C.isTxHash(txHash))
      .map((C) => loadChainFamily(C.family, txHash) as Promise<[Chain, ChainTransaction]>),
  ).catch((err) =>
    Promise.reject(new CCIPTransactionNotFoundError(txHash, { context: { aggregateErr: err } })),
  )
  return [chainGetter, txResult]
}

/**
 * Load chain-specific wallet for given chain
 * @param chain - Chain instance to load wallet for
 * @param argv - Wallet options (as passed from yargs argv)
 * @returns Promise to chain-specific wallet instance
 */
export async function loadChainWallet(
  chain: Chain,
  argv: { wallet?: unknown; rpcsFile?: string; interactive?: boolean; cantonConfig?: string },
  logger?: Logger,
) {
  // Centralized wallet resolution: check env vars first, then rpcsFile
  if (!argv.wallet) {
    argv.wallet = process.env['PRIVATE_KEY'] || process.env['USER_KEY'] || process.env['OWNER_KEY']
  }
  if (!argv.wallet && argv.rpcsFile && existsSync(argv.rpcsFile)) {
    try {
      const file = readFileSync(argv.rpcsFile, 'utf8')
      const match = file.match(/^\s*(PRIVATE_KEY|USER_KEY|OWNER_KEY)=(\S+)/m)
      if (match) argv.wallet = match[2]
    } catch (_) {
      // pass
    }
  }

  let wallet
  switch (chain.network.family) {
    case ChainFamily.EVM:
      wallet = await loadEvmWallet((chain as EVMChain).provider, argv, logger)
      return [await wallet.getAddress(), wallet] as const
    case ChainFamily.Solana:
      wallet = await loadSolanaWallet(argv, logger)
      return [wallet.publicKey.toBase58(), wallet] as const
    case ChainFamily.Aptos:
      wallet = await loadAptosWallet(argv, logger)
      return [wallet.accountAddress.toString(), wallet] as const
    case ChainFamily.Sui:
      wallet = loadSuiWallet(argv)
      return [wallet.toSuiAddress(), wallet] as const
    case ChainFamily.TON:
      wallet = await loadTonWallet(
        (chain as TONChain).provider,
        argv,
        chain.network.networkType === NetworkType.Testnet,
        logger,
      )
      return [wallet.getAddress(), wallet] as const
    case ChainFamily.Canton: {
      const cantonWallet = loadCantonWallet(argv, logger)
      return [cantonWallet.party, cantonWallet] as const
    }
    default:
      // TypeScript exhaustiveness check - this should never be reached
      throw new CCIPChainFamilyUnsupportedError((chain.network as { family: string }).family)
  }
}
