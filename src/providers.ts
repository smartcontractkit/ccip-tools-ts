import { readFile } from 'node:fs/promises'

import {
  type JsonRpcApiProvider,
  type TransactionReceipt,
  JsonRpcProvider,
  WebSocketProvider,
} from 'ethers'

import { chainNameFromId, getProviderNetwork } from './lib/index.js'

const RPCS_RE = /\b(?:http|ws)s?:\/\/[\w/\\@&?%~#.,;:=+-]+/

/**
 * Wrap a promise with a timeout
 * @param promise - promise to wrap
 * @param ms - timeout in milliseconds
 * @param message - error message to throw on timeout
 * @param cancel - optional promise to cancel the timeout
 * @returns Promise that resolves when the original promise resolves, or rejects on timeout
 **/
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Timeout',
  cancel?: Promise<unknown>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms)
    }),
    promise,
    ...(cancel ? [cancel.then(() => Promise.reject(new Error('Cancelled')))] : []),
  ]).finally(() => clearTimeout(timeoutId))
}

/**
 * Gets a provider for a given endpoint
 *
 * @param endpoint - RPC endpoint, either HTTP or WebSocket
 * @returns instance of JsonRpcApiProvider and a promise that resolves when it is ready
 * @throws Error if the protocol in the endpoint is unknown
 **/
export function getProvider(endpoint: string): {
  provider: JsonRpcApiProvider
  providerReady: Promise<JsonRpcApiProvider>
} {
  if (endpoint.startsWith('ws')) {
    const provider = new WebSocketProvider(endpoint)
    return {
      provider: provider,
      providerReady: new Promise((resolve, reject) => {
        provider.websocket.onerror = reject
        provider
          ._waitUntilReady()
          .then(() => resolve(provider))
          .catch(reject)
      }),
    }
  }

  if (endpoint.startsWith('http')) {
    const provider = new JsonRpcProvider(endpoint)
    return { provider: new JsonRpcProvider(endpoint), providerReady: Promise.resolve(provider) }
  }

  throw new Error(
    `Unknown JSON RPC protocol in endpoint (should be wss?:// or https?://): ${endpoint}`,
  )
}

/**
 * Load providers from a list of RPC endpoints
 *
 * This class manages concurrent access to providers, racing them as soon as they are created for
 * the `getTxReceipt` method, or managing a singleton promise requested with `forChainId` method,
 * resolved to the first RPC responding for that chainId, even before the chainIds of all
 * providers are known.
 * It also ensures that all providers are destroyed when the instance is destroyed.
 *
 * @param argv - Object with either `rpcs` or `rpcs-file` property
 * @returns instance of Providers manager class
 * @throws Error if no providers are found
 **/
export class Providers {
  #endpoints: Promise<Set<string>>
  #providersList?: Promise<(readonly [provider: JsonRpcApiProvider, endpoint: string])[]>
  #providersPromises: Record<number, Promise<JsonRpcApiProvider>> = {}
  #promisesCallbacks: Record<
    number,
    readonly [resolve: (provider: JsonRpcApiProvider) => void, reject: (reason: unknown) => void]
  > = {}
  #destroy!: (v: unknown) => void
  destroyed: Promise<unknown> = new Promise((resolve) => {
    this.#destroy = resolve
  })
  #complete!: (v: true) => void
  completed: true | Promise<true> = new Promise((resolve) => {
    this.#complete = resolve
  })

