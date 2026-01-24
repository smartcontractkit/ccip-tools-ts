import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import {
  type Chain,
  type ChainGetter,
  type ChainTransaction,
  type EVMChain,
  type TONChain,
  CCIPChainFamilyUnsupportedError,
  CCIPRpcNotFoundError,
  CCIPTransactionNotFoundError,
  ChainFamily,
  networkInfo,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'

import { loadAptosWallet } from './aptos.ts'
import { loadEvmWallet } from './evm.ts'
import { loadSolanaWallet } from './solana.ts'
import { loadSuiWallet } from './sui.ts'
import { loadTonWallet } from './ton.ts'
import type { Ctx } from '../commands/index.ts'

const RPCS_RE = /\b(?:http|ws)s?:\/\/[\w/\\@&?%~#.,;:=+-]+/

async function collectEndpoints(
  this: Ctx,
  { rpcs, rpcsFile }: { rpcs?: string[]; rpcsFile?: string },
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
        const match = line.match(RPCS_RE)
        if (match) endpoints.add(match[0])
      }
    } catch (error) {
      this.logger.debug('Error reading RPCs file', error)
    }
  }
  return endpoints
}

export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: { rpcs?: string[]; rpcsFile?: string; noApi?: boolean },
): ChainGetter
export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: { rpcs?: string[]; rpcsFile?: string; noApi?: boolean },
  txHash: string,
): [ChainGetter, Promise<[Chain, ChainTransaction]>]

/**
 * Receives a list of rpcs and/or rpcs file, and loads them concurrently for each chain family
 * If txHash is provided, fetches matching families first and returns [chainGetter, txPromise];
 * Otherwise, spawns racing URLs for each family asked by `getChain` getter
 * @param ctx - Context object containing destroy$ promise and logger properties
 * @param argv - Options containing rpcs (list), rpcs file and noApi flag
 * @param txHash - Optional txHash to fetch concurrently; causes the function to return a [ChainGetter, Promise<ChainTransaction>]
 * @returns a ChainGetter (if txHash was provided), or a tuple of [ChainGetter, Promise<ChainTransaction>]
 */
export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: { rpcs?: string[]; rpcsFile?: string; noApi?: boolean },
  txHash?: string,
) {
  const chains: Record<string, Promise<Chain>> = {}
  const chainsCbs: Record<
    string,
    readonly [resolve: (value: Chain) => void, reject: (reason?: unknown) => void]
  > = {}
  const finished: Partial<Record<ChainFamily, boolean>> = {}
  const initFamily$: Partial<Record<ChainFamily, Promise<unknown>>> = {}
  let endpoints$: Promise<Set<string>> | undefined

  let txResolve: (value: [Chain, ChainTransaction]) => void, txReject: (reason?: unknown) => void
  const txResult = new Promise<[Chain, ChainTransaction]>((resolve, reject) => {
    txResolve = resolve
    txReject = reject
  })

  const loadChainFamily = (F: ChainFamily, txHash?: string) =>
    (initFamily$[F] ??= (endpoints$ ??= collectEndpoints.call(ctx, argv)).then((endpoints) => {
      const C = supportedChains[F]
      if (!C) throw new CCIPChainFamilyUnsupportedError(F)
      ctx.logger.debug('Racing', endpoints.size, 'RPC endpoints for', F)

      const chains$: Promise<Chain>[] = []
      const txs$: Promise<unknown>[] = []
      let txFound = false
      for (const url of endpoints) {
        const chain$ = C.fromUrl(url, {
          ...ctx,
          apiClient: argv.noApi ? null : undefined,
        })
        chains$.push(chain$)

        void chain$.then(
          (chain) => {
            endpoints.delete(url) // when resolved, remove from set so it isn't tried for future families
            // on chain detected for url
            if (chain.network.name in chains && !(chain.network.name in chainsCbs))
              return chain.destroy?.() // but lost race, cleanup right away
            // keep and schedule cleanup on shutdown
            if (chain.destroy) void ctx.destroy$.finally(chain.destroy.bind(chain))
            if (!(chain.network.name in chains)) {
              // chain won for this network, but was not "asked" by getChain (yet?): save
              chains[chain.network.name] = Promise.resolve(chain)
            } else if (chain.network.name in chainsCbs) {
              // chain detected, and there's a "pending request" by getChain: resolve
              const [resolve] = chainsCbs[chain.network.name]!
              resolve(chain)
            }
            return chain
          },
          () => {},
        )

        if (txHash) {
          txs$.push(
            chain$.then(async (chain) => {
              const tx = await chain.getTransaction(txHash)
              if (!txFound) {
                txFound = true
                // in case tx is first found, prefer it over any previously found chain for this network
                chains[chain.network.name] = chain$
                delete chainsCbs[chain.network.name]
              }
              txResolve([chain, tx])
            }),
          )
        }
      }

      void Promise.race([Promise.allSettled(chains$), ctx.destroy$]).finally(() => {
        if (finished[F]) return
        finished[F] = true
        Object.entries(chainsCbs)
          .filter(([name]) => networkInfo(name).family === F)
          .forEach(([name, [_, reject]]) => reject(new CCIPRpcNotFoundError(name)))
      })
      return Promise.any(txHash ? txs$ : chains$)
    }))

  const chainGetter = async (idOrSelectorOrName: number | string | bigint): Promise<Chain> => {
    const network = networkInfo(idOrSelectorOrName)
    if (network.name in chains) return chains[network.name]!
    if (finished[network.family]) throw new CCIPRpcNotFoundError(network.name)
    const c = (chains[network.name] = new Promise((resolve, reject) => {
      chainsCbs[network.name] = [resolve, reject]
    }))
    void c.finally(() => {
      delete chainsCbs[network.name] // when chain is settled, delete the callbacks
    })
    void loadChainFamily(network.family)
    return c
  }

  if (!txHash) return chainGetter

  void Promise.allSettled(
    Object.values(supportedChains)
      .filter((C) => C.isTxHash(txHash))
      .map((C) => loadChainFamily(C.family, txHash)),
  ).finally(() => txReject(new CCIPTransactionNotFoundError(txHash))) // noop if txResolved
  return [chainGetter, txResult]
}

/**
 * Load chain-specific wallet for given chain
 * @param chain - Chain instance to load wallet for
 * @param argv - Wallet options (as passed from yargs argv)
 * @returns Promise to chain-specific wallet instance
 */
export async function loadChainWallet(chain: Chain, argv: { wallet?: unknown; rpcsFile?: string }) {
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
      wallet = await loadEvmWallet((chain as EVMChain).provider, argv)
      return [await wallet.getAddress(), wallet] as const
    case ChainFamily.Solana:
      wallet = await loadSolanaWallet(argv)
      return [wallet.publicKey.toBase58(), wallet] as const
    case ChainFamily.Aptos:
      wallet = await loadAptosWallet(argv)
      return [wallet.accountAddress.toString(), wallet] as const
    case ChainFamily.Sui:
      wallet = loadSuiWallet(argv)
      return [wallet.toSuiAddress(), wallet] as const
    case ChainFamily.TON:
      wallet = await loadTonWallet((chain as TONChain).provider, argv, chain.network.isTestnet)
      return [wallet.getAddress(), wallet] as const
    default:
      // TypeScript exhaustiveness check - this should never be reached
      throw new CCIPChainFamilyUnsupportedError((chain.network as { family: string }).family)
  }
}
