import { readFile } from 'node:fs/promises'

import './aptos.ts'
import './evm.ts'
import './solana.ts'
import {
  type Chain,
  type ChainGetter,
  type ChainTransaction,
  networkInfo,
  supportedChains,
} from '../lib/index.ts'

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
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash?: undefined,
  destroy?: Promise<unknown>,
): ChainGetter
export function fetchChainsFromRpcs(
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash: string,
  destroy?: Promise<unknown>,
): [ChainGetter, Promise<ChainTransaction>]

/**
 * Receives a list of rpcs and/or rpcs file, and loads them all concurrently
 * Returns a ChainGetter function and optinoally a ChainTransaction promise
 * @param argv - Options containing rpcs (list) and/or rpcs file
 * @param txHash - Optional txHash to fetch concurrently; causes the function to return a [ChainGetter, Promise<ChainTransaction>]
 * @param destroy - A promise to signal when to stop fetching chains
 * @returns a ChainGetter (alone if no txHash was provided), or a tuple of [ChainGetter, Promise<ChainTransaction>]
 */
export function fetchChainsFromRpcs(
  argv: { rpcs?: string[]; 'rpcs-file'?: string },
  txHash?: string,
  destroy?: Promise<unknown>,
) {
  const chains: Record<string, Promise<Chain>> = {}
  const chainsCbs: Record<
    string,
    readonly [resolve: (value: Chain) => void, reject: (reason?: unknown) => void]
  > = {}
  let finished = false
  const txs: Promise<ChainTransaction>[] = []

  const init$ = collectEndpoints(argv).then((endpoints) => {
    const pendingPromises: Promise<unknown>[] = []
    for (const C of Object.values(supportedChains)) {
      for (const url of endpoints) {
        let chain$: Promise<Chain>, tx$
        if (txHash) {
          ;[chain$, tx$] = C.txFromUrl(url, txHash)
          void tx$.then(
            ({ chain }) => {
              // in case tx is found, overwrite chain with the one which found this tx
              chains[chain.network.name] = chain$
              delete chainsCbs[chain.network.name]
            },
            () => {},
          )
          txs.push(tx$)
        } else {
          chain$ = C.fromUrl(url)
        }

        pendingPromises.push(
          chain$.then((chain) => {
            if (chain.network.name in chains && !(chain.network.name in chainsCbs))
              return chain.destroy() // lost race
            void destroy?.finally(() => {
              void chain.destroy() // cleanup
            })
            if (!(chain.network.name in chains)) {
              chains[chain.network.name] = Promise.resolve(chain)
            } else if (chain.network.name in chainsCbs) {
              const [resolve] = chainsCbs[chain.network.name]
              resolve(chain)
            }
          }),
        )
      }
    }
    const res = Promise.allSettled(pendingPromises)
    void (destroy ? Promise.race([res, destroy]) : res).finally(() => {
      finished = true
      Object.entries(chainsCbs).forEach(([name, [_, reject]]) =>
        reject(new Error(`No provider/chain found for network=${name}`)),
      )
    })
    return Promise.any(txs)
  })

  const chainGetter = async (idOrSelectorOrName: number | string | bigint): Promise<Chain> => {
    const network = networkInfo(idOrSelectorOrName)
    if (network.name in chains) return chains[network.name]
    if (finished) throw new Error(`No provider/chain found for network=${network.name}`)
    chains[network.name] = new Promise((resolve, reject) => {
      chainsCbs[network.name] = [resolve, reject]
    })
    void chains[network.name].finally(() => {
      delete chainsCbs[network.name]
    })
    return chains[network.name]
  }

  if (txHash) {
    return [chainGetter, init$]
  } else {
    void init$.catch(() => {})
    return chainGetter
  }
}