  constructor(argv: { rpcs: string[] } | { 'rpcs-file': string }) {
    if ('rpcs' in argv) {
      this.#endpoints = Promise.resolve(
        new Set([
          ...argv.rpcs,
          ...Object.entries(process.env)
            .filter(([env, val]) => env.startsWith('RPC_') && val && RPCS_RE.test(val))
            .map(([, val]) => val!),
        ]),
      )
    } else {
      this.#endpoints = readFile(argv['rpcs-file'], 'utf8')
        .catch(() => '')
        .then((file) => {
          const rpcs = new Set<string>()
          for (const line of file.toString().split(/(?:\r\n|\r|\n)/g)) {
            const match = line.match(RPCS_RE)
            if (match) rpcs.add(match[0])
          }
          for (const [env, val] of Object.entries(process.env)) {
            if (env.startsWith('RPC_') && val && RPCS_RE.test(val)) rpcs.add(val)
          }
          return rpcs
        })
    }
  }

  destroy() {
    this.#destroy(null)
  }

  /**
   * Trigger fetching providers from RPC endpoints, with their networks in parallel
   **/
  #loadProviders(): Promise<(readonly [provider: JsonRpcApiProvider, endpoint: string])[]> {
    if (this.#providersList) return this.#providersList

    const readyPromises: Promise<unknown>[] = []
    return (this.#providersList = this.#endpoints
      .then((rpcs) =>
        [...rpcs].map((endpoint) => {
          const { provider, providerReady } = getProvider(endpoint)

          void this.destroyed.then(() => provider.destroy()) // schedule cleanup
          readyPromises.push(
            // wait for connection and check network in background
            withTimeout(
              providerReady.then((provider) => getProviderNetwork(provider)),
              30e3,
              undefined,
              this.destroyed,
            )
              .then(({ chainId }) => {
                if (chainId in this.#promisesCallbacks) {
                  const [resolve] = this.#promisesCallbacks[chainId]
                  delete this.#promisesCallbacks[chainId]
                  resolve(provider)
                } else if (!(chainId in this.#providersPromises)) {
                  this.#providersPromises[chainId] = Promise.resolve(provider)
                } else {
                  throw new Error(`Raced by a faster provider`)
                }
              })
              .catch((_reason) => {
                // destroy earlier if provider failed to connect, or if raced
                provider.destroy()
              }),
          )
          return [provider, endpoint] as const
        }),
      )
      .finally(() => {
        void Promise.allSettled(readyPromises).then(() => {
          for (const [chainId, [, reject]] of Object.entries(this.#promisesCallbacks)) {
            // if `forChainId` in the meantime requested a provider that was not found, reject it
            reject(
              new Error(
                `Could not find provider for chain "${chainNameFromId(+chainId)}" [${chainId}]`,
              ),
            )
            delete this.#promisesCallbacks[+chainId]
          }
          this.#complete(true)
          this.completed = true
        })
      }))
  }

  /**
   * Ask for a provider for a given chainId, or wait for it to be available
   * @param chainId - chainId to get a provider for
   * @returns Promise for a provider for the given chainId
   **/
  async forChainId(chainId: number): Promise<JsonRpcApiProvider> {
    if (chainId in this.#providersPromises) return this.#providersPromises[chainId]
    if (this.completed === true)
      throw new Error(
        `Could not find provider for chain "${chainNameFromId(chainId)}" [${chainId}]`,
      )
    this.#providersPromises[chainId] = new Promise((resolve, reject) => {
      this.#promisesCallbacks[chainId] = [resolve, reject]
    })
    void this.#loadProviders()
    return this.#providersPromises[chainId]
  }

  /**
   * Get transaction receipt from any of the providers;
   * Races them even before network is known, returning first to respond.
   * Continues populating the list of providers in the background after resolved.
   * @param txHash - transaction hash to get receipt for
   * @returns Promise for the transaction receipt, with provider in TransactionReceipt.provider
   **/
  async getTxReceipt(txHash: string): Promise<TransactionReceipt> {
    return this.#loadProviders().then((providers) =>
      Promise.any(
        providers.map(([provider, endpoint]) =>
          withTimeout(
            provider.getTransactionReceipt(txHash),
            30e3,
            `Timeout fetching tx=${txHash} from "${endpoint}"`,
            this.destroyed,
          ).then((receipt) => {
            if (!receipt) throw new Error(`Transaction=${txHash} not found in "${endpoint}"`)
            return receipt
          }),
        ),
      ),
    )
  }
}
