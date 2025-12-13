import { readFile } from 'node:fs/promises'

import {
  type Chain,
  type ChainGetter,
  type ChainTransaction,
  type EVMChain,
  CCIPChainFamilyUnsupportedError,
  CCIPNetworkFamilyUnsupportedError,
  CCIPRpcNotFoundError,
  CCIPTransactionNotFoundError,
  ChainFamily,
  networkInfo,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'

import { loadAptosWallet } from './aptos.ts'
import { loadEvmWallet } from './evm.ts'
import { loadSolanaWallet } from './solana.ts'
import { loadTonWallet } from './ton.ts'
import type { Ctx } from '../commands/index.ts'

const RPCS_RE = /\b(?:http|ws)s?:\/\/[\w/\\@&?%~#.,;:=+-]+/

async function collectEndpoints({
  rpcs,
  'rpcs-file': rpcsFile,
}: {
  rpcs?: string[]
  'rpcs-file'?: string
}): Promise<Set<string>> {
  const endpoints = new Set<string>(rpcs || [])
  for (const [env, val] of Object.entries(process.env)) {
    if (env.startsWith('RPC_') && val && RPCS_RE.test(val)) endpoints.add(val)
  }
  if (rpcsFile) {
    try {
      const fileContent = await readFile(rpcsFile, 'utf8')
      for (const line of fileContent.toString().split(/(?:\r\n|\r|\n)/g)) {
        const match = line.match(RPCS_RE)
        if (match) endpoints.add(match[0])
      }
    } catch (error) {
      console.debug('Error reading RPCs file', error)
    }
  }
  return endpoints
}

export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
): ChainGetter
export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash: string,
): [ChainGetter, Promise<[Chain, ChainTransaction]>]

/**
 * Receives a list of rpcs and/or rpcs file, and loads them concurrently for each chain family
 * If txHash is provided, fetches matching families first and returns [chainGetter, txPromise];
 * Otherwise, spawns racing URLs for each family asked by `getChain` getter
 * @param ctx - Context object containing destroy$ promise and logger properties
 * @param argv - Options containing rpcs (list) and/or rpcs file
 * @param txHash - Optional txHash to fetch concurrently; causes the function to return a [ChainGetter, Promise<ChainTransaction>]
 * @returns a ChainGetter (if txHash was provided), or a tuple of [ChainGetter, Promise<ChainTransaction>]
 */
export function fetchChainsFromRpcs(
  ctx: Ctx,
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash?: string,
) {
  const chains: Record<string, Promise<Chain>> = {}
  const chainsCbs: Record<
    string,
    readonly [resolve: (value: Chain) => void, reject: (reason?: unknown) => void]
  > = {}
  const finished: Partial<Record<ChainFamily, boolean>> = {}
  const initFamily$: Partial<Record<ChainFamily, Promise<unknown>>> = {}

  let txResolve: (value: [Chain, ChainTransaction]) => void, txReject: (reason?: unknown) => void
  const txResult = new Promise<[Chain, ChainTransaction]>((resolve, reject) => {
    txResolve = resolve
    txReject = reject
  })

  const loadChainFamily = (F: ChainFamily, txHash?: string) =>
    (initFamily$[F] ||= collectEndpoints(argv).then((endpoints) => {
      const C = supportedChains[F]
      if (!C) throw new CCIPNetworkFamilyUnsupportedError(F)
      ctx.logger.debug('Racing', endpoints.size, 'RPC endpoints for', F)

      const chains$: Promise<Chain>[] = []
      const txs$: Promise<unknown>[] = []
      let txFound = false
      for (const url of endpoints) {
        const chain$ = C.fromUrl(url, ctx)
        chains$.push(chain$)

        void chain$.then(
          (chain) => {
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
              const [resolve] = chainsCbs[chain.network.name]
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
    if (network.name in chains) return chains[network.name]
    if (finished[network.family]) throw new CCIPRpcNotFoundError(network.name)
    chains[network.name] = new Promise((resolve, reject) => {
      chainsCbs[network.name] = [resolve, reject]
    })
    void chains[network.name].finally(() => {
      delete chainsCbs[network.name] // when chain is settled, delete the callbacks
    })
    void loadChainFamily(network.family)
    return chains[network.name]
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
 * @param opts - Wallet options (as passed from yargs argv)
 * @returns Promise to chain-specific wallet instance
 */
export async function loadChainWallet(chain: Chain, opts: { wallet?: unknown }) {
  let wallet
  switch (chain.network.family) {
    case ChainFamily.EVM:
      wallet = await loadEvmWallet((chain as EVMChain).provider, opts)
      return [await wallet.getAddress(), wallet] as const
    case ChainFamily.Solana:
      wallet = await loadSolanaWallet(opts)
      return [wallet.publicKey.toBase58(), wallet] as const
    case ChainFamily.Aptos:
      wallet = await loadAptosWallet(opts)
      return [wallet.accountAddress.toString(), wallet] as const
    case ChainFamily.TON:
      wallet = await loadTonWallet(opts)
      return [wallet.contract.address.toString(), wallet] as const
    default:
      throw new CCIPChainFamilyUnsupportedError(chain.network.family)
  }
}
