import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import type { CantonRpcProvider } from '@chainlink/ccip-sdk/src/canton/types.ts'
import {
  type Chain,
  type ChainGetter,
  type ChainTransaction,
  type EVMChain,
  type Logger,
  type TONChain,
  CCIPChainFamilyUnsupportedError,
  CCIPError,
  CCIPErrorCode,
  CCIPRpcNotFoundError,
  CCIPTransactionNotFoundError,
  CantonChain,
  ChainFamily,
  NetworkType,
  networkInfo,
  signalToPromise,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'

import type { Ctx } from '../commands/index.ts'
import type { GlobalOpts } from '../index.ts'
import { loadAptosWallet } from './aptos.ts'
import {
  type CantonCliConfig,
  type CantonWalletWithSigner,
  JsonRpcProvider,
  loadCantonConfig,
  loadCantonWallet,
  resolveCantonTokenGetter,
  resolveCliIndexer,
} from './canton/index.ts'
import { loadEvmWallet } from './evm.ts'
import { loadSolanaWallet } from './solana.ts'
import { loadSuiWallet } from './sui.ts'
import { loadTonWallet } from './ton.ts'

const RPCS_RE = /\b(?:http|ws)s?:\/\/[\w/\\@&?%~#.,;:=+-]+/
type FetchGlobalArgs = Partial<Pick<GlobalOpts, 'rpcs' | 'rpcsFile' | 'api' | 'cantonConfig'>>

/**
 * Memoized per-process Canton wallet load.
 *
 * A Ledger device can only be claimed by a single HID transport, and chain
 * initialization may run several times per process (each `fetchChainsFromRpcs`
 * call — e.g. `send` re-initializing chains in `showRequests` — builds its own
 * config resolution), so the wallet — and its Ledger transport — is loaded
 * exactly once and shared.
 */
let cantonWallet$: Promise<CantonWalletWithSigner> | undefined
const loadCantonWalletOnce = (
  argv: { cantonConfig?: string; wallet?: unknown; interactive?: boolean },
  logger?: Logger,
): Promise<CantonWalletWithSigner> => (cantonWallet$ ??= loadCantonWallet(argv, logger))

type CantonCliArgs = Partial<Pick<GlobalOpts, 'cantonConfig'>>

/** CLI argv fields used by {@link resolveIndexer}. */
export type ResolveIndexerArgs = CantonCliArgs & { indexer?: string[] }

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
    if (!env.startsWith('RPC_') || !val) continue
    // RPC_* vars hold comma-separated lists (same shape --rpc accepts), so a
    // multi-endpoint value must fan out instead of being raced as one URL with
    // commas in it — which no family can resolve, and which stalls every
    // "not found on any chain" determination until it fails.
    for (const url of val.split(',')) {
      const endpoint = url.trim()
      if (endpoint && RPCS_RE.test(endpoint)) endpoints.add(endpoint)
    }
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
  const rawCantonConfig = loadCantonConfig(argv.cantonConfig, ctx.logger)
  const chains: Record<string, Promise<Chain>> = {}
  const pendingChainsCbs: Record<
    string,
    readonly [
      resolve: (value: Chain) => void,
      reject: (reason?: unknown) => void,
      family: ChainFamily,
    ]
  > = {}
  /** chain ids reported by RPCs but missing from the selector table, to the RPC's host */
  const unregistered = new Map<string, string>()
  const finished: Partial<Record<ChainFamily, true>> = {}
  const initFamily$: Partial<Record<ChainFamily, Promise<unknown>>> = {}
  let endpoints$: Promise<Set<string>> | undefined
  let txFoundIn: string | undefined

  /**
   * Recovery hint for a chain or tx not found while some RPCs report chain ids missing from the
   * selector table: typically a fork served under its own chain id, which `--chain-selectors` maps.
   */
  const unregisteredHint = (name?: string): string | undefined => {
    if (!unregistered.size) return
    const ids = [...unregistered].map(([id, host]) => `${id} (${host})`).join(', ')
    const chainId = unregistered.size === 1 ? [...unregistered.keys()][0]! : '<chainId>'
    return (
      `RPCs report chain ids missing from the selector table, so they were not used: ${ids}. ` +
      `If one serves ${name ?? 'this transaction'}, register it: ` +
      `--chain-selectors ${chainId}=${name ?? '<selector|forked chain name>'}`
    )
  }
  const rpcNotFound = (name: string) => {
    const recovery = unregisteredHint(name)
    return new CCIPRpcNotFoundError(
      name,
      recovery ? { recovery, context: { unregisteredChainIds: [...unregistered.keys()] } } : {},
    )
  }

  /**
   * Resolve the Canton config into a `jwt` (string or getter) and a
   * {@link JsonRpcProvider} upfront, so the SDK never orchestrates an OAuth
   * flow. The resolution is lazy (only awaited when the Canton family is
   * loaded) and memoized so repeated family loads reuse the same resolved
   * config — and the wallet (and its Ledger device, if any) is loaded exactly
   * once here: its signer, if any, is handed to the provider, which then
   * takes care of signing/submission.
   */
  type ResolvedCantonConfig = Omit<CantonCliConfig, 'auth'> | undefined
  let resolvedCantonConfig$: Promise<ResolvedCantonConfig> | undefined
  const getResolvedCantonConfig = (): Promise<ResolvedCantonConfig> => {
    if (!rawCantonConfig) return Promise.resolve(undefined)
    return (resolvedCantonConfig$ ??= (async () => {
      // `auth` is consumed here; the SDK receives only `jwt`.
      const { auth, ...rest } = rawCantonConfig
      const jwt = auth ? await resolveCantonTokenGetter(auth, { signal: ctx.abort }) : rest.jwt
      if (!jwt) {
        throw new CCIPError(
          CCIPErrorCode.CANTON_AUTH_ERROR,
          'Canton config requires a `jwt` or an `auth` block for authentication',
        )
      }

      // Create Canton JSON API Provider, handing it the wallet's external
      // signer (Ledger) if one is configured.
      const wallet = await loadCantonWalletOnce(argv, ctx.logger)
      let provider: CantonRpcProvider
      switch (rawCantonConfig.apiType) {
        case '':
        case 'json':
          provider = await JsonRpcProvider.fromUrl(
            rawCantonConfig.chainId,
            rawCantonConfig.apiUrl,
            jwt,
            undefined,
            rawCantonConfig.party,
            wallet.signer,
          )
          break
        default:
          throw new Error('unknown cantonConfig.apiType')
      }

      return { ...rest, jwt, provider } as ResolvedCantonConfig
    })())
  }

  const loadChainFamily = (F: ChainFamily, txHash?: string) =>
    (initFamily$[F] ??= (endpoints$ ??= collectEndpoints.call(ctx, argv)).then(
      async (endpoints) => {
        const C = supportedChains[F]
        if (!C) throw new CCIPChainFamilyUnsupportedError(F)
        ctx.abort.throwIfAborted()

        if (F === ChainFamily.Canton) {
          const cantonConfig = await getResolvedCantonConfig()
          if (!cantonConfig) {
            throw new CCIPError(
              CCIPErrorCode.CANTON_AUTH_ERROR,
              'Canton config is required for Canton family RPCs',
            )
          }
          const cantonChain = await CantonChain.fromProvider(cantonConfig.provider, {
            ...ctx,
            abort: ctx.abort,
            apiClient:
              argv.api === false ? null : typeof argv.api === 'string' ? argv.api : undefined,
            ...{
              cantonConfig: cantonConfig,
            },
          })

          // Keep the tx-lookup promise in the returned chain so its rejection is
          // observed by Promise.any (txResult) instead of surfacing as an
          // unhandled rejection that crashes the process.
          const tx$ = txHash
            ? cantonChain.getTransaction(txHash).then(
                (tx) => {
                  txFoundIn = cantonChain.network.name
                  chains[cantonChain.network.name] = Promise.resolve(cantonChain)
                  return [cantonChain, tx] as const
                },
                (err) => {
                  if (
                    CCIPError.isCCIPError(err) &&
                    err.code === CCIPErrorCode.TRANSACTION_NOT_FOUND
                  ) {
                    throw new CCIPTransactionNotFoundError(txHash, {
                      context: { chainName: cantonChain.network.name },
                    })
                  }
                  throw err
                },
              )
            : Promise.resolve([cantonChain] as const)

          if (cantonChain.network.name in pendingChainsCbs) {
            // There's a "pending request" by getChain: resolve
            const [resolve] = pendingChainsCbs[cantonChain.network.name]!
            resolve(cantonChain)
          }
          return tx$
        }

        ctx.logger.debug('Racing', endpoints.size, 'RPC endpoints for', F)

        const chains$: Promise<Chain>[] = []
        const txOnlyRacers = new WeakSet<Chain>()
        for (const url of endpoints) {
          const chain$ = C.fromUrl(url, {
            ...ctx,
            abort: ctx.abort,
            apiClient:
              argv.api === false ? null : typeof argv.api === 'string' ? argv.api : undefined,
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
            (err: unknown) => {
              if (!CCIPError.isCCIPError(err) || err.code !== CCIPErrorCode.CHAIN_NOT_FOUND) return
              const chainId = String(err.context.chainIdOrSelector)
              let host
              try {
                host = new URL(url).host // not the path: RPC paths may embed credentials
              } catch {
                host = 'rpc'
              }
              unregistered.set(chainId, host)
              ctx.logger.debug(
                'RPC',
                host,
                'reports chain id',
                chainId,
                'not in the selector table',
              )
            },
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

        Promise.race([
          Promise.allSettled(chains$).then((results) => {
            // When all RPCs for a family fail, surface the most specific error
            // (e.g. CANTON_AUTH_ERROR) instead of a generic RPC_NOT_FOUND.
            if (finished[F]) return
            finished[F] = true
            // Find the most informative rejection reason from the settled results.
            // Prefer CCIPError with specific codes over generic errors.
            let bestError: Error | undefined
            for (const result of results) {
              if (result.status === 'rejected' && result.reason instanceof Error) {
                if (!bestError || CCIPError.isCCIPError(result.reason)) {
                  bestError = result.reason
                }
              }
            }
            Object.entries(pendingChainsCbs)
              .filter(([, [, , family]]) => family === F)
              .forEach(([name, [_, reject]]) => {
                // an unregistered RPC's CHAIN_NOT_FOUND names ITS chain id, not the one asked for
                if (
                  bestError &&
                  CCIPError.isCCIPError(bestError) &&
                  bestError.code !== CCIPErrorCode.CHAIN_NOT_FOUND
                ) {
                  reject(bestError)
                } else {
                  reject(rpcNotFound(name))
                }
              })
          }),
          signalToPromise(ctx.abort),
        ]).catch(() => {
          // signalToPromise(ctx.abort) rejects with DOMException when the parent
          // context aborts before all race URLs settle; swallow it here so the
          // void-discarded chain doesn't surface as an unhandled rejection.
        })
        return txs$
      },
    ))

  const chainGetter = async (idOrSelectorOrName: number | string | bigint): Promise<Chain> => {
    const network = networkInfo(idOrSelectorOrName)
    if (network.name in chains) return chains[network.name]!
    if (finished[network.family]) throw rpcNotFound(network.name)

    const { promise, resolve, reject } = Promise.withResolvers<Chain>()
    chains[network.name] = promise
    pendingChainsCbs[network.name] = [resolve, reject, network.family]

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
  ).catch((err) => {
    const recovery = unregisteredHint()
    return Promise.reject(
      new CCIPTransactionNotFoundError(txHash, {
        context: { aggregateErr: err },
        ...(recovery && { recovery }),
      }),
    )
  })
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
      wallet = await loadSuiWallet(argv, logger)
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
      // The provider (created with the wallet's signer at chain init) takes
      // care of signing/submission — commands don't need the wallet object.
      return [(chain as CantonChain).activeParty, {}] as const
    }
    default:
      // TypeScript exhaustiveness check - this should never be reached
      throw new CCIPChainFamilyUnsupportedError((chain.network as { family: string }).family)
  }
}
